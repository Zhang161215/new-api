package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 复用 task_cas_test.go 的 TestMain（in-memory sqlite）。
//
// UserCheckin 内部用 time.Now() 取当天星期，测试无法注入时间，
// 因此这里把「今天的星期」算出来再据此配置，从而稳定地构造
// 命中 / 未命中两种场景 —— 不管哪天跑 CI 结果都一致。

func setupCheckinTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Checkin{}, &User{}))
	require.NoError(t, DB.Exec("DELETE FROM checkins").Error)
	require.NoError(t, DB.Exec("DELETE FROM users").Error)
}

func seedCheckinUser(t *testing.T, id int) {
	t.Helper()
	require.NoError(t, DB.Exec(
		`INSERT INTO users (id, username, password, quota, status, role, "group")
		 VALUES (?, ?, 'x', 0, 1, 1, 'default')`,
		id, "u"+time.Now().Format("150405.000000000")).Error)
}

func userQuota(t *testing.T, id int) int {
	t.Helper()
	var q int
	require.NoError(t, DB.Raw("SELECT quota FROM users WHERE id = ?", id).Scan(&q).Error)
	return q
}

// applyCheckinSetting 直接改全局配置并在用例后还原。
func applyCheckinSetting(t *testing.T, minQ, maxQ int, weekdays []int, multiplier float64) {
	t.Helper()
	s := operation_setting.GetCheckinSetting()
	orig := *s
	s.Enabled = true
	s.MinQuota = minQ
	s.MaxQuota = maxQ
	s.MinTopUpAmount = 0
	s.DoubleWeekdays = weekdays
	s.DoubleMultiplier = multiplier
	t.Cleanup(func() { *s = orig })
}

func todayWeekday() int { return int(time.Now().Weekday()) }

func otherWeekday() int { return (todayWeekday() + 3) % 7 }

// 翻倍日：到账额度必须是基础额度乘以倍数。
// 用 min==max 固定基础额度，避免随机区间干扰断言。
func TestUserCheckin_DoubleDay_AwardsMultiplied(t *testing.T) {
	setupCheckinTest(t)
	const userID = 9001
	seedCheckinUser(t, userID)
	applyCheckinSetting(t, 250000, 250000, []int{todayWeekday()}, 2)

	rec, err := UserCheckin(userID)
	require.NoError(t, err)
	assert.Equal(t, 500000, rec.QuotaAwarded, "双倍日应发放 250000 × 2")
	assert.Equal(t, 500000, userQuota(t, userID), "用户余额应同步增加翻倍后的额度")
}

// 非翻倍日：额度保持原样，不能被误放大。
func TestUserCheckin_NonDoubleDay_AwardsBase(t *testing.T) {
	setupCheckinTest(t)
	const userID = 9002
	seedCheckinUser(t, userID)
	applyCheckinSetting(t, 250000, 250000, []int{otherWeekday()}, 2)

	rec, err := UserCheckin(userID)
	require.NoError(t, err)
	assert.Equal(t, 250000, rec.QuotaAwarded)
	assert.Equal(t, 250000, userQuota(t, userID))
}

// 未配置翻倍日时行为与改动前完全一致 —— 这是升级不惊动现网的前提。
func TestUserCheckin_NoDoubleConfig_UnchangedBehavior(t *testing.T) {
	setupCheckinTest(t)
	const userID = 9003
	seedCheckinUser(t, userID)
	// 线上现有配置：250000~500000，无翻倍日
	applyCheckinSetting(t, 250000, 500000, []int{}, 2)

	rec, err := UserCheckin(userID)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, rec.QuotaAwarded, 250000)
	assert.LessOrEqual(t, rec.QuotaAwarded, 500000,
		"未开启翻倍时不得超出配置区间上限")
}

// 随机区间 + 翻倍：结果必须落在 [min×倍数, max×倍数]。
func TestUserCheckin_DoubleDay_RangeScaled(t *testing.T) {
	setupCheckinTest(t)
	applyCheckinSetting(t, 250000, 500000, []int{todayWeekday()}, 2)

	for i := 0; i < 20; i++ {
		userID := 9100 + i
		seedCheckinUser(t, userID)
		rec, err := UserCheckin(userID)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, rec.QuotaAwarded, 500000)
		assert.LessOrEqual(t, rec.QuotaAwarded, 1000000)
	}
}

// 非整数倍率按向下取整，不能产生小数额度或负值。
func TestUserCheckin_FractionalMultiplier(t *testing.T) {
	setupCheckinTest(t)
	const userID = 9004
	seedCheckinUser(t, userID)
	applyCheckinSetting(t, 250001, 250001, []int{todayWeekday()}, 1.5)

	rec, err := UserCheckin(userID)
	require.NoError(t, err)
	// 250001 × 1.5 = 375001.5 → 取整 375001
	assert.Equal(t, 375001, rec.QuotaAwarded)
	assert.Greater(t, rec.QuotaAwarded, 0)
}

// 翻倍日重复签到仍受「今日已签到」保护，不能靠翻倍日刷额度。
func TestUserCheckin_DoubleDay_StillIdempotentPerDay(t *testing.T) {
	setupCheckinTest(t)
	const userID = 9005
	seedCheckinUser(t, userID)
	applyCheckinSetting(t, 250000, 250000, []int{todayWeekday()}, 2)

	_, err := UserCheckin(userID)
	require.NoError(t, err)
	_, err = UserCheckin(userID)
	require.Error(t, err, "同一天第二次签到必须被拒")
	assert.Equal(t, 500000, userQuota(t, userID), "被拒的那次不得再加额度")
}

// 签到日期与倍数判定必须取自同一时刻：记录里的日期换算出的星期，
// 应当与「是否翻倍」的判定一致，否则说明代码里各自调了一次 time.Now()。
func TestUserCheckin_DateAndWeekdayConsistent(t *testing.T) {
	setupCheckinTest(t)
	const userID = 9006
	seedCheckinUser(t, userID)
	applyCheckinSetting(t, 250000, 250000, []int{todayWeekday()}, 2)

	rec, err := UserCheckin(userID)
	require.NoError(t, err)

	parsed, err := time.ParseInLocation("2006-01-02", rec.CheckinDate, time.Local)
	require.NoError(t, err)
	assert.Equal(t, todayWeekday(), int(parsed.Weekday()),
		"CheckinDate 的星期与倍数判定所用的星期不一致")
	assert.Equal(t, 500000, rec.QuotaAwarded,
		"该日被配置为翻倍日，记录却没翻倍 —— 日期与倍数取自不同时刻")
}
