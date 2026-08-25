package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// 复用 task_cas_test.go 的 TestMain（in-memory sqlite），
// 但那里没有迁移 UserSubscription，这里按需补上。
func setupDowngradeTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&User{}, &UserSubscription{}))
	require.NoError(t, DB.Exec("DELETE FROM user_subscriptions").Error)
	require.NoError(t, DB.Exec("DELETE FROM users").Error)
}

func mkUser(t *testing.T, id int, group string) {
	t.Helper()
	require.NoError(t, DB.Exec(
		"INSERT INTO users (id, username, password, `group`) VALUES (?, ?, ?, ?)",
		id, "u", "x", group).Error)
}

func mkSub(t *testing.T, userId int, status, upgradeGroup, prevGroup string, endTime int64) {
	t.Helper()
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:        userId,
		Status:        status,
		UpgradeGroup:  upgradeGroup,
		PrevUserGroup: prevGroup,
		EndTime:       endTime,
	}).Error)
}

// prev_user_group 为空时必须兜底到 default。
// 回归背景：原实现遇到空值直接 return，线上 41 个用户因此永久卡在付费分组。
func TestResolveDowngradeTarget_EmptyPrevFallsBackToDefault(t *testing.T) {
	setupDowngradeTest(t)
	now := time.Now().Unix()

	mkUser(t, 1, "Codex_GPT_PRO")
	mkSub(t, 1, "expired", "Codex_GPT_PRO", "", now-86400)

	got, err := resolveDowngradeTargetTx(DB, 1, "Codex_GPT_PRO", now)
	require.NoError(t, err)
	require.Equal(t, "default", got)
}

// 多层订阅叠加时必须一路回落到底，而不是只退一层。
// 回归背景：原实现只看「最后一条 expired」，用户会停在 GPT_Month 继续白用。
func TestResolveDowngradeTarget_ChainsDownMultipleLayers(t *testing.T) {
	setupDowngradeTest(t)
	now := time.Now().Unix()

	mkUser(t, 2, "Claude_Aws")
	// 先买了升到 GPT_Month 的（prev=default），后买了升到 Claude_Aws 的（prev=GPT_Month）
	mkSub(t, 2, "expired", "GPT_Month", "default", now-200000)
	mkSub(t, 2, "expired", "Claude_Aws", "GPT_Month", now-86400)

	got, err := resolveDowngradeTargetTx(DB, 2, "Claude_Aws", now)
	require.NoError(t, err)
	require.Equal(t, "default", got, "应穿过 GPT_Month 一路回落到 default")
}

// 中间层若仍有生效订阅撑着，必须停在那一层。
func TestResolveDowngradeTarget_StopsAtLayerWithActiveSub(t *testing.T) {
	setupDowngradeTest(t)
	now := time.Now().Unix()

	mkUser(t, 3, "Claude_Aws")
	mkSub(t, 3, "expired", "GPT_Month", "default", now-200000)
	mkSub(t, 3, "expired", "Claude_Aws", "GPT_Month", now-86400)
	// GPT_Month 还有一张没到期的
	mkSub(t, 3, "active", "GPT_Month", "default", now+86400)

	got, err := resolveDowngradeTargetTx(DB, 3, "Claude_Aws", now)
	require.NoError(t, err)
	require.Equal(t, "GPT_Month", got, "GPT_Month 仍有生效订阅，不能继续往下降")
}

// 没有任何订阅能解释当前分组时不得改动 —— 那是管理员手动设的白名单。
func TestResolveDowngradeTarget_LeavesManuallySetGroupAlone(t *testing.T) {
	setupDowngradeTest(t)
	now := time.Now().Unix()

	mkUser(t, 4, "vip_whitelist")
	// 该用户有别的过期订阅，但没有任何一条升级到 vip_whitelist
	mkSub(t, 4, "expired", "GPT_Month", "default", now-86400)

	got, err := resolveDowngradeTargetTx(DB, 4, "vip_whitelist", now)
	require.NoError(t, err)
	require.Equal(t, "vip_whitelist", got, "管理员手动设置的分组不能被误降")
}

