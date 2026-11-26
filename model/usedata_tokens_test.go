package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDashboardInputTokens(t *testing.T) {
	claude := NewLogOther()
	claude.SetPublic("claude", true)
	anthropic := NewLogOther()
	anthropic.SetPublic("usage_semantic", "anthropic")
	openai := NewLogOther()
	openai.SetPublic("cache_tokens", 300)

	p := RecordConsumeLogParams{PromptTokens: 100, CompletionTokens: 20}
	require.Equal(t, 100+300+40, dashboardInputTokens(p, claude, 300, 40))
	require.Equal(t, 100+300+40, dashboardInputTokens(p, anthropic, 300, 40))
	// OpenAI / Gemini 的 prompt 已含缓存
	require.Equal(t, 100, dashboardInputTokens(p, openai, 300, 40))
	require.Equal(t, 100, dashboardInputTokens(p, nil, 300, 40))
	// 结算路径给出的确切值优先
	p.InputTokensTotal = 999
	require.Equal(t, 999, dashboardInputTokens(p, openai, 300, 40))
}

// 看板缓存聚合与落库都要带上输入 / 输出两列（PG / MySQL 的建列与查询见 br-work/dbmatrix-dash.sh）。
func TestQuotaDataInputOutputAggregateAndPersist(t *testing.T) {
	truncateTables(t)
	CacheQuotaDataLock.Lock()
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()

	base := QuotaDataLogParams{UserID: 9, Username: "u9", ModelName: "m", CreatedAt: 7200 + 10, Quota: 5,
		TokenUsed: 150, InputTokens: 120, OutputTokens: 30, CacheReadTokens: 100, CacheCreationTokens: 10}
	LogQuotaData(base)
	LogQuotaData(base)
	SaveQuotaDataCache()
	LogQuotaData(base) // 第二次落库走 increaseQuotaData
	SaveQuotaDataCache()

	rows, err := GetQuotaDataByUserId(9, 0, 1<<40)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, 3, rows[0].Count)
	require.Equal(t, 450, rows[0].TokenUsed)
	require.EqualValues(t, 360, rows[0].InputTokens)
	require.EqualValues(t, 90, rows[0].OutputTokens)
	require.EqualValues(t, 300, rows[0].CacheReadTokens)

	all, err := GetAllQuotaDates(0, 1<<40, "")
	require.NoError(t, err)
	require.Len(t, all, 1)
	require.EqualValues(t, 360, all[0].InputTokens)
	byUser, err := GetQuotaDataGroupByUser(0, 1<<40)
	require.NoError(t, err)
	require.Len(t, byUser, 1)
	require.EqualValues(t, 90, byUser[0].OutputTokens)
}
