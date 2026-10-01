package service

// billing_cross_group_ratio_test.go
//
// 验证「持有订阅的用户去用别的分组」时倍率不会串。
//
// 背景：GroupGroupRatio 是二维的 [用户组][令牌组]。买了 Codex_GPT_PRO 订阅后
// 用户的 UserGroup 变成 Codex_GPT_PRO，于是产生两个担心：
//   ① 用别的分组（如 Claude_Aws）时，会不会也套上订阅专用的 1x？
//   ② 回落钱包时，会不会把 Codex_GPT_PRO 的 0.3x 套到别的分组上？
// 本文件用生产同款配置把这两条钉死。
//
// 复用 billing_cross_group_test.go 的 TestMain / seed* / makeRelayInfo。

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setProdLikeRatios 复刻线上 synai996 的真实倍率配置：
//
//	GroupRatio      = {default:0, Codex_GPT_PRO:0.3, Claude_Aws:0.1}
//	GroupGroupRatio = {Codex_GPT_PRO:{Codex_GPT_PRO:1}}
//
// 注意 GroupGroupRatio 只给 Codex_GPT_PRO→Codex_GPT_PRO 这一对配了值，
// 其余组合都应回落到各自的 GroupRatio。
func setProdLikeRatios(t *testing.T) {
	t.Helper()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":0,"Codex_GPT_PRO":0.3,"Claude_Aws":0.1}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(
		`{"Codex_GPT_PRO":{"Codex_GPT_PRO":1}}`))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`)
	})
}

// ---------------------------------------------------------------------------
// 第一层：HandleGroupRatio —— 倍率在进入计费前就已锁定，这里决定基准值
// ---------------------------------------------------------------------------

// 订阅用户用各个分组时，HandleGroupRatio 在没有 UserId/生效订阅信息时，
// 只按 (userGroup, usingGroup) 取专属倍率；叠卡后的 1x 由带 UserId 的用例覆盖。
func TestHandleGroupRatio_SubscriberAcrossGroups(t *testing.T) {
	setProdLikeRatios(t)

	cases := []struct {
		name         string
		userGroup    string
		usingGroup   string
		wantRatio    float64
		wantHasSpec  bool
		whyItMatters string
	}{
		{
			name:      "订阅组用订阅组令牌 → 1x（订阅额度按原价消耗）",
			userGroup: "Codex_GPT_PRO", usingGroup: "Codex_GPT_PRO",
			wantRatio: 1, wantHasSpec: true,
		},
		{
			name:      "订阅组用 Claude_Aws 令牌 → 0.1x 而非 1x",
			userGroup: "Codex_GPT_PRO", usingGroup: "Claude_Aws",
			wantRatio: 0.1, wantHasSpec: false,
			whyItMatters: "若串成 1x，用户跨组调用会被多扣 10 倍",
		},
		{
			name:      "订阅组用 default 令牌 → 0x 而非 1x/0.3x",
			userGroup: "Codex_GPT_PRO", usingGroup: "default",
			wantRatio: 0, wantHasSpec: false,
		},
		{
			name:      "无订阅用户用 Codex_GPT_PRO 令牌 → 0.3x（拿不到订阅专属的 1x）",
			userGroup: "default", usingGroup: "Codex_GPT_PRO",
			wantRatio: 0.3, wantHasSpec: false,
			whyItMatters: "反向串会让没买订阅的人按订阅倍率计费",
		},
		{
			name:      "无订阅用户用 Claude_Aws 令牌 → 0.1x",
			userGroup: "default", usingGroup: "Claude_Aws",
			wantRatio: 0.1, wantHasSpec: false,
		},
		{
			name:      "账号组被日卡覆盖、无 UserId 时拿不到 GPT 1x（查库路径未触发）",
			userGroup: "Claude_Aws", usingGroup: "Codex_GPT_PRO",
			wantRatio: 0.3, wantHasSpec: false,
			whyItMatters: "没有 UserId 时不能误套 1x；有生效 GPT 订阅时应由带 UserId 的用例覆盖",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx := newTestGinContext()
			ri := &relaycommon.RelayInfo{
				UserGroup:  c.userGroup,
				UsingGroup: c.usingGroup,
			}
			got := helper.HandleGroupRatio(ctx, ri)
			assert.Equal(t, c.wantRatio, got.GroupRatio, c.whyItMatters)
			assert.Equal(t, c.wantHasSpec, got.HasSpecialRatio,
				"HasSpecialRatio 决定日志里是否显示「专属倍率」")
		})
	}
}

// ---------------------------------------------------------------------------
// 第二层：NewBillingSession —— 跨组时资金源与倍率都不该被订阅影响
// ---------------------------------------------------------------------------

// 订阅用户用「非订阅分组」的令牌时：
//   - 资金源必须是钱包（不许消耗订阅额度）
//   - 倍率必须保持该分组自己的值，不被 switchRatioForFundingFallback 改动
func TestCrossGroup_SubscriberUsingOtherGroup_KeepsThatGroupRatio(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setProdLikeRatios(t)

	const userID, tokenID, planID, subID = 3101, 3101, 391, 391
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-xg-1", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	// 订阅额度充足 —— 即便如此，跨组也不该动它
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	for _, pref := range []string{"subscription_first", "wallet_first", "subscription_only", "wallet_only"} {
		t.Run("pref="+pref, func(t *testing.T) {
			c := newTestGinContext()
			// 用户组是订阅组，但令牌走 Claude_Aws
			ri := makeRelayInfo(userID, tokenID, "sk-xg-1", "Codex_GPT_PRO", "Claude_Aws", pref)
			ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
			require.Equal(t, 0.1, ri.PriceData.GroupRatioInfo.GroupRatio,
				"前置条件：跨组基准倍率应为 Claude_Aws 的 0.1")

			session, apiErr := NewBillingSession(c, ri, 100)
			require.Nil(t, apiErr)
			require.NotNil(t, session)

			assert.Equal(t, BillingSourceWallet, session.funding.Source(),
				"跨组必须强制走钱包，否则订阅额度被非订阅分组吃掉")
			assert.Equal(t, 0.1, ri.PriceData.GroupRatioInfo.GroupRatio,
				"跨组倍率被改动 —— 订阅的 1x 或 0.3x 串到了 Claude_Aws 上")
			assert.False(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
			assert.Equal(t, 100, session.GetPreConsumedQuota(),
				"跨组不该缩放预扣费")
		})
	}
}

// 订阅额度耗尽后回落钱包：0.3x 只能作用于 Codex_GPT_PRO 自己，
// 且必须真的从 1x 切到 0.3x（这是本次上线的核心行为）。
func TestSameGroup_SubscriptionExhausted_FallsBackTo03(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setProdLikeRatios(t)

	const userID, tokenID, planID, subID = 3102, 3102, 392, 392
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-xg-2", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	// 额度已耗尽
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 1000, 1000, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-xg-2", "Codex_GPT_PRO", "Codex_GPT_PRO", "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"前置条件：同组订阅用户基准倍率应为 1")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())

	assert.Equal(t, 0.3, ri.PriceData.GroupRatioInfo.GroupRatio,
		"额度耗尽回落钱包后应按 0.3x —— 这正是弹窗上承诺给用户的数字")
	assert.False(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 300, session.GetPreConsumedQuota(),
		"预扣费应按 0.3/1 缩放：1000 → 300")
}

// 同时持有两个不同分组的订阅时，各自分组用各自的倍率，互不串味。
func TestMultiSubscriptions_EachGroupKeepsOwnRatio(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	// 给 Claude_Aws 也配一个特殊倍率，构造「两个订阅组都有专属倍率」的场景
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":0,"Codex_GPT_PRO":0.3,"Claude_Aws":0.1}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(
		`{"Codex_GPT_PRO":{"Codex_GPT_PRO":1},"Claude_Aws":{"Claude_Aws":0.5}}`))
	t.Cleanup(func() { _ = ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`) })

	const userID, tokenID = 3103, 3103
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-xg-3", 5_000_000)
	seedPlan(t, 393, "Codex_GPT_PRO")
	seedPlan(t, 394, "Claude_Aws")
	seedSubWithGroup(t, 3931, userID, 393, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)
	seedSubWithGroup(t, 3941, userID, 394, "Claude_Aws", 5_000_000, 0, "active", 86400)

	// 用户当前组是 Codex_GPT_PRO（最后一次升级），但拿 Claude_Aws 令牌。
	// 持有 Claude 订阅时，应套 Claude 自己的专属倍率，而不是账号组对不上就退回 GroupRatio。
	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-xg-3", "Codex_GPT_PRO", "Claude_Aws", "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	assert.Equal(t, 0.5, ri.PriceData.GroupRatioInfo.GroupRatio,
		"叠卡后令牌组有生效订阅，应套 Claude_Aws→Claude_Aws 的专属倍率")
	assert.True(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)

	session, apiErr := NewBillingSession(c, ri, 100)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source(),
		"用户持有 Claude_Aws 订阅，用该组令牌应消耗该组订阅额度")
	assert.Equal(t, 0.5, ri.PriceData.GroupRatioInfo.GroupRatio,
		"倍率不该被另一个订阅组的值污染")

	// 反向：账号组被日卡改成 Claude_Aws，GPT 令牌仍应 1x（线上 1688 Ethan）
	c2 := newTestGinContext()
	ri2 := makeRelayInfo(userID, tokenID, "sk-xg-3", "Claude_Aws", "Codex_GPT_PRO", "subscription_first")
	ri2.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c2, ri2)
	assert.Equal(t, float64(1), ri2.PriceData.GroupRatioInfo.GroupRatio,
		"users.group 被后买的日卡覆盖后，GPT 月卡仍应按 1x 扣订阅额度")
	assert.True(t, ri2.PriceData.GroupRatioInfo.HasSpecialRatio)
	session2, apiErr := NewBillingSession(c2, ri2, 100)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session2.funding.Source())
	assert.Equal(t, float64(1), ri2.PriceData.GroupRatioInfo.GroupRatio)
}

