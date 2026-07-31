package model

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 复用 task_cas_test.go 的 TestMain（in-memory sqlite）。
// 注意：TestMain 里 SetMaxOpenConns(1)，SQLite 单连接会把 goroutine 串行化，
// 因此这里不试图靠真并发去"碰"竞态窗口（那样测不稳定），而是：
//  1. 用超额场景验证「余额判断已下推到 SQL」的语义边界；
//  2. 用串行叠加验证总消耗永不越过 amount_total。
// 竞态本身的根因（读-改-写 + 失效行锁）已由 SQL 层的条件更新消除，
// 生产 PostgreSQL 上由数据库保证。

func setupSubQuotaTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&UserSubscription{}, &SubscriptionPreConsumeRecord{}))
	require.NoError(t, DB.Exec("DELETE FROM user_subscriptions").Error)
	require.NoError(t, DB.Exec("DELETE FROM subscription_pre_consume_records").Error)
	// PreConsumeUserSubscription 会查 subscription_plans（getSubscriptionPlanByIdTx）
	require.NoError(t, DB.Exec(`CREATE TABLE IF NOT EXISTS subscription_plans (
		id INTEGER PRIMARY KEY, title TEXT, upgrade_group TEXT DEFAULT '',
		quota_reset_period TEXT DEFAULT 'never', quota_reset_custom_seconds INTEGER DEFAULT 0,
		enabled NUMERIC DEFAULT 1, created_at INTEGER, updated_at INTEGER, deleted_at DATETIME
	)`).Error)
	require.NoError(t, DB.Exec("DELETE FROM subscription_plans").Error)
	// never 重置，避免惰性重置干扰额度断言
	require.NoError(t, DB.Exec(
		`INSERT INTO subscription_plans (id,title,upgrade_group,quota_reset_period,enabled,created_at,updated_at)
		 VALUES (1,'p','g','never',1,0,0)`).Error)
}

func seedSub(t *testing.T, id, userId int, total, used int64) {
	t.Helper()
	now := int64(1700000000)
	require.NoError(t, DB.Create(&UserSubscription{
		Id: id, UserId: userId, PlanId: 1, UpgradeGroup: "g",
		AmountTotal: total, AmountUsed: used, Status: "active",
		StartTime: now - 3600, EndTime: now + 86400*3650,
	}).Error)
}

func subUsed(t *testing.T, id int) int64 {
	t.Helper()
	var s UserSubscription
	require.NoError(t, DB.Select("amount_used").Where("id = ?", id).First(&s).Error)
	return s.AmountUsed
}

// 累计消耗永不越过 amount_total —— 这是「平台不被白嫖」的核心不变式。
// 回归背景：原实现「读 amount_used → 判断 → +=amount → Save 绝对值」，
// 且本想用 Set("gorm:query_option","FOR UPDATE") 加行锁但那是 GORM v1 API，
// 在 v2 下静默失效，导致并发下额度被超额消耗。
func TestPreConsumeSubscription_NeverExceedsTotal(t *testing.T) {
	setupSubQuotaTest(t)
	const subID, userID = 501, 5001
	seedSub(t, subID, userID, 1000, 0)

	okCount := 0
	// 请求 10 次 × 每次 300，额度只有 1000 → 最多成功 3 次（900）
	for i := 0; i < 10; i++ {
		_, err := PreConsumeUserSubscription(
			fmt.Sprintf("req-exceed-%d", i), userID, "m", "g", 0, 300)
		if err == nil {
			okCount++
		}
	}

	assert.Equal(t, 3, okCount, "1000 额度、每次 300，应只成功 3 次")
	used := subUsed(t, subID)
	assert.Equal(t, int64(900), used)
	assert.LessOrEqual(t, used, int64(1000), "累计消耗绝不能越过 amount_total")
}

// 边界：剩余额度恰好等于请求量时必须成功（不能因 <= 写成 < 而误拒）
func TestPreConsumeSubscription_ExactRemainderSucceeds(t *testing.T) {
	setupSubQuotaTest(t)
	const subID, userID = 502, 5002
	seedSub(t, subID, userID, 1000, 700)

	res, err := PreConsumeUserSubscription("req-exact", userID, "m", "g", 0, 300)
	require.NoError(t, err, "剩余 300、请求 300 应当成功")
	assert.Equal(t, int64(1000), res.AmountUsedAfter)
	assert.Equal(t, int64(1000), subUsed(t, subID))
}

// 边界：超出 1 个单位就必须失败
func TestPreConsumeSubscription_OneOverFails(t *testing.T) {
	setupSubQuotaTest(t)
	const subID, userID = 503, 5003
	seedSub(t, subID, userID, 1000, 700)

	_, err := PreConsumeUserSubscription("req-over", userID, "m", "g", 0, 301)
	require.Error(t, err, "剩余 300、请求 301 必须失败")
	assert.Equal(t, int64(700), subUsed(t, subID), "失败时不得扣减额度")
}

// amount_total == 0 表示无限额度，条件更新的 WHERE 不能把它误判成「额度为零」
func TestPreConsumeSubscription_UnlimitedTotal(t *testing.T) {
	setupSubQuotaTest(t)
	const subID, userID = 504, 5004
	seedSub(t, subID, userID, 0, 0) // 0 = 无限

	for i := 0; i < 5; i++ {
		_, err := PreConsumeUserSubscription(
			fmt.Sprintf("req-unlim-%d", i), userID, "m", "g", 0, 1_000_000)
		require.NoError(t, err, "无限额度不应被拒")
	}
	assert.Equal(t, int64(5_000_000), subUsed(t, subID))
}

// 同一 requestId 重复调用只能扣一次（幂等），且不得因新增的回滚分支多扣或多退。
func TestPreConsumeSubscription_IdempotentSameRequestId(t *testing.T) {
	setupSubQuotaTest(t)
	const subID, userID = 505, 5005
	seedSub(t, subID, userID, 1000, 0)

	r1, err := PreConsumeUserSubscription("req-same", userID, "m", "g", 0, 200)
	require.NoError(t, err)
	assert.Equal(t, int64(200), subUsed(t, subID))

	// 同 requestId 再来一次
	r2, err := PreConsumeUserSubscription("req-same", userID, "m", "g", 0, 200)
	require.NoError(t, err)
	assert.Equal(t, int64(200), subUsed(t, subID), "幂等：重复调用不得二次扣减")
	assert.Equal(t, r1.UserSubscriptionId, r2.UserSubscriptionId)
	assert.Equal(t, int64(200), r2.PreConsumed)
}

// 并发调用（SQLite 单连接下会被串行化，故此处只验证「总量不越界 + 无 panic/死锁」，
// 真正的并发安全由 SQL 条件更新在 PostgreSQL 上保证）。
func TestPreConsumeSubscription_ConcurrentTotalBounded(t *testing.T) {
	setupSubQuotaTest(t)
	const subID, userID = 506, 5006
	seedSub(t, subID, userID, 1000, 0)

	const n = 20
	var wg sync.WaitGroup
	var mu sync.Mutex
	okCount := 0
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(idx int) {
			defer wg.Done()
			_, err := PreConsumeUserSubscription(
				fmt.Sprintf("req-conc-%d", idx), userID, "m", "g", 0, 100)
			if err == nil {
				mu.Lock()
				okCount++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	used := subUsed(t, subID)
	assert.Equal(t, 10, okCount, "1000 额度、每次 100，应恰好成功 10 次")
	assert.Equal(t, int64(1000), used)
	assert.LessOrEqual(t, used, int64(1000), "并发下累计消耗仍不得越过 amount_total")
}
