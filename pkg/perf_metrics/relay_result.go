package perfmetrics

// 本站定制：采样口径和停机落库。存储、查询、定时落库都用上游 metrics.go / flush.go。
//
// 采样只在 controller.Relay 的请求边界做一次（RecordRelayResult），不管重试了几个渠道；
// 成功与否按 ClassifyRelayOutcome 判定（截断流算失败、distributor 的 503 不计）。
// 上游在结算处调用的 RecordRelaySample 已移除，避免重复计数、把截断流算成成功。

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
)

const (
	maxModelLength = 128 // 与 perf_metrics.model_name 列宽一致，超长会让整批 upsert 失败
	maxGroupLength = 64
)

// RecordRelayResult 在请求边界对一次已结束的请求采样，恰好一次。
func RecordRelayResult(ctx context.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) {
	if info == nil {
		return
	}
	// 统计是旁路功能：这里出任何问题都只记日志，绝不影响请求本身
	defer func() {
		if r := recover(); r != nil {
			common.SysError(fmt.Sprintf("perf metrics record panic: %v", r))
		}
	}()
	outcome := ClassifyRelayOutcome(ctx, info, apiErr)
	if outcome == OutcomeIgnored {
		return
	}
	now := time.Now()
	hasTtft := info.IsStream && info.HasSendResponse()
	ttftMs := int64(0)
	if hasTtft {
		ttftMs = info.FirstResponseTime.Sub(info.StartTime).Milliseconds()
	}
	latencyMs := now.Sub(info.StartTime).Milliseconds()
	generationMs := latencyMs
	if hasTtft {
		generationMs = now.Sub(info.FirstResponseTime).Milliseconds()
	}
	if generationMs <= 0 {
		generationMs = latencyMs
	}
	outputTokens := info.PerformanceOutputTokens
	if !hasTtft || !countsThroughput(info.RelayMode) {
		// tokens/s 只取流式请求：非流式拿不到首字时间，分母只能用总耗时，会把速度系统性压低（上游是混算的）。
		// 图片/向量/语音这类按"张/条"计费的请求，completion_tokens 也不是生成速度。
		outputTokens = 0
	}
	Record(Sample{
		Model:        truncate(info.OriginModelName, maxModelLength),
		Group:        truncate(info.UsingGroup, maxGroupLength),
		LatencyMs:    latencyMs,
		TtftMs:       ttftMs,
		HasTtft:      hasTtft,
		Success:      outcome == OutcomeSuccess,
		OutputTokens: outputTokens,
		GenerationMs: generationMs,
	})
}

func countsThroughput(relayMode int) bool {
	switch relayMode {
	case relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits,
		relayconstant.RelayModeEmbeddings, relayconstant.RelayModeRerank, relayconstant.RelayModeModerations,
		relayconstant.RelayModeAudioSpeech, relayconstant.RelayModeAudioTranscription, relayconstant.RelayModeAudioTranslation:
		return false
	}
	return true
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func (c *counters) merge(v counters) {
	c.requestCount += v.requestCount
	c.successCount += v.successCount
	c.totalLatencyMs += v.totalLatencyMs
	c.ttftSumMs += v.ttftSumMs
	c.ttftCount += v.ttftCount
	c.outputTokens += v.outputTokens
	c.generationMs += v.generationMs
}

// FlushAll 停机前把内存里所有桶（含当前小时）落库。上游只落已结束的小时桶，
// 不补这一步的话，每次发版切容器都会丢掉当前小时的统计。upsert 是 "+="，重复落库不会多算。
func FlushAll() {
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		bucket := value.(*atomicBucket)
		drained := bucket.drain()
		if drained.requestCount == 0 {
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