// 兜底：GroupRatioInfo 若被上游置为订阅倍率，跨组路径也不能把它带进钱包计费。
// 模拟一种危险情形 —— 倍率已锁成 1x，但实际走的是跨组钱包。
func TestCrossGroup_StaleSpecialRatio_NotAppliedToWallet(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setProdLikeRatios(t)

	const userID, tokenID, planID, subID = 3104, 3104, 395, 395
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-xg-4", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-xg-4", "Codex_GPT_PRO", "Claude_Aws", "subscription_first")
	// 人为构造「倍率已是订阅的 1x」但令牌是跨组的状态
	ri.PriceData.GroupRatioInfo = types.GroupRatioInfo{
		GroupRatio:        1,
		GroupSpecialRatio: 1,
		HasSpecialRatio:   true,
	}

	session, apiErr := NewBillingSession(c, ri, 100)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source(),
		"跨组应强制钱包")
	assert.Equal(t, 0.1, ri.PriceData.GroupRatioInfo.GroupRatio,
		"跨组钱包必须降回 Claude_Aws 的 GroupRatio，不能把订阅 1x 带进钱包")
	assert.False(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 10, session.GetPreConsumedQuota(),
		"预扣费应按 0.1/1 缩放：100 → 10")
}

// 账号分组被后买的日卡覆盖后，GPT 月卡额度耗尽回落钱包仍必须 1x → 0.3x。
// 若只按 users.group 查 GroupGroupRatio，hasSpecial=false，会停在 1x 扣钱包。
func TestStacked_OverwrittenUserGroup_GPTExhausted_FallsBackTo03(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setProdLikeRatios(t)

	const userID, tokenID, planID, subID = 3201, 3201, 401, 401
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-xg-eth", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 1000, 1000, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-xg-eth", "Claude_Aws", "Codex_GPT_PRO", "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"有生效 GPT 订阅时，即使用户组已被改成 Claude_Aws，基准倍率也必须是 1")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.3, ri.PriceData.GroupRatioInfo.GroupRatio,
		"回落钱包后必须切到 GroupRatio[Codex_GPT_PRO]，不能停在订阅 1x")
	assert.False(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 300, session.GetPreConsumedQuota())
}

