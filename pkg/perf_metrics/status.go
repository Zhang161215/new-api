package perfmetrics

import (
	"math"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// /api/pricing/status 的数据形状。字段名沿用日志版（AstrBot 拨测插件在读 has_data/availability/latency/buckets），
// 时间单位统一为秒（ms 精度），新增 ttft。

const (
	statusBucketCount = 24
	statusNoData      = float64(-1)
	statusCacheTTL    = 30 * time.Second
)

type ModelHourPoint struct {
	Availability float64 `json:"availability"` // <0 表示该小时没有请求
	Latency      float64 `json:"latency"`
	Ttft         float64 `json:"ttft"`
	Throughput   float64 `json:"throughput"`
}

type ModelGroupStatus struct {
	Group        string    `json:"group"`
	Availability float64   `json:"availability"`
	Latency      float64   `json:"latency"`
	Ttft         float64   `json:"ttft"`
	Throughput   float64   `json:"throughput"`
	Buckets      []float64 `json:"buckets"`
}

type ModelStatus struct {
	Availability float64            `json:"availability"` // 0~100，请求级成功率
	Latency      float64            `json:"latency"`      // 平均端到端耗时（秒）
	Ttft         float64            `json:"ttft"`         // 平均首字延迟（秒，仅流式；0=无样本）
	Throughput   float64            `json:"throughput"`   // 生成速度 tokens/s（不含首字等待）
	Buckets      []float64          `json:"buckets"`      // 24 格每小时可用率（-1=无数据，旧→新，最后一格是当前小时）
	Hours        []ModelHourPoint   `json:"hours"`
	Groups       []ModelGroupStatus `json:"groups"`
	HasData      bool               `json:"has_data"`
}

// rawWindow 是 24 小时窗口内全部 (模型, 分组, 小时) 计数，所有用户共享一份，按请求再按分组过滤。
type rawWindow struct {
	startTs int64
	data    map[string]map[string]map[int64]counters // model -> group -> bucketTs -> counters
}

var (
	rawCache     *rawWindow
	rawCacheTime time.Time
	rawCacheLock sync.Mutex
)

// GetModelStatuses 返回 allowedGroups 范围内各模型的状态；allowedGroups 为 nil 表示不过滤。
func GetModelStatuses(allowedGroups map[string]struct{}) map[string]ModelStatus {
	raw := loadRawWindow()
	result := make(map[string]ModelStatus, len(raw.data))
	for modelName, groups := range raw.data {
		if st, ok := buildModelStatus(raw.startTs, groups, allowedGroups); ok {
			result[modelName] = st
		}
	}
	return result
}

func loadRawWindow() *rawWindow {
	rawCacheLock.Lock()
	defer rawCacheLock.Unlock()
	if rawCache != nil && time.Since(rawCacheTime) < statusCacheTTL {
		return rawCache
	}
	raw, err := queryRawWindow(time.Now().Unix())
	if err != nil {
		common.SysError("perf metrics status query failed: " + err.Error())
		if rawCache != nil {
			return rawCache
		}
		return &rawWindow{data: map[string]map[string]map[int64]counters{}}
	}
	rawCache, rawCacheTime = raw, time.Now()
	return raw
}

func queryRawWindow(now int64) (*rawWindow, error) {
	startTs := bucketStart(now) - int64(statusBucketCount-1)*bucketSeconds
	raw := &rawWindow{startTs: startTs, data: map[string]map[string]map[int64]counters{}}
	add := func(k bucketKey, v counters) {
		if v.requestCount == 0 || k.bucketTs < startTs {
			return
		}
		groups, ok := raw.data[k.model]
		if !ok {
			groups = map[string]map[int64]counters{}
			raw.data[k.model] = groups
		}
		buckets, ok := groups[k.group]
		if !ok {
			buckets = map[int64]counters{}
			groups[k.group] = buckets
		}
		cur := buckets[k.bucketTs]
		cur.merge(v)
		buckets[k.bucketTs] = cur
	}

	// 先读库再读内存：中间若恰好 flush，只会短暂少算，不会重复算
	rows, err := model.GetPerfMetricsSince(startTs)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		add(bucketKey{model: row.ModelName, group: row.Group, bucketTs: row.BucketTs}, counters{
			requestCount:   row.RequestCount,
			successCount:   row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs,
			ttftSumMs:      row.TtftSumMs,
			ttftCount:      row.TtftCount,
			outputTokens:   row.OutputTokens,
			generationMs:   row.GenerationMs,
		})
	}
	hotBuckets.Range(func(key, value any) bool {
		add(key.(bucketKey), value.(*atomicBucket).snapshot())
		return true
	})
	return raw, nil
}

