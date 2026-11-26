package model

import (
	"time"

	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/require"
)

func TestLotteryTicketsForAmount(t *testing.T) {
	perPayment := LotteryGrantRule{GrantMode: LotteryGrantModePerPayment, TicketsPerPayment: 2}
	threshold := LotteryGrantRule{GrantMode: LotteryGrantModePerPayment, TicketsPerPayment: 1, MinPayAmount: 30}
	tiers := LotteryGrantRule{GrantMode: LotteryGrantModeTiers, AmountTiers: []LotteryAmountTier{
		{MinAmount: 100, Tickets: 8},
		{MinAmount: 10, Tickets: 1},
		{MinAmount: 50, Tickets: 3},
	}}
	perAmount := LotteryGrantRule{GrantMode: LotteryGrantModePerAmount, StepAmount: 10, StepTickets: 1, MaxTicketsPerPayment: 20}
	cents := LotteryGrantRule{GrantMode: LotteryGrantModePerAmount, StepAmount: 0.1, StepTickets: 1, MaxTicketsPerPayment: 100}

	cases := []struct {
		name   string
		rule   LotteryGrantRule
		amount float64
		want   int
	}{
		{"按笔不看金额", perPayment, 0.5, 2},
		{"按笔起送金额以下不送", threshold, 29.99, 0},
		{"按笔刚好到起送金额", threshold, 30, 1},
		{"阶梯低于最低档", tiers, 9.99, 0},
		{"阶梯最低档", tiers, 10, 1},
		{"阶梯两档之间取低档", tiers, 49.99, 1},
		{"阶梯中间档", tiers, 50, 3},
		{"阶梯最高档不叠加", tiers, 100, 8},
		{"阶梯超过最高档", tiers, 850, 8},
		{"每满不足一份", perAmount, 9.99, 0},
		{"每满一份", perAmount, 10, 1},
		{"每满向下取整", perAmount, 99.99, 9},
		{"每满单笔封顶", perAmount, 850, 20},
		{"金额按分计算不受浮点误差影响", cents, 0.3, 3},
		{"空模式按按笔处理", LotteryGrantRule{}, 10, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, tc.rule.TicketsForAmount(tc.amount))
		})
	}
}

func TestLotteryPaidAmountCNY(t *testing.T) {
	prev := operation_setting.USDExchangeRate
	operation_setting.USDExchangeRate = 7
	t.Cleanup(func() { operation_setting.USDExchangeRate = prev })

	require.InDelta(t, 10, LotteryPaidAmountCNY(10, "alipay"), 1e-9)
	require.InDelta(t, 10, LotteryPaidAmountCNY(10, "wxpay"), 1e-9)
	require.InDelta(t, 70, LotteryPaidAmountCNY(10, "stripe"), 1e-9)
	require.InDelta(t, 70, LotteryPaidAmountCNY(10, "offline"), 1e-9)
	require.InDelta(t, 0, LotteryPaidAmountCNY(-1, "alipay"), 1e-9)
}

