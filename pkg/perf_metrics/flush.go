package perfmetrics

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

func flushLoop() {
	for {
		time.Sleep(time.Duration(perf_metrics_setting.GetFlushIntervalMinutes()) * time.Minute)
		setting := perf_metrics_setting.GetSetting()
		if !setting.Enabled {
			continue
		}
		FlushAll()
		cleanupExpiredMetrics(setting.RetentionDays)
	}
}

// FlushAll 把内存里所有桶（包括当前小时）的增量落库。
// 与上游只落已结束小时不同：fork 没有优雅停机、一天可能发几次版，当前小时也要及时落，
// 多实例的数据也才能在一个间隔内互相看到。upsert 是累加，重复调用不会重复计数。
func FlushAll() {
	staleBefore := bucketStart(time.Now().Unix()) - bucketSeconds
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		bucket := value.(*atomicBucket)
		drained := bucket.drain()
		if drained.requestCount == 0 {
			// 只删一小时以前的空桶：新样本只会落到当前桶，删旧桶不会和 Record 抢
			if k.bucketTs < staleBefore {
				hotBuckets.Delete(key)
			}
			return true
		}
		err := model.UpsertPerfMetric(&model.PerfMetric{
			ModelName:      k.model,
			Group:          k.group,
			BucketTs:       k.bucketTs,
			RequestCount:   drained.requestCount,
			SuccessCount:   drained.successCount,
			TotalLatencyMs: drained.totalLatencyMs,
			TtftSumMs:      drained.ttftSumMs,
			TtftCount:      drained.ttftCount,
			OutputTokens:   drained.outputTokens,
			GenerationMs:   drained.generationMs,
		})
		if err != nil {
			bucket.addCounters(drained)
			common.SysError(fmt.Sprintf("perf metrics flush failed model=%s group=%s bucket=%d: %s", k.model, k.group, k.bucketTs, err.Error()))
		}
		return true
	})
}

func cleanupExpiredMetrics(retentionDays int) {
	if retentionDays <= 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).Unix()
	if err := model.DeletePerfMetricsBefore(cutoff); err != nil {
		common.SysError("perf metrics cleanup failed: " + err.Error())
	}
}