// 无 GPT 订阅的用户，即使用 Codex 令牌、账号组碰巧叫 Claude_Aws，也拿不到 1x。
func TestHandleGroupRatio_NoGPTSub_OverwrittenGroup_Stays03(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setProdLikeRatios(t)

	const userID = 3202
	seedUser(t, userID, 10_000_000)

	c := newTestGinContext()
	ri := &relaycommon.RelayInfo{
		UserId:     userID,
		UserGroup:  "Claude_Aws",
		UsingGroup: "Codex_GPT_PRO",
	}
	got := helper.HandleGroupRatio(c, ri)
	assert.Equal(t, 0.3, got.GroupRatio)
	assert.False(t, got.HasSpecialRatio)
}

const bpsGroup = "Codex_GPT_BPS[不降智]"

func setWeeklyCardBpsAliasRatios(t *testing.T) {
	t.Helper()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":0,"Codex_GPT_PRO":0.3,"Claude_Aws":0.1,"Codex_GPT_BPS[不降智]":0.3}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(
		`{"Codex_GPT_PRO":{"Codex_GPT_PRO":1,"Codex_GPT_BPS[不降智]":1},"Codex_GPT_BPS[不降智]":{"Codex_GPT_BPS[不降智]":1}}`))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`)
	})
}

// 方案 1：现有周卡 upgrade_group=Codex_GPT_PRO，令牌切到不降智分组仍扣周卡、1x。
func TestWeeklyCard_AliasBpsGroup_UsesSubscription(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setWeeklyCardBpsAliasRatios(t)

	const userID, tokenID, planID, subID = 3301, 3301, 501, 501
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-bps-1", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-bps-1", "Codex_GPT_PRO", bpsGroup, "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio)
	require.True(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)

	session, apiErr := NewBillingSession(c, ri, 100)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source(),
		"周卡别名分组必须扣订阅，不能被当成跨组打钱包")
	sub, ok := session.funding.(*SubscriptionFunding)
	require.True(t, ok)
	assert.Equal(t, "Codex_GPT_PRO", sub.usingGroup,
		"预扣应归到周卡 upgrade_group，避免和 Claude 卡抢扣费顺序")
	assert.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio)
}

func TestWeeklyCard_AliasBpsGroup_ClaudeStillWallet(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setWeeklyCardBpsAliasRatios(t)

	const userID, tokenID, planID, subID = 3302, 3302, 502, 502
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-bps-2", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-bps-2", "Codex_GPT_PRO", "Claude_Aws", "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	session, apiErr := NewBillingSession(c, ri, 100)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source(),
		"别名不能把 Claude_Aws 也算进周卡")
	assert.Equal(t, 0.1, ri.PriceData.GroupRatioInfo.GroupRatio)
}

func TestWeeklyCard_AliasBpsGroup_StackedClaudeUser(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setWeeklyCardBpsAliasRatios(t)

	const userID, tokenID, planID, subID = 3303, 3303, 503, 503
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-bps-3", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-bps-3", "Claude_Aws", bpsGroup, "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	assert.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"账号被日卡改成 Claude_Aws 后，不降智令牌仍应按周卡 1x 扣")
	session, apiErr := NewBillingSession(c, ri, 100)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())
}

// wallet_only 直达钱包：不能把周卡专属 1x 带到钱包上（线上 zcg 不降令牌）。
func TestWeeklyCard_AliasBpsGroup_WalletOnly_Uses03(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setWeeklyCardBpsAliasRatios(t)

	const userID, tokenID, planID, subID = 3304, 3304, 504, 504
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-bps-4", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-bps-4", "Codex_GPT_PRO", bpsGroup, "wallet_only")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"前置：HandleGroupRatio 仍会先套上专属 1x")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.3, ri.PriceData.GroupRatioInfo.GroupRatio,
		"仅钱包必须用 GroupRatio[不降智]=0.3，不能停在周卡 1x")
	assert.False(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 300, session.GetPreConsumedQuota(),
		"预扣费应按 0.3/1 缩放：1000 → 300")
}

// wallet_first 钱包够用时同样降回 0.3，不能因为账号组是 PRO 就按 1x 扣钱包。
func TestWeeklyCard_AliasBpsGroup_WalletFirst_HasBalance_Uses03(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setWeeklyCardBpsAliasRatios(t)

	const userID, tokenID, planID, subID = 3305, 3305, 505, 505
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-bps-5", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-bps-5", "Codex_GPT_PRO", bpsGroup, "wallet_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.3, ri.PriceData.GroupRatioInfo.GroupRatio)
	assert.False(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 300, session.GetPreConsumedQuota())
}

func setVipAndWeeklyRatios(t *testing.T) {
	t.Helper()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":0,"vip":0.1,"Codex_GPT_PRO":0.3,"Claude_Aws":0.1,"Codex_GPT_BPS[不降智]":0.3}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(
		`{"Codex_GPT_PRO":{"Codex_GPT_PRO":1,"Codex_GPT_BPS[不降智]":1},"Codex_GPT_BPS[不降智]":{"Codex_GPT_BPS[不降智]":1},"vip":{"Claude_Aws":0.15,"Codex_GPT_PRO":0.2}}`))
	t.Cleanup(func() { _ = ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`) })
}

