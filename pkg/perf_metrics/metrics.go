// Package perfmetrics 模型广场的请求级性能采集（移植自上游 pkg/perf_metrics，去掉了只写不读的 Redis 分支）。
//
// 每个请求结束时在 controller.Relay 边界采一次样（不管重试了几个渠道），
// 按 模型 × 分组 × 小时 在内存里累加，定时增量 upsert 到 perf_metrics 表。
// 多实例各自累加、各自落库，upsert 是 "+="，天然可叠加。
package perfmetrics

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
	"github.com/QuantumNous/new-api/types"
)

const (
	bucketSeconds  = int64(3600)
	maxModelLength = 128 // 与 perf_metrics.model_name 列宽一致
	maxGroupLength = 64
)

var (
	hotBuckets sync.Map // bucketKey -> *atomicBucket
	initOnce   sync.Once
)

func Init() {
	initOnce.Do(func() {
		go flushLoop()
	})
}

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
		Model:        info.OriginModelName,
		Group:        info.UsingGroup,
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

func Record(sample Sample) {
	if !perf_metrics_setting.GetSetting().Enabled || sample.Model == "" {
		return
	}
	if sample.Group == "" {
		sample.Group = "default"
	}
	if sample.LatencyMs < 0 {
		sample.LatencyMs = 0
	}
	key := bucketKey{
		model:    truncate(sample.Model, maxModelLength),
		group:    truncate(sample.Group, maxGroupLength),
		bucketTs: bucketStart(time.Now().Unix()),
	}
	actual, _ := hotBuckets.LoadOrStore(key, &atomicBucket{})
	actual.(*atomicBucket).add(sample)
}

func bucketStart(ts int64) int64 {
	return ts - ts%bucketSeconds
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
