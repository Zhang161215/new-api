package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func baseCfg() *PromptAuditSetting {
	return &PromptAuditSetting{
		BaseURL: "https://api.deepseek.com",
		APIKey:  "sk-primary",
		Model:   "deepseek-v4-flash",
	}
}

func TestShouldDisableThinkingAuto(t *testing.T) {
	c := baseCfg()
	c.DisableThinking = PromptAuditThinkingAuto

	// 已知推理模型都要关思考，否则 token 被推理吃光、裁决 JSON 被截断
	for _, m := range []string{
		"deepseek-v4-flash", "DeepSeek-V4-Pro",
		"mimo-v2.5", "mimo-v2.5-pro",
		"qwen-max", "glm-4.7", "kimi-k2",
		"some-thinking-model", "reasoner-x",
	} {
		assert.True(t, c.ShouldDisableThinking(m), "应关闭思考: %s", m)
	}

	// 非推理模型不带该参数，避免网关因不认参数报 400
	for _, m := range []string{"gpt-4o-mini", "claude-haiku-4-5", "gemini-3-flash"} {
		assert.False(t, c.ShouldDisableThinking(m), "不应关闭思考: %s", m)
	}
}

func TestShouldDisableThinkingAlwaysNever(t *testing.T) {
	c := baseCfg()

	c.DisableThinking = PromptAuditThinkingAlways
	assert.True(t, c.ShouldDisableThinking("gpt-4o-mini"))
	assert.True(t, c.ShouldDisableThinking("mimo-v2.5"))

	c.DisableThinking = PromptAuditThinkingNever
	assert.False(t, c.ShouldDisableThinking("mimo-v2.5"))
	assert.False(t, c.ShouldDisableThinking("deepseek-v4-flash"))

	// 未配置时按 auto 处理（保持旧行为，deepseek 仍会关思考）
	c.DisableThinking = ""
	assert.True(t, c.ShouldDisableThinking("deepseek-v4-flash"))
	assert.False(t, c.ShouldDisableThinking("gpt-4o-mini"))
}

func TestFallbackReady(t *testing.T) {
	c := baseCfg()

	// 未开开关
	c.FallbackEnabled = false
	c.FallbackModel = "mimo-v2.5"
	assert.False(t, c.FallbackReady())

	// 开了但没填模型
	c.FallbackEnabled = true
	c.FallbackModel = ""
	assert.False(t, c.FallbackReady())
	c.FallbackModel = "   "
	assert.False(t, c.FallbackReady())

	// 同址同模型等于没有备用，必须判定为不可用，否则只是把同一节点再打一次
	c.FallbackModel = "deepseek-v4-flash"
	c.FallbackBaseURL = ""
	assert.False(t, c.FallbackReady())
	c.FallbackBaseURL = "https://api.deepseek.com"
	assert.False(t, c.FallbackReady())

	// 同址不同模型：可用
	c.FallbackBaseURL = ""
	c.FallbackModel = "deepseek-v4-pro"
	assert.True(t, c.FallbackReady())

	// 不同址：可用
	c.FallbackBaseURL = "https://token-plan-cn.xiaomimimo.com/v1"
	c.FallbackModel = "mimo-v2.5"
	assert.True(t, c.FallbackReady())
}

func TestFallbackConfigInheritsAndIsolates(t *testing.T) {
	c := baseCfg()
	c.TimeoutMs = 8000
	c.Threshold = 0.6
	c.FallbackEnabled = true
	c.FallbackModel = "mimo-v2.5"

	// 未单独配置 URL/Key 时沿用主节点
	fb := c.FallbackConfig()
	assert.Equal(t, "mimo-v2.5", fb.Model)
	assert.Equal(t, "https://api.deepseek.com", fb.BaseURL)
	assert.Equal(t, "sk-primary", fb.APIKey)
	assert.Equal(t, 8000, fb.TimeoutMs, "其余字段应继承主节点")
	assert.Equal(t, 0.6, fb.Threshold)

	// 备用节点自身不得再触发回退，否则会递归
	assert.False(t, fb.FallbackEnabled)
	assert.False(t, fb.FallbackReady())

	// 单独配置时以备用值为准
	c.FallbackBaseURL = "https://token-plan-cn.xiaomimimo.com/v1"
	c.FallbackAPIKey = "tp-fallback"
	fb = c.FallbackConfig()
	assert.Equal(t, "https://token-plan-cn.xiaomimimo.com/v1", fb.BaseURL)
	assert.Equal(t, "tp-fallback", fb.APIKey)

	// 不能污染原配置
	assert.Equal(t, "deepseek-v4-flash", c.Model)
	assert.Equal(t, "https://api.deepseek.com", c.BaseURL)
	assert.Equal(t, "sk-primary", c.APIKey)
	assert.True(t, c.FallbackEnabled)
}

