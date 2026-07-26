package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/require"
)

func clearAuditMemCache() {
	promptAuditMemCache.Range(func(k, _ any) bool {
		promptAuditMemCache.Delete(k)
		return true
	})
	ResetPromptAuditCacheStats()
}

func TestPromptAuditCacheKeyVariesWithConfig(t *testing.T) {
	base := &operation_setting.PromptAuditSetting{Model: "deepseek-v4-flash"}
	k1 := promptAuditCacheKey(base, "hello")

	// 相同输入 + 相同配置 → 同一个键（否则永远不会命中）
	require.Equal(t, k1, promptAuditCacheKey(base, "hello"))

	// 换输入 → 换键
	require.NotEqual(t, k1, promptAuditCacheKey(base, "hello world"))

	// 换模型 → 换键，旧判定自动失效
	other := *base
	other.Model = "deepseek-v4-pro"
	require.NotEqual(t, k1, promptAuditCacheKey(&other, "hello"))

	// 换系统提示词 → 换键，改了审核标准不能还用旧结论
	custom := *base
	custom.SystemPrompt = "另一套判定标准"
	require.NotEqual(t, k1, promptAuditCacheKey(&custom, "hello"))
}

func TestPromptAuditVerdictEncodeDecode(t *testing.T) {
	conf, reason, ok := decodePromptAuditVerdict(encodePromptAuditVerdict(0.95, "爆破他人SSH"))
	require.True(t, ok)
	require.Equal(t, 0.95, conf)
	require.Equal(t, "爆破他人SSH", reason)

	// 理由本身含分隔符也要能正确还原
	conf, reason, ok = decodePromptAuditVerdict(encodePromptAuditVerdict(0.3, "a|b|c"))
	require.True(t, ok)
	require.Equal(t, 0.3, conf)
	require.Equal(t, "a|b|c", reason)

	// 合规判定理由为空是常态
	conf, reason, ok = decodePromptAuditVerdict(encodePromptAuditVerdict(0, ""))
	require.True(t, ok)
	require.Equal(t, 0.0, conf)
	require.Equal(t, "", reason)

	// 脏数据不能当成置信度 0 的合规判定放行
	_, _, ok = decodePromptAuditVerdict("garbage")
	require.False(t, ok)
	_, _, ok = decodePromptAuditVerdict("notafloat|reason")
	require.False(t, ok)
}

func TestPromptAuditCacheSetGet(t *testing.T) {
	clearAuditMemCache()
	key := "prompt_audit_verdict:test-set-get"

	_, _, ok := getPromptAuditCache(key)
	require.False(t, ok, "未写入前不应命中")

	setPromptAuditCache(key, 0.95, "违规", time.Minute)
	conf, reason, ok := getPromptAuditCache(key)
	require.True(t, ok)
	require.Equal(t, 0.95, conf)
	require.Equal(t, "违规", reason)
}

func TestPromptAuditCacheExpires(t *testing.T) {
	clearAuditMemCache()
	key := "prompt_audit_verdict:test-expire"

	setPromptAuditCache(key, 0.9, "x", 10*time.Millisecond)
	_, _, ok := getPromptAuditCache(key)
	require.True(t, ok)

	time.Sleep(30 * time.Millisecond)
	_, _, ok = getPromptAuditCache(key)
	require.False(t, ok, "过期后必须重新送审，不能永久沿用旧判定")
}

func TestPromptAuditCacheTTLZeroDisables(t *testing.T) {
	clearAuditMemCache()
	key := "prompt_audit_verdict:test-zero-ttl"

	// TTL <=0 表示关闭缓存，不应写入任何东西
	setPromptAuditCache(key, 0.95, "x", 0)
	_, _, ok := getPromptAuditCache(key)
	require.False(t, ok)
}

func TestPromptAuditCacheStats(t *testing.T) {
	clearAuditMemCache()

	recordPromptAuditCacheStat(true)
	recordPromptAuditCacheStat(true)
	recordPromptAuditCacheStat(true)
	recordPromptAuditCacheStat(false)

	hit, miss, rate := GetPromptAuditCacheStats()
	require.Equal(t, int64(3), hit)
	require.Equal(t, int64(1), miss)
	require.InDelta(t, 0.75, rate, 1e-9)

	ResetPromptAuditCacheStats()
	hit, miss, rate = GetPromptAuditCacheStats()
	require.Zero(t, hit)
	require.Zero(t, miss)
	require.Zero(t, rate, "无样本时不应除零得出 NaN")
}