func TestLotteryGrantRuleValidate(t *testing.T) {
	bad := []LotteryGrantRule{
		{GrantMode: "monthly"},
		{GrantMode: LotteryGrantModePerPayment, TicketsPerPayment: 0},
		{GrantMode: LotteryGrantModePerPayment, TicketsPerPayment: 101},
		{GrantMode: LotteryGrantModePerPayment, TicketsPerPayment: 1, MinPayAmount: -1},
		{GrantMode: LotteryGrantModeTiers},
		{GrantMode: LotteryGrantModeTiers, AmountTiers: []LotteryAmountTier{{MinAmount: 0, Tickets: 1}}},
		{GrantMode: LotteryGrantModeTiers, AmountTiers: []LotteryAmountTier{{MinAmount: 10, Tickets: 0}}},
		{GrantMode: LotteryGrantModeTiers, AmountTiers: []LotteryAmountTier{{MinAmount: 10, Tickets: 1}, {MinAmount: 10.001, Tickets: 2}}},
		{GrantMode: LotteryGrantModePerAmount, StepAmount: 0, StepTickets: 1, MaxTicketsPerPayment: 10},
		{GrantMode: LotteryGrantModePerAmount, StepAmount: 10, StepTickets: 1, MaxTicketsPerPayment: 0},
		{GrantMode: LotteryGrantModePerPayment, TicketsPerPayment: 1, GrantWindowHours: -1},
		{GrantMode: LotteryGrantModePerPayment, TicketsPerPayment: 1, GrantWindowHours: 721},
	}
	for i, rule := range bad {
		r := rule
		require.Error(t, r.Validate(), "case %d", i)
	}

	// 非当前模式的残缺字段不拦截，只兜底。
	ok := LotteryGrantRule{
		GrantMode:         LotteryGrantModePerPayment,
		TicketsPerPayment: 1,
		AmountTiers:       []LotteryAmountTier{{MinAmount: 0, Tickets: 0}},
	}
	require.NoError(t, ok.Validate())
	require.Empty(t, ok.AmountTiers)
	require.Equal(t, 20, ok.MaxTicketsPerPayment)
}

func TestGrantTicketsFollowsAmountRule(t *testing.T) {
	setupLotteryTables(t)
	require.NoError(t, EnsureLotteryDefaults())
	prev := operation_setting.USDExchangeRate
	operation_setting.USDExchangeRate = 7
	t.Cleanup(func() { operation_setting.USDExchangeRate = prev })

	_, err := SaveLotteryConfig(true, true, &LotteryGrantRule{
		GrantMode: LotteryGrantModeTiers,
		AmountTiers: []LotteryAmountTier{
			{MinAmount: 100, Tickets: 8},
			{MinAmount: 10, Tickets: 1},
			{MinAmount: 50, Tickets: 3},
		},
	})
	require.NoError(t, err)

	cfg, err := GetLotteryConfig()
	require.NoError(t, err)
	require.Equal(t, LotteryGrantModeTiers, cfg.GrantMode)
	require.Equal(t, []LotteryAmountTier{{MinAmount: 10, Tickets: 1}, {MinAmount: 50, Tickets: 3}, {MinAmount: 100, Tickets: 8}}, cfg.AmountTiers)

	u := &User{Username: "lottery-amount-rule", Password: "x", Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-AMT-9", 9, "alipay"))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-AMT-10", 10, "alipay"))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-AMT-100", 100, "alipay"))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-AMT-100", 100, "alipay"))
	// 美元 $10 按汇率 7 折成 ¥70，命中 ¥50 档。
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-AMT-USD", 10, "stripe"))

	wallet, err := GetLotteryWallet(u.Id)
	require.NoError(t, err)
	require.Equal(t, 1+8+3, wallet.Tickets)

	var logs []LotteryTicketLog
	require.NoError(t, DB.Where("user_id = ?", u.Id).Order("id").Find(&logs).Error)
	require.Len(t, logs, 3, "不够门槛的那笔不记流水，重复回调只记一次")
	require.Equal(t, "T-AMT-10", logs[0].RefId)
	require.Equal(t, 8, logs[1].Delta)
	require.Equal(t, 3, logs[2].Delta)
}

func TestLotteryConfigLegacyRowKeepsPerPayment(t *testing.T) {
	setupLotteryTables(t)
	require.NoError(t, EnsureLotteryDefaults())
	// 模拟旧版本建的行：新列全是空值，只有 tickets_per_payment。
	require.NoError(t, DB.Exec("UPDATE lottery_configs SET grant_mode = NULL, min_pay_amount = NULL, amount_tiers = NULL, step_amount = NULL, step_tickets = NULL, max_tickets_per_payment = NULL, grant_window_hours = NULL, tickets_per_payment = 3 WHERE id = 1").Error)

	cfg, err := GetLotteryConfig()
	require.NoError(t, err)
	require.Equal(t, LotteryGrantModePerPayment, cfg.GrantMode)
	require.Equal(t, 3, cfg.TicketsPerPayment)
	require.Equal(t, 3, cfg.TicketsForAmount(1))
	require.Equal(t, 0, cfg.GrantWindowHours, "旧行没有防刷窗口，等于不限")

	// 只改开关不动规则。
	cfg, err = SaveLotteryConfig(false, true, nil)
	require.NoError(t, err)
	require.False(t, cfg.Enabled)
	require.Equal(t, 3, cfg.TicketsPerPayment)
	require.Equal(t, LotteryGrantModePerPayment, cfg.GrantMode)

	// 非法规则整体拒绝，库里不变。
	_, err = SaveLotteryConfig(true, true, &LotteryGrantRule{GrantMode: LotteryGrantModeTiers})
	require.Error(t, err)
	again, err := GetLotteryConfig()
	require.NoError(t, err)
	require.False(t, again.Enabled)
	require.Equal(t, LotteryGrantModePerPayment, again.GrantMode)
}

