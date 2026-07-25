package operation_setting

import (
	"testing"

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
