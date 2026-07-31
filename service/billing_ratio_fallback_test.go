package service

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 复用 billing_cross_group_test.go 的 TestMain / seed* / makeRelayInfo。

// setRatios 配置 GroupRatio[group]=normal 与 GroupGroupRatio[group][group]=special，
// 对应线上「订阅分组用自己的令牌时套用特殊倍率」的配置形态。
func setRatios(t *testing.T, group string, normal, special float64) {
	t.Helper()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		fmt.Sprintf(`{%q:%v}`, group, normal)))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(
		fmt.Sprintf(`{%q:{%q:%v}}`, group, group, special)))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`)
	})
}

// 订阅额度耗尽回落钱包时，必须把订阅专用的特殊倍率降回常规分组倍率，
// 并按比例缩放预扣费额度。
// 回归背景：倍率在 relay/helper/price.go 里就锁定成特殊倍率（如 1），
// 额度耗尽后回落钱包仍按 1 倍扣，比常规 0.2 倍贵 5 倍。
func TestSubscriptionExhausted_FallbackWallet_RestoresNormalGroupRatio(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setRatios(t, "gpt_month", 0.2, 1)

	const userID, tokenID, planID, subID = 2101, 2101, 191, 91
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-ratio-1", 5_000_000)
	seedPlan(t, planID, "gpt_month")
	// 订阅额度 1000，已用 1000 → 已耗尽
	seedSubWithGroup(t, subID, userID, planID, "gpt_month", 1000, 1000, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-ratio-1", "gpt_month", "gpt_month", "subscription_first")
	// 模拟 HandleGroupRatio 已套用特殊倍率 1
	ri.PriceData.GroupRatioInfo = types.GroupRatioInfo{
		GroupRatio:        1,
		GroupSpecialRatio: 1,
		HasSpecialRatio:   true,
	}

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)

	// 订阅额度耗尽 → 回落钱包
	assert.Equal(t, BillingSourceWallet, session.funding.Source())

	// 关键断言：倍率已降回常规 0.2，且不再标记为特殊倍率
	assert.Equal(t, 0.2, ri.PriceData.GroupRatioInfo.GroupRatio,
		"回落钱包后必须使用常规分组倍率，否则用户被按订阅倍率扣钱包")
	assert.False(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)

	// 预扣费按 0.2/1 缩放：1000 → 200
	assert.Equal(t, 200, session.GetPreConsumedQuota(),
		"预扣费需同比缩放，否则钱包够付 0.2 倍却不够 1 倍的用户会被误拒")
}

// 订阅额度充足时走订阅，倍率必须保持特殊倍率（1:1 消耗订阅额度）。
func TestSubscriptionAvailable_KeepsSpecialRatio(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setRatios(t, "gpt_month", 0.2, 1)

	const userID, tokenID, planID, subID = 2102, 2102, 192, 92
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-ratio-2", 5_000_000)
	seedPlan(t, planID, "gpt_month")
	seedSubWithGroup(t, subID, userID, planID, "gpt_month", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-ratio-2", "gpt_month", "gpt_month", "subscription_first")
	ri.PriceData.GroupRatioInfo = types.GroupRatioInfo{
		GroupRatio:        1,
		GroupSpecialRatio: 1,
		HasSpecialRatio:   true,
	}

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())

	// 走订阅时倍率不能被改动
	assert.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"走订阅时必须保持特殊倍率，否则订阅额度消耗速度不符合套餐定价")
	assert.True(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 1000, session.GetPreConsumedQuota())
}

// 未套用特殊倍率的用户（普通分组）回落钱包时不应被改动。
func TestSubscriptionExhausted_NoSpecialRatio_Untouched(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	// 只配常规倍率，不配 GroupGroupRatio
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"gpt_month":0.2}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`))

	const userID, tokenID, planID, subID = 2103, 2103, 193, 93
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-ratio-3", 5_000_000)
	seedPlan(t, planID, "gpt_month")
	seedSubWithGroup(t, subID, userID, planID, "gpt_month", 1000, 1000, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-ratio-3", "gpt_month", "gpt_month", "subscription_first")
	ri.PriceData.GroupRatioInfo = types.GroupRatioInfo{
		GroupRatio:        0.2,
		GroupSpecialRatio: -1,
		HasSpecialRatio:   false,
	}

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())

	// 没有特殊倍率可降级，倍率与预扣费都应原样保留
	assert.Equal(t, 0.2, ri.PriceData.GroupRatioInfo.GroupRatio)
	assert.Equal(t, 1000, session.GetPreConsumedQuota(),
		"未套用特殊倍率时不得缩放预扣费")
}
