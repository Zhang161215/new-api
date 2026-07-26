package operation_setting

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/require"
)

// 验证配置已注册到 GlobalConfig，且能通过后台选项键 "prompt_audit_setting.<字段>" 热更新
func TestPromptAuditSetting_RegisteredAndUpdatable(t *testing.T) {
	cfg := config.GlobalConfig.Get("prompt_audit_setting")
	require.NotNil(t, cfg, "prompt_audit_setting 必须已注册，否则后台无法配置")

	saved := *GetPromptAuditSetting()
	t.Cleanup(func() { *GetPromptAuditSetting() = saved })

	require.NoError(t, config.UpdateConfigFromMap(cfg, map[string]string{
		"enabled":         "true",
		"blocking":        "true",
		"base_url":        "https://api.deepseek.com",
		"model":           "deepseek-v4-flash",
		"threshold":       "0.75",
		"timeout_ms":      "5000",
		"max_input_chars": "6000",
		"fail_open":       "false",
	}))

	got := GetPromptAuditSetting()
	require.True(t, got.Enabled)
	require.True(t, got.Blocking)
	require.Equal(t, "https://api.deepseek.com", got.BaseURL)
	require.Equal(t, "deepseek-v4-flash", got.Model)
	require.InDelta(t, 0.75, got.Threshold, 1e-9)
	require.Equal(t, 5000, got.TimeoutMs)
	require.Equal(t, 6000, got.MaxInputChars)
	require.False(t, got.FailOpen)
}

// 导出时字段名必须与后台选项键一致
func TestPromptAuditSetting_ExportedKeys(t *testing.T) {
	all := config.GlobalConfig.ExportAllConfigs()
	for _, key := range []string{
		"prompt_audit_setting.enabled",
		"prompt_audit_setting.blocking",
		"prompt_audit_setting.base_url",
		"prompt_audit_setting.api_key",
		"prompt_audit_setting.model",
		"prompt_audit_setting.threshold",
		"prompt_audit_setting.timeout_ms",
		"prompt_audit_setting.max_input_chars",
		"prompt_audit_setting.fail_open",
		"prompt_audit_setting.system_prompt",
	} {
		_, ok := all[key]
		require.True(t, ok, "缺少可配置项 %s", key)
	}
}

// 未自定义提示词时应回退到内置不可变提示词
func TestPromptAuditSetting_GetPrompt(t *testing.T) {
	s := &PromptAuditSetting{}
	require.Equal(t, PromptAuditImmutablePrompt, s.GetPrompt())
	require.Contains(t, s.GetPrompt(), "<user_input>")

	s.SystemPrompt = "自定义审核提示词"
	require.Equal(t, "自定义审核提示词", s.GetPrompt())
}

func TestPromptAuditSetting_GroupWhitelist(t *testing.T) {
	s := &PromptAuditSetting{}
	// 留空：审核所有分组
	require.Empty(t, s.GroupList())
	require.True(t, s.ShouldAuditGroup("default"))
	require.True(t, s.ShouldAuditGroup(""))

	// 指定白名单：只审核名单内分组
	s.Groups = "default, Codex_GPT ,Claude_Aws"
	require.Equal(t, []string{"default", "Codex_GPT", "Claude_Aws"}, s.GroupList())
	require.True(t, s.ShouldAuditGroup("default"))
	require.True(t, s.ShouldAuditGroup("Codex_GPT"))
	require.True(t, s.ShouldAuditGroup("Claude_Aws"))
	require.False(t, s.ShouldAuditGroup("Gemini_Google"))
	require.False(t, s.ShouldAuditGroup(""))

	// 全是空白/逗号时视为不限制
	s.Groups = " , , "
	require.Empty(t, s.GroupList())
	require.True(t, s.ShouldAuditGroup("anything"))
}

func TestPromptAuditSetting_SampleRate(t *testing.T) {
	s := &PromptAuditSetting{}
	// 0 / 负数 / >=100 都视为全量，避免误配成 0 导致完全不审核
	for _, v := range []int{0, -1, 100, 150} {
		s.SampleRate = v
		require.Equal(t, 100, s.EffectiveSampleRate(), "SampleRate=%d", v)
		require.True(t, s.ShouldSample())
	}
	// 正常区间原样返回
	s.SampleRate = 20
	require.Equal(t, 20, s.EffectiveSampleRate())

	// 抽样命中率应大致贴合设定比例（1000 次采样，容忍统计波动）
	s.SampleRate = 30
	hit := 0
	for i := 0; i < 1000; i++ {
		if s.ShouldSample() {
			hit++
		}
	}
	require.InDelta(t, 300, hit, 70, "30%% 抽样 1000 次命中数应接近 300，实际 %d", hit)

	// 1% 也要能工作（不能因取整变成 0 或全量）
	s.SampleRate = 1
	hit = 0
	for i := 0; i < 2000; i++ {
		if s.ShouldSample() {
			hit++
		}
	}
	require.Greater(t, hit, 0, "1%% 抽样不应完全不命中")
	require.Less(t, hit, 200, "1%% 抽样不应接近全量")
}