// 防刷窗口：同一用户窗口内靠支付拿到的次数合计不超过单笔最高一档。
func TestGrantTicketsWindowLimitsRepeatedSmallTopUps(t *testing.T) {
	setupLotteryTables(t)
	require.NoError(t, EnsureLotteryDefaults())
	tiers := []LotteryAmountTier{{MinAmount: 10, Tickets: 1}, {MinAmount: 50, Tickets: 2}, {MinAmount: 100, Tickets: 3}, {MinAmount: 200, Tickets: 5}}
	_, err := SaveLotteryConfig(true, true, &LotteryGrantRule{GrantMode: LotteryGrantModeTiers, AmountTiers: tiers, GrantWindowHours: 24})
	require.NoError(t, err)
	cfg, err := GetLotteryConfig()
	require.NoError(t, err)
	require.Equal(t, 24, cfg.GrantWindowHours)

	u := &User{Username: "lottery-window", Password: "x", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, AffCode: "lw01"}
	other := &User{Username: "lottery-window-2", Password: "x", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, AffCode: "lw02"}
	require.NoError(t, DB.Create(u).Error)
	require.NoError(t, DB.Create(other).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id IN ?", []int{u.Id, other.Id}).Delete(&User{}) })
	tickets := func(id int) int {
		w, err := GetLotteryWallet(id)
		require.NoError(t, err)
		return w.Tickets
	}
	grant := func(id int, trade string, money float64) {
		require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, id, trade, money, "alipay"))
	}

	grant(u.Id, "W-1", 10)
	grant(u.Id, "W-2", 10)
	grant(u.Id, "W-3", 10)
	require.Equal(t, 1, tickets(u.Id), "连续充 ¥10 只送第一笔")
	grant(u.Id, "W-4", 200)
	require.Equal(t, 5, tickets(u.Id), "之后充 ¥200 补差额到 5 次")
	grant(u.Id, "W-4", 200)
	grant(u.Id, "W-5", 100)
	require.Equal(t, 5, tickets(u.Id), "重复回调、窗口内更小的单都不再送")
	grant(other.Id, "W-O", 10)
	require.Equal(t, 1, tickets(other.Id), "按用户分开算")

	var logs []LotteryTicketLog
	require.NoError(t, DB.Where("user_id = ?", u.Id).Order("id").Find(&logs).Error)
	require.Len(t, logs, 2, "补不出次数的单不记流水")
	require.Equal(t, 4, logs[1].Delta)

	// 窗口过去之后重新按单笔算。
	require.NoError(t, DB.Model(&LotteryTicketLog{}).Where("user_id = ?", u.Id).Update("created_at", time.Now().Unix()-25*3600).Error)
	grant(u.Id, "W-6", 10)
	require.Equal(t, 6, tickets(u.Id))

	// 关掉限制（0）恢复每笔都送。
	_, err = SaveLotteryConfig(true, true, &LotteryGrantRule{GrantMode: LotteryGrantModeTiers, AmountTiers: tiers})
	require.NoError(t, err)
	grant(u.Id, "W-7", 10)
	grant(u.Id, "W-8", 10)
	require.Equal(t, 8, tickets(u.Id))
}
