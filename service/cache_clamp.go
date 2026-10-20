package service

import "strings"

const (
	defaultBilledInputCap = 200_000
	maxBilledInputCap     = 1_000_000
)

// billedInputTokenCap 是 Claude 语义下「新输入 + cache 读 + cache 写」的计费上限。
// 取本次请求 prompt 估算和模型上下文上限的较小值，避免 kiro 等模拟缓存把几百万写入当真实 cache 扣费。
func billedInputTokenCap(model string, estimatePrompt int) int {
	capN := defaultBilledInputCap
	if modelHasMillionContext(model) {
		capN = maxBilledInputCap
	}
	if estimatePrompt > 0 && estimatePrompt < capN {
		return estimatePrompt
	}
	return capN
}

func modelHasMillionContext(model string) bool {
	lower := strings.ToLower(model)
	needles := []string{
		"claude-opus-4", "claude-opus-5", "claude-sonnet-4", "claude-sonnet-5",
		"claude-haiku-4", "claude-haiku-5", "claude-fable",
		"gpt-4.1", "gpt-5",
		"gemini-1.5", "gemini-2",
	}
	for _, n := range needles {
		if strings.Contains(lower, n) {
			return true
		}
	}
	return false
}

func atLeastZero(n int) int {
	if n < 0 {
		return 0
	}
	return n
}

// clampClaudeCacheToInputCap 把 cache 读/写压进 cap。先砍写入（1.25x），再砍读取。
// prompt 视为上游未缓存输入，不在这里改小。
func clampClaudeCacheToInputCap(s *textQuotaSummary, cap int) bool {
	if s == nil || cap <= 0 {
		return false
	}
	prompt := atLeastZero(s.PromptTokens)
	read := atLeastZero(s.CacheTokens)
	write := atLeastZero(s.CacheCreationTokens)
	five := atLeastZero(s.CacheCreationTokens5m)
	one := atLeastZero(s.CacheCreationTokens1h)
	if split := five + one; split > write {
		write = split
	}
	total := prompt + read + write
	if total <= cap {
		return false
	}

	s.CacheReadBeforeClamp = read
	s.CacheCreationBeforeClamp = write

	overflow := total - cap
	if write >= overflow {
		write -= overflow
	} else {
		overflow -= write
		write = 0
		if read > overflow {
			read -= overflow
		} else {
			read = 0
		}
	}
	if five+one > write {
		if five > write {
			five = write
			one = 0
		} else {
			one = write - five
		}
	}

	s.CacheTokens = read
	s.CacheCreationTokens = write
	s.CacheCreationTokens5m = five
	s.CacheCreationTokens1h = one
	s.CacheClamped = true
	s.CacheClampCap = cap
	return true
}