func TestVip_WalletOnly_ProGroup_Keeps02(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setVipAndWeeklyRatios(t)

	const userID, tokenID = 3401, 3401
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-vip-1", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-vip-1", "vip", "Codex_GPT_PRO", "wallet_only")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, 0.2, ri.PriceData.GroupRatioInfo.GroupRatio)

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.2, ri.PriceData.GroupRatioInfo.GroupRatio,
		"VIP 打 PRO 走钱包必须保留 0.2，不能被改成 GroupRatio 0.3")
	assert.True(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 1000, session.GetPreConsumedQuota())
}

func TestVip_WalletOnly_Claude_Keeps015(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setVipAndWeeklyRatios(t)

	const userID, tokenID = 3402, 3402
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-vip-2", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-vip-2", "vip", "Claude_Aws", "wallet_only")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)

	session, apiErr := NewBillingSession(c, ri, 100)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.15, ri.PriceData.GroupRatioInfo.GroupRatio,
		"VIP 打 Claude 走钱包必须保留 0.15，不能落到 GroupRatio 0.1")
}

func TestVip_WithWeeklyCard_SubscriptionUses1x(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setVipAndWeeklyRatios(t)

	const userID, tokenID, planID, subID = 3403, 3403, 601, 601
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-vip-3", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-vip-3", "vip", "Codex_GPT_PRO", "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"有周卡时订阅初值就是套餐 1x，不能先套 VIP 0.2")

	session, apiErr := NewBillingSession(c, ri, 200)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())
	assert.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"VIP 有周卡时订阅必须按套餐 1x，不能用 0.2 慢耗卡")
	assert.True(t, ri.PriceData.GroupRatioInfo.HasSpecialRatio)
	assert.Equal(t, 200, session.GetPreConsumedQuota())
}

