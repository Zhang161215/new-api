package perfmetrics

import "sync/atomic"

// Sample 一次请求（跨所有重试）的最终结果，在请求边界只采一次。
type Sample struct {
	Model        string
	Group        string
	LatencyMs    int64
	TtftMs       int64
	HasTtft      bool
	Success      bool
	OutputTokens int64
	GenerationMs int64
}

type bucketKey struct {
	model    string
	group    string
	bucketTs int64
}

type counters struct {
	requestCount   int64
	successCount   int64
	totalLatencyMs int64
	ttftSumMs      int64
	ttftCount      int64
	outputTokens   int64
	generationMs   int64
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

type atomicBucket struct {
	requestCount   atomic.Int64
	successCount   atomic.Int64
	totalLatencyMs atomic.Int64
	ttftSumMs      atomic.Int64
	ttftCount      atomic.Int64
	outputTokens   atomic.Int64
	generationMs   atomic.Int64
}

func (b *atomicBucket) add(sample Sample) {
	b.requestCount.Add(1)
	if sample.Success {
		b.successCount.Add(1)
	}
	if sample.LatencyMs > 0 {
		b.totalLatencyMs.Add(sample.LatencyMs)
	}
	if sample.HasTtft && sample.TtftMs >= 0 {
		b.ttftSumMs.Add(sample.TtftMs)
		b.ttftCount.Add(1)
	}
	if sample.OutputTokens > 0 && sample.GenerationMs > 0 {
		b.outputTokens.Add(sample.OutputTokens)
		b.generationMs.Add(sample.GenerationMs)
	}
}

func (b *atomicBucket) snapshot() counters {
	return counters{
		requestCount:   b.requestCount.Load(),
		successCount:   b.successCount.Load(),
		totalLatencyMs: b.totalLatencyMs.Load(),
		ttftSumMs:      b.ttftSumMs.Load(),
		ttftCount:      b.ttftCount.Load(),
		outputTokens:   b.outputTokens.Load(),
		generationMs:   b.generationMs.Load(),
	}
}

func (b *atomicBucket) drain() counters {
	return counters{
		requestCount:   b.requestCount.Swap(0),
		successCount:   b.successCount.Swap(0),
		totalLatencyMs: b.totalLatencyMs.Swap(0),
		ttftSumMs:      b.ttftSumMs.Swap(0),
		ttftCount:      b.ttftCount.Swap(0),
		outputTokens:   b.outputTokens.Swap(0),
		generationMs:   b.generationMs.Swap(0),
	}
}

func (b *atomicBucket) addCounters(c counters) {
	b.requestCount.Add(c.requestCount)
	b.successCount.Add(c.successCount)
	b.totalLatencyMs.Add(c.totalLatencyMs)
	b.ttftSumMs.Add(c.ttftSumMs)
	b.ttftCount.Add(c.ttftCount)
	b.outputTokens.Add(c.outputTokens)
	b.generationMs.Add(c.generationMs)
}
