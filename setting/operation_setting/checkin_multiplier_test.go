package operation_setting

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// 生产 TZ=Asia/Shanghai，固定 +08 无夏令时
var cst = time.FixedZone("CST", 8*3600)

// withSetting 临时替换全局配置并在用例结束后还原，
// 避免用例之间互相污染（checkinSetting 是包级变量）。
func withSetting(t *testing.T, weekdays []int, multiplier float64) {
	t.Helper()
	origWd, origMul := checkinSetting.DoubleWeekdays, checkinSetting.DoubleMultiplier
	checkinSetting.DoubleWeekdays = weekdays
	checkinSetting.DoubleMultiplier = multiplier
	t.Cleanup(func() {
		checkinSetting.DoubleWeekdays = origWd
		checkinSetting.DoubleMultiplier = origMul
	})
}

// 2026-08-02 是周日，往后依次推
var (
	sunday    = time.Date(2026, 8, 2, 10, 0, 0, 0, cst)
	monday    = time.Date(2026, 8, 3, 10, 0, 0, 0, cst)
	wednesday = time.Date(2026, 8, 5, 10, 0, 0, 0, cst)
	saturday  = time.Date(2026, 8, 8, 10, 0, 0, 0, cst)
)

func TestCheckinMultiplierFor_WeekdayMatching(t *testing.T) {
	// 前置：确认基准日期的星期没搞错，否则后面全是假阳性
	assert.Equal(t, time.Sunday, sunday.Weekday())
	assert.Equal(t, time.Monday, monday.Weekday())
	assert.Equal(t, time.Saturday, saturday.Weekday())

	cases := []struct {
		name       string
		weekdays   []int
		multiplier float64
		at         time.Time
		want       float64
	}{
		{"周日配双倍·当天命中", []int{0}, 2, sunday, 2},
		{"周日配双倍·周一不命中", []int{0}, 2, monday, 1},
		{"周一配双倍·当天命中", []int{1}, 2, monday, 1 * 2},
		{"多天配置·周日命中", []int{0, 1}, 2, sunday, 2},
		{"多天配置·周一命中", []int{0, 1}, 2, monday, 2},
		{"多天配置·周三不命中", []int{0, 1}, 2, wednesday, 1},
		{"周六边界(weekday=6)", []int{6}, 3, saturday, 3},
		{"非整数倍率", []int{0}, 1.5, sunday, 1.5},

		// 关闭翻倍的几种表达方式，都必须回到 1
		{"空列表", []int{}, 2, sunday, 1},
		{"nil 列表", nil, 2, sunday, 1},
		{"倍率为 1", []int{0}, 1, sunday, 1},
		{"倍率为 0（未配置时的零值）", []int{0}, 0, sunday, 1},
		{"倍率为负", []int{0}, -5, sunday, 1},

		// 脏数据不能让签到崩掉或误发
		{"非法星期值 9", []int{9}, 2, sunday, 1},
		{"非法星期值 -1", []int{-1}, 2, sunday, 1},
		{"合法值与非法值混杂", []int{9, 0}, 2, sunday, 2},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			withSetting(t, c.weekdays, c.multiplier)
			assert.Equal(t, c.want, CheckinMultiplierFor(c.at))
		})
	}
}

// 倍数只看星期，不看具体时刻：同一天的 00:00 与 23:59 结果必须一致。
func TestCheckinMultiplierFor_TimeOfDayIrrelevant(t *testing.T) {
	withSetting(t, []int{0}, 2)
	start := time.Date(2026, 8, 2, 0, 0, 0, 0, cst)
	end := time.Date(2026, 8, 2, 23, 59, 59, 0, cst)
	assert.Equal(t, float64(2), CheckinMultiplierFor(start))
	assert.Equal(t, float64(2), CheckinMultiplierFor(end))

	// 跨过零点进入周一后立刻失效
	justAfter := time.Date(2026, 8, 3, 0, 0, 1, 0, cst)
	assert.Equal(t, float64(1), CheckinMultiplierFor(justAfter))
}

// 星期按传入时间自身的时区判定。同一 UTC 时刻在不同时区可能是不同的星期，
// 调用方必须传与 CheckinDate 同源的本地时间。
func TestCheckinMultiplierFor_UsesTimeZoneOfArgument(t *testing.T) {
	withSetting(t, []int{0}, 2)
	// 北京时间周日 07:00 == UTC 周六 23:00
	bjSunday := time.Date(2026, 8, 2, 7, 0, 0, 0, cst)
	assert.Equal(t, time.Sunday, bjSunday.Weekday())
	assert.Equal(t, float64(2), CheckinMultiplierFor(bjSunday))

	utcSameInstant := bjSunday.UTC()
	assert.Equal(t, time.Saturday, utcSameInstant.Weekday())
	assert.Equal(t, float64(1), CheckinMultiplierFor(utcSameInstant),
		"同一时刻换到 UTC 就变周六 —— 说明必须传本地时间，不能传 UTC")
}

// 默认配置不得意外开启翻倍：新装或未配置的站点行为应与改动前一致。
func TestDefaultSetting_NoDoubling(t *testing.T) {
	assert.Empty(t, checkinSetting.DoubleWeekdays,
		"默认不应配置任何翻倍日")
	// 默认 multiplier 是 2，但没有翻倍日 → 任意一天都不翻倍
	for d := 0; d < 7; d++ {
		day := time.Date(2026, 8, 2+d, 10, 0, 0, 0, cst)
		assert.Equal(t, float64(1), CheckinMultiplierFor(day),
			"默认配置下 %s 不应翻倍", day.Weekday())
	}
}