func TestFallbackConfigDefaultsPreserveOldBehavior(t *testing.T) {
	// 默认不开回退，保证升级后行为与旧版一致
	assert.False(t, promptAuditSetting.FallbackEnabled)
	assert.Equal(t, "", promptAuditSetting.FallbackModel)
	assert.Equal(t, PromptAuditThinkingAuto, promptAuditSetting.DisableThinking)
	assert.False(t, promptAuditSetting.FallbackReady())
}

func autoBanCfg() *PromptAuditSetting {
	c := baseCfg()
	c.Threshold = 0.6
	c.AutoBanEnabled = true
	c.AutoBanThreshold = 5
	c.AutoBanWindowMin = 60
	c.AutoBanExemptAdmin = true
	return c
}

func TestAutoBanReady(t *testing.T) {
	c := autoBanCfg()
	assert.True(t, c.AutoBanReady())

	c.AutoBanEnabled = false
	assert.False(t, c.AutoBanReady(), "开关关闭时不可用")

	c.AutoBanEnabled = true
	c.AutoBanThreshold = 0
	assert.False(t, c.AutoBanReady(), "阈值为 0 不可用，避免误配成一次命中就封")
	c.AutoBanThreshold = -1
	assert.False(t, c.AutoBanReady())
}

func TestAutoBanDefaultsAreSafe(t *testing.T) {
	// 封号不可逆，默认必须全关且干跑，升级后不能凭空开始封人
	assert.False(t, promptAuditSetting.AutoBanEnabled)
	assert.True(t, promptAuditSetting.AutoBanDryRun, "默认应为干跑")
	assert.True(t, promptAuditSetting.AutoBanExemptAdmin, "默认应豁免管理员")
	assert.False(t, promptAuditSetting.AutoBanReady())
}

func TestEffectiveAutoBanWindowAndConfidence(t *testing.T) {
	c := autoBanCfg()
	assert.Equal(t, 60, c.EffectiveAutoBanWindowMin())
	c.AutoBanWindowMin = 0
	assert.Equal(t, 60, c.EffectiveAutoBanWindowMin(), "0 应回落 60 而不是不限时间")
	c.AutoBanWindowMin = -5
	assert.Equal(t, 60, c.EffectiveAutoBanWindowMin())
	c.AutoBanWindowMin = 1440
	assert.Equal(t, 1440, c.EffectiveAutoBanWindowMin())

	// 未单独配置时用拦截阈值：即"被拦下来的才算一次"
	c.AutoBanMinConfidence = 0
	assert.Equal(t, 0.6, c.EffectiveAutoBanMinConfidence())
	c.AutoBanMinConfidence = 0.9
	assert.Equal(t, 0.9, c.EffectiveAutoBanMinConfidence())
}

func TestAutoBanExemptUsers(t *testing.T) {
	c := autoBanCfg()
	c.AutoBanExemptUsers = "vipuser, BigClient;ing\nfoo"

	for _, u := range []string{"vipuser", "BigClient", "ing", "foo"} {
		assert.True(t, c.IsAutoBanExemptUser(u), "应豁免: %s", u)
	}
	// 大小写不敏感，避免大小写差异导致大客户被误封
	assert.True(t, c.IsAutoBanExemptUser("VIPUSER"))
	assert.True(t, c.IsAutoBanExemptUser("bigclient"))
	// 非白名单
	assert.False(t, c.IsAutoBanExemptUser("someoneelse"))
	assert.False(t, c.IsAutoBanExemptUser(""))
	// 不能因为是子串就豁免
	assert.False(t, c.IsAutoBanExemptUser("ing2"))
	assert.False(t, c.IsAutoBanExemptUser("testing"))
}

func TestCountsTowardAutoBan(t *testing.T) {
	c := autoBanCfg()

	// 达阈值且被拦：计入
	assert.True(t, c.CountsTowardAutoBan(0.95, true))
	assert.True(t, c.CountsTowardAutoBan(0.6, true), "恰好等于阈值应计入")

	// 影子模式命中但未拦截：不计入，否则观察模式会悄悄封人
	assert.False(t, c.CountsTowardAutoBan(0.95, false))

	// 置信度不足
	assert.False(t, c.CountsTowardAutoBan(0.3, true))
	// 审核失败的哨兵负值绝不能计入
	assert.False(t, c.CountsTowardAutoBan(-1, true))

	// 未启用时一律不计入
	c.AutoBanEnabled = false
	assert.False(t, c.CountsTowardAutoBan(0.95, true))

	// 单独调高封号门槛：只让确定无疑的命中参与计数
	c = autoBanCfg()
	c.AutoBanMinConfidence = 0.9
	assert.True(t, c.CountsTowardAutoBan(0.95, true))
	assert.False(t, c.CountsTowardAutoBan(0.7, true), "低于封号门槛但高于拦截阈值时只拦不计数")
}
