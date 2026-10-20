package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBilledInputTokenCap(t *testing.T) {
	require.Equal(t, 200_000, billedInputTokenCap("claude-3-7-sonnet", 0))
	require.Equal(t, 50_000, billedInputTokenCap("claude-3-7-sonnet", 50_000))
	require.Equal(t, 1_000_000, billedInputTokenCap("claude-opus-5-5", 9_087_278))
	require.Equal(t, 400_000, billedInputTokenCap("claude-opus-5-5", 400_000))
	require.Equal(t, 1_000_000, billedInputTokenCap("claude-sonnet-4-5", 0))
}

func TestClampClaudeCacheToInputCap_ZcgKiroInflatedWrite(t *testing.T) {
	s := &textQuotaSummary{
		PromptTokens:        255,
		CacheTokens:         0,
		CacheCreationTokens: 5_631_130,
	}
	require.True(t, clampClaudeCacheToInputCap(s, 1_000_000))
	require.Equal(t, 255, s.PromptTokens)
	require.Equal(t, 0, s.CacheTokens)
	require.Equal(t, 999_745, s.CacheCreationTokens)
	require.Equal(t, 5_631_130, s.CacheCreationBeforeClamp)
	require.Equal(t, 1_000_000, s.CacheClampCap)
}

func TestClampClaudeCacheToInputCap_EstimateSmallerThanModelCap(t *testing.T) {
	s := &textQuotaSummary{
		PromptTokens:        255,
		CacheCreationTokens: 5_631_130,
	}
	capN := billedInputTokenCap("claude-opus-5-5", 50_000)
	require.Equal(t, 50_000, capN)
	require.True(t, clampClaudeCacheToInputCap(s, capN))
	require.Equal(t, 49_745, s.CacheCreationTokens)
}

func TestClampClaudeCacheToInputCap_WithinCapUnchanged(t *testing.T) {
	s := &textQuotaSummary{
		PromptTokens:        1_000,
		CacheTokens:         20_000,
		CacheCreationTokens: 3_000,
	}
	require.False(t, clampClaudeCacheToInputCap(s, 200_000))
	require.Equal(t, 20_000, s.CacheTokens)
	require.Equal(t, 3_000, s.CacheCreationTokens)
	require.False(t, s.CacheClamped)
}

func TestClampClaudeCacheToInputCap_ReducesWriteThenRead(t *testing.T) {
	s := &textQuotaSummary{
		PromptTokens:        1_848,
		CacheTokens:         5_068_017,
		CacheCreationTokens: 563_113,
	}
	require.True(t, clampClaudeCacheToInputCap(s, 1_000_000))
	require.Equal(t, 0, s.CacheCreationTokens)
	require.Equal(t, 998_152, s.CacheTokens)
	require.Equal(t, 1_848+998_152, 1_000_000)
}

func TestClampClaudeCacheToInputCap_ShrinksSplitCreation(t *testing.T) {
	s := &textQuotaSummary{
		PromptTokens:          100,
		CacheCreationTokens:   50_000,
		CacheCreationTokens5m: 40_000,
		CacheCreationTokens1h: 10_000,
	}
	require.True(t, clampClaudeCacheToInputCap(s, 1_000))
	require.Equal(t, 900, s.CacheCreationTokens)
	require.Equal(t, 900, s.CacheCreationTokens5m)
	require.Equal(t, 0, s.CacheCreationTokens1h)
}