func TestVip_WithWeeklyCard_WalletOnly_Keeps02(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setVipAndWeeklyRatios(t)

	const userID, tokenID, planID, subID = 3404, 3404, 602, 602
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-vip-4", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-vip-4", "vip", "Codex_GPT_PRO", "wallet_only")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"有周卡时初值按套餐 1x，仅钱包再降回 VIP 折扣")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.2, ri.PriceData.GroupRatioInfo.GroupRatio)
	assert.Equal(t, 200, session.GetPreConsumedQuota(),
		"预扣费应按 0.2/1 缩放：1000 → 200")
}

func TestVip_WithWeeklyCard_Exhausted_FallsBackTo02(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setVipAndWeeklyRatios(t)

	const userID, tokenID, planID, subID = 3405, 3405, 603, 603
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-vip-5", 5_000_000)
	seedPlan(t, planID, "Codex_GPT_PRO")
	seedSubWithGroup(t, subID, userID, planID, "Codex_GPT_PRO", 1000, 1000, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-vip-5", "vip", "Codex_GPT_PRO", "subscription_first")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)
	require.Equal(t, float64(1), ri.PriceData.GroupRatioInfo.GroupRatio,
		"卡还在时初值仍是套餐 1x，额度耗尽后再回落钱包")

	session, apiErr := NewBillingSession(c, ri, 200)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.2, ri.PriceData.GroupRatioInfo.GroupRatio,
		"周卡耗尽回落钱包必须保留 VIP 0.2，不能掉到 GroupRatio 0.3")
	assert.Equal(t, 40, session.GetPreConsumedQuota(),
		"预扣费应按 0.2/1 缩放：200 → 40")
}

func TestVip_WalletOnly_Bps_Inherits02(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)
	setVipAndWeeklyRatios(t)

	const userID, tokenID = 3406, 3406
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-vip-6", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-vip-6", "vip", bpsGroup, "wallet_only")
	ri.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, ri)

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0.2, ri.PriceData.GroupRatioInfo.GroupRatio,
		"不降智是周卡别名，VIP 钱包应沿用 vip→PRO 的 0.2")
}