// 环形数据不能把循环卡死。
func TestResolveDowngradeTarget_TerminatesOnCyclicData(t *testing.T) {
	setupDowngradeTest(t)
	now := time.Now().Unix()

	mkUser(t, 5, "A")
	mkSub(t, 5, "expired", "A", "B", now-86400)
	mkSub(t, 5, "expired", "B", "A", now-86400)

	done := make(chan struct{})
	go func() {
		_, err := resolveDowngradeTargetTx(DB, 5, "A", now)
		require.NoError(t, err)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("环形数据导致死循环，maxHops 未生效")
	}
}

func currentUserGroup(t *testing.T, userId int) string {
	t.Helper()
	g, err := getUserGroupByIdTx(DB, userId)
	require.NoError(t, err)
	return g
}

// 叠了不同分组的订阅：日卡到期时月卡还在，账号必须从日卡组退回月卡组。
// 回归：原实现发现「还有别的生效订阅」就直接 return，用户卡在 Claude_Aws，
// GPT 月卡因此丢掉 1x 专属倍率（线上用户 1688）。
func TestDowngrade_StackedDayCardExpire_ReturnsToMonthly(t *testing.T) {
	setupDowngradeTest(t)
	now := time.Now().Unix()

	mkUser(t, 10, "Claude_Aws")
	monthly := &UserSubscription{
		UserId:        10,
		Status:        "active",
		UpgradeGroup:  "Codex_GPT_PRO",
		PrevUserGroup: "default",
		EndTime:       now + 86400,
	}
	require.NoError(t, DB.Create(monthly).Error)
	day := &UserSubscription{
		UserId:        10,
		Status:        "active",
		UpgradeGroup:  "Claude_Aws",
		PrevUserGroup: "Codex_GPT_PRO",
		EndTime:       now + 3600,
	}
	require.NoError(t, DB.Create(day).Error)

	got, err := downgradeUserGroupForSubscriptionTx(DB, day, now)
	require.NoError(t, err)
	require.Equal(t, "Codex_GPT_PRO", got)
	require.Equal(t, "Codex_GPT_PRO", currentUserGroup(t, 10))
}

// 月卡先到期、日卡还在：账号本来就在日卡组，不应被改走。
func TestDowngrade_StackedMonthlyExpire_WhileDayActive_StaysOnDay(t *testing.T) {
	setupDowngradeTest(t)
	now := time.Now().Unix()

	mkUser(t, 11, "Claude_Aws")
	monthly := &UserSubscription{
		UserId:        11,
		Status:        "active",
		UpgradeGroup:  "Codex_GPT_PRO",
		PrevUserGroup: "default",
		EndTime:       now + 86400,
	}
	require.NoError(t, DB.Create(monthly).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:        11,
		Status:        "active",
		UpgradeGroup:  "Claude_Aws",
		PrevUserGroup: "Codex_GPT_PRO",
		EndTime:       now + 3600,
	}).Error)

	got, err := downgradeUserGroupForSubscriptionTx(DB, monthly, now)
	require.NoError(t, err)
	require.Equal(t, "", got, "日卡仍有效，分组不该动")
	require.Equal(t, "Claude_Aws", currentUserGroup(t, 11))
}

// 定时过期任务：日卡 end_time 已到、月卡仍有效 → 必须改分组，不能因为还有月卡就跳过。
func TestExpireDueSubscriptions_StackedDayCard_ReturnsToMonthly(t *testing.T) {
	setupDowngradeTest(t)
	now := GetDBTimestamp()

	mkUser(t, 12, "Claude_Aws")
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:        12,
		Status:        "active",
		UpgradeGroup:  "Codex_GPT_PRO",
		PrevUserGroup: "default",
		EndTime:       now + 86400,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:        12,
		Status:        "active",
		UpgradeGroup:  "Claude_Aws",
		PrevUserGroup: "Codex_GPT_PRO",
		EndTime:       now - 10,
	}).Error)

	n, err := ExpireDueSubscriptions(50)
	require.NoError(t, err)
	require.Equal(t, 1, n)
	require.Equal(t, "Codex_GPT_PRO", currentUserGroup(t, 12))

	var day UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND upgrade_group = ?", 12, "Claude_Aws").First(&day).Error)
	require.Equal(t, "expired", day.Status)
}
