package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// planRatios 下发给购买弹窗的两档倍率，必须与 service.switchRatioForFundingFallback
// 的实际切换行为一致：订阅期间取 GroupGroupRatio[组][组]，回落钱包后取 GroupRatio[组]。
// 弹窗里的数字若与真实计费不符，等于在付款页面给用户看错误承诺。
func TestPlanRatios(t *testing.T) {
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"gpt_month":0.2,"plain_group":0.5}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(
		`{"gpt_month":{"gpt_month":1}}`))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`)
	})

	cases := []struct {
		name         string
		group        string
		wantSub      float64
		wantFallback float64
	}{
		{
			// 线上 Codex_GPT_PRO 的形态：订阅期间 1x，额度用尽回落钱包按 0.2x
			name: "配了特殊倍率的订阅分组", group: "gpt_month",
			wantSub: 1, wantFallback: 0.2,
		},
		{
			// 没配 GroupGroupRatio → 回落时倍率不切换，两档相同
			name: "只配常规倍率", group: "plain_group",
			wantSub: 0.5, wantFallback: 0.5,
		},
		{
			// 套餐不升级分组，没有「订阅分组倍率」这个概念
			name: "套餐不升级分组", group: "",
			wantSub: -1, wantFallback: -1,
		},
		{
			name: "空白字符视同不升级分组", group: "   ",
			wantSub: -1, wantFallback: -1,
		},
		{
			// 分组名写错或倍率配置被删：返回 -1 让前端隐藏该行，
			// 而不是显示 GetGroupRatio 兜底的 1x（那会误导用户）
			name: "分组未配置任何倍率", group: "no_such_group",
			wantSub: -1, wantFallback: -1,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sub, fallback := planRatios(c.group)
			assert.Equal(t, c.wantSub, sub, "订阅期间倍率")
			assert.Equal(t, c.wantFallback, fallback, "回落钱包后倍率")
		})
	}
}