func TestPromptAuditNotifyEmailList(t *testing.T) {
	s := &PromptAuditSetting{}
	// 留空
	require.Empty(t, s.NotifyEmailList())
	// 逗号、分号、空格、换行混排都要能切开，且去掉空项
	s.NotifyEmail = " a@x.com, b@y.com ;; c@z.com\nd@w.com "
	require.Equal(t, []string{"a@x.com", "b@y.com", "c@z.com", "d@w.com"}, s.NotifyEmailList())
}

func TestPromptAuditEffectiveNotifyThreshold(t *testing.T) {
	s := &PromptAuditSetting{Threshold: 0.6}
	// 未单独设置时回落到拦截阈值
	require.Equal(t, 0.6, s.EffectiveNotifyThreshold())
	// 单独设置后以它为准（可高于拦截阈值，只对高危告警）
	s.NotifyThreshold = 0.9
	require.Equal(t, 0.9, s.EffectiveNotifyThreshold())
}

func TestPromptAuditShouldNotify(t *testing.T) {
	s := &PromptAuditSetting{Threshold: 0.6}

	// 总开关关闭时一律不通知
	require.False(t, s.ShouldNotify(1.0, true))

	s.NotifyEnabled = true
	require.True(t, s.ShouldNotify(0.6, false), "达到阈值即通知")
	require.False(t, s.ShouldNotify(0.59, false), "低于阈值不通知")

	// 只对高危告警
	s.NotifyThreshold = 0.9
	require.False(t, s.ShouldNotify(0.7, true), "高于拦截阈值但低于通知阈值不通知")
	require.True(t, s.ShouldNotify(0.95, true))

	// 仅拦截时通知：观察模式的命中要被过滤掉
	s.NotifyBlockedOnly = true
	require.False(t, s.ShouldNotify(0.95, false))
	require.True(t, s.ShouldNotify(0.95, true))
}

func TestPromptAuditCacheTTL(t *testing.T) {
	s := &PromptAuditSetting{}
	// <=0 表示关闭缓存
	require.Zero(t, s.CacheTTL())
	s.CacheTTLSec = -5
	require.Zero(t, s.CacheTTL())

	s.CacheTTLSec = 3600
	require.Equal(t, time.Hour, s.CacheTTL())
}

func TestPromptAuditEffectiveScopeMessages(t *testing.T) {
	s := &PromptAuditSetting{}
	// 未配置/非法值回落到 4，避免配成 0 导致 recent 模式什么都不回溯
	require.Equal(t, 4, s.EffectiveScopeMessages())
	s.ScopeMessages = -1
	require.Equal(t, 4, s.EffectiveScopeMessages())

	s.ScopeMessages = 8
	require.Equal(t, 8, s.EffectiveScopeMessages())
}

func TestPromptAuditNewKeysExported(t *testing.T) {
	all := config.GlobalConfig.ExportAllConfigs()
	for _, key := range []string{
		"prompt_audit_setting.cache_ttl_sec",
		"prompt_audit_setting.audit_scope",
		"prompt_audit_setting.scope_messages",
		"prompt_audit_setting.retention_days",
		"prompt_audit_setting.notify_enabled",
		"prompt_audit_setting.notify_email",
	} {
		_, ok := all[key]
		require.True(t, ok, "缺少可配置项 %s", key)
	}
}

func TestPromptAuditPromptStorage(t *testing.T) {
	s := &PromptAuditSetting{}
	// 未配置时保持旧行为：全量留存，升级不改变既有语义
	require.Equal(t, PromptAuditStorageAll, s.GetPromptStorage())
	require.True(t, s.ShouldStorePrompt(true))
	require.True(t, s.ShouldStorePrompt(false))

	// 非法值同样回落到 all，不能因误配就悄悄丢掉命中证据
	s.PromptStorage = "乱填的"
	require.Equal(t, PromptAuditStorageAll, s.GetPromptStorage())
	require.True(t, s.ShouldStorePrompt(false))

	// 只留命中的：合规请求不落原文
	s.PromptStorage = PromptAuditStorageHitOnly
	require.True(t, s.ShouldStorePrompt(true), "命中必须留证据")
	require.False(t, s.ShouldStorePrompt(false), "合规请求不该留用户原文")

	// 一律不留
	s.PromptStorage = PromptAuditStorageNone
	require.False(t, s.ShouldStorePrompt(true))
	require.False(t, s.ShouldStorePrompt(false))
}
