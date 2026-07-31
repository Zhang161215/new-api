package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 额度重置时点必须以购买日（base）为锚点，而非对齐到自然日/周一/月初。
//
// 回归背景：原实现按日历对齐（daily→次日 00:00、weekly→下个周一 00:00、
// monthly→下月 1 日 00:00），使「哪天下单」不影响下次重置时点。
// 月底或周日下单的用户，几小时后额度就重置一次，等于一份钱拿两份额度。
func TestCalcNextResetTime_AnchoredToPurchaseTime(t *testing.T) {
	loc := time.FixedZone("CST", 8*3600) // 生产 TZ=Asia/Shanghai，固定 +08 无夏令时

	cases := []struct {
		name     string
		period   string
		custom   int64
		start    time.Time
		wantNext time.Time
	}{
		{
			name:     "月卡·20号购买→次月同日同时刻",
			period:   SubscriptionResetMonthly,
			start:    time.Date(2026, 8, 20, 14, 30, 0, 0, loc),
			wantNext: time.Date(2026, 9, 20, 14, 30, 0, 0, loc),
		},
		{
			// 原实现此处间隔 0.0 天 —— 买完一小时额度就翻倍，损失最大的场景。
			// 8-31 加一个月：9 月无 31 日，Go 的 AddDate 规范化为 10-01
			// （相当于 30 天周期，仍是完整周期，不影响计费公平）。
			name:     "月卡·月底购买→不再当晚重置",
			period:   SubscriptionResetMonthly,
			start:    time.Date(2026, 8, 31, 23, 0, 0, 0, loc),
			wantNext: time.Date(2026, 10, 1, 23, 0, 0, 0, loc),
		},
		{
			// 原实现此处间隔 0.2 天
			name:     "周卡·周日购买→7天后而非隔天",
			period:   SubscriptionResetWeekly,
			start:    time.Date(2026, 8, 2, 20, 0, 0, 0, loc), // 周日
			wantNext: time.Date(2026, 8, 9, 20, 0, 0, 0, loc),
		},
		{
			name:     "周卡·周一购买→整7天",
			period:   SubscriptionResetWeekly,
			start:    time.Date(2026, 8, 3, 9, 0, 0, 0, loc),
			wantNext: time.Date(2026, 8, 10, 9, 0, 0, 0, loc),
		},
		{
			name:     "日卡·保留时刻而非归零到午夜",
			period:   SubscriptionResetDaily,
			start:    time.Date(2026, 8, 20, 14, 30, 0, 0, loc),
			wantNext: time.Date(2026, 8, 21, 14, 30, 0, 0, loc),
		},
		{
			name:     "自定义周期·按秒推进",
			period:   SubscriptionResetCustom,
			custom:   3600,
			start:    time.Date(2026, 8, 20, 14, 30, 0, 0, loc),
			wantNext: time.Date(2026, 8, 20, 15, 30, 0, 0, loc),
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			plan := &SubscriptionPlan{
				QuotaResetPeriod:        c.period,
				QuotaResetCustomSeconds: c.custom,
			}
			// endUnix 给足够远，避免被订阅到期条件截断
			endUnix := c.start.AddDate(5, 0, 0).Unix()
			got := calcNextResetTime(c.start, plan, endUnix)
			require.NotZero(t, got, "应算出下次重置时点")
			assert.Equal(t, c.wantNext.Unix(), got,
				"期望 %s，实际 %s",
				c.wantNext.Format("2006-01-02 15:04"),
				time.Unix(got, 0).In(loc).Format("2006-01-02 15:04"))
		})
	}
}

// 重置间隔必须接近一个完整周期，不能出现「买完就重置」。
func TestCalcNextResetTime_NoImmediateReset(t *testing.T) {
	loc := time.FixedZone("CST", 8*3600)

	// 覆盖一整月每一天下单，确认没有任何一天会导致间隔过短
	for day := 1; day <= 31; day++ {
		start := time.Date(2026, 8, day, 23, 0, 0, 0, loc)
		plan := &SubscriptionPlan{QuotaResetPeriod: SubscriptionResetMonthly}
		next := calcNextResetTime(start, plan, start.AddDate(5, 0, 0).Unix())
		require.NotZero(t, next)
		gapDays := time.Unix(next, 0).Sub(start).Hours() / 24
		assert.Greater(t, gapDays, 27.0,
			"8月%d日购买的月卡，重置间隔 %.1f 天过短（原实现月底购买仅 0.0 天）", day, gapDays)
	}

	// 周卡覆盖一周每一天
	for day := 2; day <= 8; day++ {
		start := time.Date(2026, 8, day, 20, 0, 0, 0, loc)
		plan := &SubscriptionPlan{QuotaResetPeriod: SubscriptionResetWeekly}
		next := calcNextResetTime(start, plan, start.AddDate(5, 0, 0).Unix())
		require.NotZero(t, next)
		gapDays := time.Unix(next, 0).Sub(start).Hours() / 24
		assert.InDelta(t, 7.0, gapDays, 0.01,
			"8月%d日(%s)购买的周卡间隔应为 7 天，实际 %.2f 天",
			day, start.Weekday(), gapDays)
	}
}

// 惰性重置的追赶循环必须能终止：base 每轮严格前进，不会返回同一时刻。
func TestCalcNextResetTime_AdvancesStrictly(t *testing.T) {
	loc := time.FixedZone("CST", 8*3600)
	periods := []string{
		SubscriptionResetDaily, SubscriptionResetWeekly, SubscriptionResetMonthly,
	}
	for _, p := range periods {
		plan := &SubscriptionPlan{QuotaResetPeriod: p}
		base := time.Date(2026, 1, 31, 12, 0, 0, 0, loc) // 取月底，最容易触发规范化
		endUnix := base.AddDate(10, 0, 0).Unix()
		for i := 0; i < 24; i++ {
			next := calcNextResetTime(base, plan, endUnix)
			require.NotZero(t, next, "period=%s 第%d轮应有下次重置", p, i)
			require.Greater(t, next, base.Unix(),
				"period=%s 第%d轮未前进（会导致惰性重置死循环）", p, i)
			base = time.Unix(next, 0).In(loc)
		}
	}
}