func buildModelStatus(startTs int64, groups map[string]map[int64]counters, allowed map[string]struct{}) (ModelStatus, bool) {
	var total counters
	hourly := make([]counters, statusBucketCount)
	groupNames := make([]string, 0, len(groups))
	for g := range groups {
		if allowed != nil {
			if _, ok := allowed[g]; !ok {
				continue
			}
		}
		groupNames = append(groupNames, g)
	}
	if len(groupNames) == 0 {
		return ModelStatus{}, false
	}
	sort.Strings(groupNames)

	groupStatuses := make([]ModelGroupStatus, 0, len(groupNames))
	for _, g := range groupNames {
		var gTotal counters
		gHourly := make([]counters, statusBucketCount)
		for ts, v := range groups[g] {
			idx := int((ts - startTs) / bucketSeconds)
			if idx < 0 || idx >= statusBucketCount {
				continue
			}
			gHourly[idx].merge(v)
			hourly[idx].merge(v)
			gTotal.merge(v)
		}
		if gTotal.requestCount == 0 {
			continue
		}
		total.merge(gTotal)
		groupStatuses = append(groupStatuses, ModelGroupStatus{
			Group:        g,
			Availability: availabilityOf(gTotal),
			Latency:      avgSeconds(gTotal.totalLatencyMs, gTotal.requestCount),
			Ttft:         avgSeconds(gTotal.ttftSumMs, gTotal.ttftCount),
			Throughput:   throughputOf(gTotal),
			Buckets:      availabilityBuckets(gHourly),
		})
	}
	if total.requestCount == 0 {
		return ModelStatus{}, false
	}

	hours := make([]ModelHourPoint, statusBucketCount)
	for i, v := range hourly {
		if v.requestCount == 0 {
			hours[i] = ModelHourPoint{Availability: statusNoData}
			continue
		}
		hours[i] = ModelHourPoint{
			Availability: availabilityOf(v),
			Latency:      avgSeconds(v.totalLatencyMs, v.requestCount),
			Ttft:         avgSeconds(v.ttftSumMs, v.ttftCount),
			Throughput:   throughputOf(v),
		}
	}
	return ModelStatus{
		Availability: availabilityOf(total),
		Latency:      avgSeconds(total.totalLatencyMs, total.requestCount),
		Ttft:         avgSeconds(total.ttftSumMs, total.ttftCount),
		Throughput:   throughputOf(total),
		Buckets:      availabilityBuckets(hourly),
		Hours:        hours,
		Groups:       groupStatuses,
		HasData:      true,
	}, true
}

func availabilityBuckets(hourly []counters) []float64 {
	out := make([]float64, len(hourly))
	for i, v := range hourly {
		if v.requestCount == 0 {
			out[i] = statusNoData
			continue
		}
		out[i] = availabilityOf(v)
	}
	return out
}

func availabilityOf(v counters) float64 {
	if v.requestCount <= 0 {
		return 0
	}
	return round(float64(v.successCount)/float64(v.requestCount)*100, 2)
}

func avgSeconds(sumMs, count int64) float64 {
	if count <= 0 {
		return 0
	}
	return round(float64(sumMs)/float64(count)/1000, 3)
}

func throughputOf(v counters) float64 {
	if v.outputTokens <= 0 || v.generationMs <= 0 {
		return 0
	}
	return round(float64(v.outputTokens)/(float64(v.generationMs)/1000), 1)
}

func round(v float64, digits int) float64 {
	p := math.Pow(10, float64(digits))
	return math.Round(v*p) / p
}
