package service

// billing_cross_group_test.go
// 跨组计费回归测试 — 覆盖 model.GetActiveSubscriptionUpgradeGroups 与
// service.NewBillingSession 在不同 BillingPreference + usingGroup 下的资金来源选择。
//
// 复用 task_billing_test.go 中已有的 TestMain（in-memory sqlite + AutoMigrate User/Token/Channel/UserSubscription）。
// 本文件按需补充 SubscriptionPlan 的迁移，并实现 cross-group 场景所需的 seed 与断言。

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// 确保 SubscriptionPlan / SubscriptionPreConsumeRecord 表存在
// （glebarez/sqlite 对 decimal(10,6) DDL 解析失败，用最小列集合手工建表绕开）。
// 这里仅用到测试所需的列。
var subscriptionPlanTableOnce bool

func ensureSubscriptionPlanMigrated(t *testing.T) {
	t.Helper()
	if subscriptionPlanTableOnce {
		return
	}
	require.NoError(t, model.DB.Exec(`CREATE TABLE IF NOT EXISTS subscription_plans (
		id INTEGER PRIMARY KEY,
		title TEXT,
		upgrade_group TEXT DEFAULT '',
		quota_reset_period TEXT DEFAULT 'never',
		quota_reset_custom_seconds INTEGER DEFAULT 0,
		enabled NUMERIC DEFAULT 1,
		created_at INTEGER,
		updated_at INTEGER,
		-- SubscriptionPlan 带 gorm.DeletedAt（软删除），GORM 会给所有查询
		-- 自动附加 deleted_at IS NULL，缺这一列会让计费路径取套餐直接报错
		deleted_at DATETIME
	)`).Error)
	require.NoError(t, model.DB.AutoMigrate(&model.SubscriptionPreConsumeRecord{}))
	subscriptionPlanTableOnce = true
}

func truncateCross(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM tasks")
		model.DB.Exec("DELETE FROM users")
		model.DB.Exec("DELETE FROM tokens")
		model.DB.Exec("DELETE FROM logs")
		model.DB.Exec("DELETE FROM channels")
		model.DB.Exec("DELETE FROM user_subscriptions")
		model.DB.Exec("DELETE FROM subscription_plans")
		model.DB.Exec("DELETE FROM subscription_pre_consume_records")
	})
}

func seedSubWithGroup(t *testing.T, id, userId, planId int, upgradeGroup string, total, used int64, status string, endOffsetSec int64) {
	t.Helper()
	now := time.Now().Unix()
	sub := &model.UserSubscription{
		Id:           id,
		UserId:       userId,
		PlanId:       planId,
		UpgradeGroup: upgradeGroup,
		AmountTotal:  total,
		AmountUsed:   used,
		Status:       status,
		StartTime:    now - 3600,
		EndTime:      now + endOffsetSec,
	}
	require.NoError(t, model.DB.Create(sub).Error)
}

func seedPlan(t *testing.T, id int, upgradeGroup string) {
	t.Helper()
	// 直接 INSERT，避开 SubscriptionPlan 完整结构的字段约束
	now := time.Now().Unix()
	err := model.DB.Exec(
		`INSERT INTO subscription_plans (id, title, upgrade_group, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, "plan-"+upgradeGroup, upgradeGroup, 1, now, now,
	).Error
	require.NoError(t, err)
}

// ===========================================================================
// Layer 1: model.GetActiveSubscriptionUpgradeGroups
// ===========================================================================

func TestGetActiveSubscriptionUpgradeGroups_InvalidUserId(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	_, err := model.GetActiveSubscriptionUpgradeGroups(0)
	assert.Error(t, err)

	_, err = model.GetActiveSubscriptionUpgradeGroups(-5)
	assert.Error(t, err)
}

func TestGetActiveSubscriptionUpgradeGroups_NoSubscription(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	groups, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Empty(t, groups)
}

func TestGetActiveSubscriptionUpgradeGroups_SingleActiveWithGroup(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	seedSubWithGroup(t, 1, 1001, 1, "gpt_month", 100000, 0, "active", 86400)

	groups, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Len(t, groups, 1)
	assert.True(t, groups["gpt_month"])
}

func TestGetActiveSubscriptionUpgradeGroups_FallbackToPlanGroup(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	seedPlan(t, 11, "vip")
	// us.upgrade_group 为空 -> fallback 到 plan
	seedSubWithGroup(t, 1, 1001, 11, "", 100000, 0, "active", 86400)

	groups, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Len(t, groups, 1)
	assert.True(t, groups["vip"])
}

func TestGetActiveSubscriptionUpgradeGroups_FallbackTrim(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	seedPlan(t, 12, "  svip  ") // plan group 含空格
	// us.upgrade_group 为纯空白
	seedSubWithGroup(t, 2, 1001, 12, "   ", 100000, 0, "active", 86400)

	groups, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Len(t, groups, 1)
	assert.True(t, groups["svip"], "应当 TrimSpace 后命中 svip")
}

func TestGetActiveSubscriptionUpgradeGroups_MultiActive(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	seedSubWithGroup(t, 1, 1001, 1, "gpt_month", 100000, 0, "active", 86400)
	seedSubWithGroup(t, 2, 1001, 2, "svip", 200000, 0, "active", 86400)

	groups, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Len(t, groups, 2)
	assert.True(t, groups["gpt_month"])
	assert.True(t, groups["svip"])
}

func TestGetActiveSubscriptionUpgradeGroups_DedupSameGroup(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	seedSubWithGroup(t, 1, 1001, 1, "gpt_month", 100000, 0, "active", 86400)
	seedSubWithGroup(t, 2, 1001, 1, "gpt_month", 50000, 0, "active", 86400)

	groups, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Len(t, groups, 1)
	assert.True(t, groups["gpt_month"])
}

func TestGetActiveSubscriptionUpgradeGroups_IgnoresExpiredAndCancelled(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	// active 但已过期 (end_time <= now)
	seedSubWithGroup(t, 1, 1001, 1, "expired_grp", 100000, 0, "active", -10)
	// status 不是 active
	seedSubWithGroup(t, 2, 1001, 1, "cancelled_grp", 100000, 0, "cancelled", 86400)
	// 真正 active
	seedSubWithGroup(t, 3, 1001, 1, "gpt_month", 100000, 0, "active", 86400)

	groups, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Len(t, groups, 1)
	assert.True(t, groups["gpt_month"])
	assert.False(t, groups["expired_grp"])
	assert.False(t, groups["cancelled_grp"])
}

func TestGetActiveSubscriptionUpgradeGroups_IsolatedByUser(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	seedSubWithGroup(t, 1, 1001, 1, "gpt_month", 100000, 0, "active", 86400)
	seedSubWithGroup(t, 2, 1002, 1, "svip", 100000, 0, "active", 86400)

	g1, err := model.GetActiveSubscriptionUpgradeGroups(1001)
	require.NoError(t, err)
	assert.Len(t, g1, 1)
	assert.True(t, g1["gpt_month"])
	assert.False(t, g1["svip"])

	g2, err := model.GetActiveSubscriptionUpgradeGroups(1002)
	require.NoError(t, err)
	assert.Len(t, g2, 1)
	assert.True(t, g2["svip"])
}

// ===========================================================================
// Layer 2: service.NewBillingSession 跨组判断
// ===========================================================================

// makeRelayInfo 组装一个最小可用的 RelayInfo，用于 NewBillingSession 测试。
// 关键字段：UserId / UserGroup / UsingGroup / Token* / UserSetting.BillingPreference。
// 通过 IsPlayground=true 跳过 PreConsumeTokenQuota，简化测试 setup。
func makeRelayInfo(userId, tokenId int, tokenKey, userGroup, usingGroup, billingPref string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RequestId:       fmt.Sprintf("test-req-%d-%d-%d", userId, tokenId, time.Now().UnixNano()),
		UserId:          userId,
		UserGroup:       userGroup,
		UsingGroup:      usingGroup,
		TokenId:         tokenId,
		TokenKey:        tokenKey,
		TokenUnlimited:  false,
		IsPlayground:    true, // 跳过 PreConsumeTokenQuota
		ForcePreConsume: true, // 禁用信任额度旁路，强制走 funding.PreConsume
		UserSetting: dto.UserSetting{
			BillingPreference: billingPref,
		},
		OriginModelName: "test-model",
	}
}

func newTestGinContext() *gin.Context {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	return c
}

// 用例 1：subscription_first + usingGroup 匹配订阅组 → 走订阅
func TestNewBillingSession_CrossGroup_SubscriptionFirst_Matching(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, planID, subID = 2001, 2001, 101, 1
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-1", 5_000_000)
	seedPlan(t, planID, "gpt_month")
	seedSubWithGroup(t, subID, userID, planID, "gpt_month", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-1", "gpt_month", "gpt_month", "subscription_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())

	// 资金来源未扣 user.quota
	assert.Equal(t, 10_000_000, getUserQuota(t, userID))
	// 订阅 amount_used 增加
	assert.Equal(t, int64(1000), getSubscriptionUsed(t, subID))
}

// 用例 2：subscription_first + usingGroup 不在订阅组内 → 强制钱包
func TestNewBillingSession_CrossGroup_SubscriptionFirst_NonMatching(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, subID = 2002, 2002, 1
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-2", 5_000_000)
	seedSubWithGroup(t, subID, userID, 1, "gpt_month", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-2", "gpt_month", "default", "subscription_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())

	// user.quota 被扣减
	assert.Equal(t, 10_000_000-1000, getUserQuota(t, userID))
	// 订阅 amount_used 未变
	assert.Equal(t, int64(0), getSubscriptionUsed(t, subID))
}

// 用例 3：subscription_only 在跨组时仍然强制走钱包（决策 1：统一规则覆盖偏好）
func TestNewBillingSession_CrossGroup_SubscriptionOnly_NonMatchingForcedWallet(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, subID = 2003, 2003, 1
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-3", 5_000_000)
	seedSubWithGroup(t, subID, userID, 1, "gpt_month", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-3", "gpt_month", "default", "subscription_only")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source(),
		"subscription_only 在跨组时应被强制改写为 wallet_only")

	assert.Equal(t, 10_000_000-1000, getUserQuota(t, userID))
	assert.Equal(t, int64(0), getSubscriptionUsed(t, subID))
}

// 用例 4：vip 订阅组 + usingGroup=default（决策 2：vip 例外被删除）
func TestNewBillingSession_CrossGroup_VipNoLongerExcepted(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, subID = 2004, 2004, 1
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-4", 5_000_000)
	seedSubWithGroup(t, subID, userID, 1, "vip", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-4", "vip", "default", "subscription_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source(),
		"vip 订阅用户在 usingGroup=default 时也应走钱包")

	assert.Equal(t, 10_000_000-1000, getUserQuota(t, userID))
	assert.Equal(t, int64(0), getSubscriptionUsed(t, subID))
}

// 用例 5：wallet_first + usingGroup 匹配订阅组 → 不触发跨组逻辑，钱包优先
func TestNewBillingSession_WalletFirst_Matching_GoesWallet(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, subID = 2005, 2005, 1
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-5", 5_000_000)
	seedSubWithGroup(t, subID, userID, 1, "gpt_month", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-5", "gpt_month", "gpt_month", "wallet_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())

	assert.Equal(t, 10_000_000-1000, getUserQuota(t, userID))
	assert.Equal(t, int64(0), getSubscriptionUsed(t, subID))
}

// 用例 6：wallet_only + 任意 usingGroup → 钱包（pref 早已是 wallet_only，跨组判断改写也是 wallet_only）
func TestNewBillingSession_WalletOnly_NoChange(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID = 2006, 2006
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-6", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-6", "default", "default", "wallet_only")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 10_000_000-1000, getUserQuota(t, userID))
}

// 用例 7：无订阅用户 + subscription_first → 跳过跨组判断，按 hasSub=false 回退钱包
func TestNewBillingSession_NoSubscription_FallbackWallet(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID = 2007, 2007
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-7", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-7", "default", "default", "subscription_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 10_000_000-1000, getUserQuota(t, userID))
}

// 用例 8：双订阅 {gpt_month, svip} + usingGroup=svip → 命中 svip 订阅
func TestNewBillingSession_MultiSubscriptions_HitSvip(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, subGptID, subSvipID, planGpt, planSvip = 2008, 2008, 11, 12, 108, 208
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-8", 5_000_000)
	seedPlan(t, planGpt, "gpt_month")
	seedPlan(t, planSvip, "svip")
	seedSubWithGroup(t, subGptID, userID, planGpt, "gpt_month", 5_000_000, 0, "active", 86400)
	seedSubWithGroup(t, subSvipID, userID, planSvip, "svip", 7_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-8", "svip", "svip", "subscription_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())

	assert.Equal(t, 10_000_000, getUserQuota(t, userID))
	// gpt_month 未动，svip 被扣
	assert.Equal(t, int64(0), getSubscriptionUsed(t, subGptID))
	assert.Equal(t, int64(1000), getSubscriptionUsed(t, subSvipID))
}

// 用例 9：usingGroup="" 边界 → 跳过跨组判断，按 pref 走
func TestNewBillingSession_EmptyUsingGroup_Skipped(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, planID, subID = 2009, 2009, 109, 1
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-9", 5_000_000)
	seedPlan(t, planID, "gpt_month")
	seedSubWithGroup(t, subID, userID, planID, "gpt_month", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-9", "gpt_month", "", "subscription_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	// 即便 usingGroup="" 不在 activeGroups 内，跨组判断也被前置 if 跳过 → 按 subscription_first 走订阅
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())

	assert.Equal(t, 10_000_000, getUserQuota(t, userID))
	assert.Equal(t, int64(1000), getSubscriptionUsed(t, subID))
}

// 用例 10：双订阅，usingGroup=default 不命中任一 → 强制钱包，订阅都不扣
func TestNewBillingSession_MultiSubscriptions_NoMatch_Wallet(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, subA, subB = 2010, 2010, 21, 22
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-10", 5_000_000)
	seedSubWithGroup(t, subA, userID, 1, "gpt_month", 5_000_000, 0, "active", 86400)
	seedSubWithGroup(t, subB, userID, 2, "svip", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-cross-10", "gpt_month", "default", "subscription_first")

	session, apiErr := NewBillingSession(c, ri, 1000)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())

	assert.Equal(t, 10_000_000-1000, getUserQuota(t, userID))
	assert.Equal(t, int64(0), getSubscriptionUsed(t, subA))
	assert.Equal(t, int64(0), getSubscriptionUsed(t, subB))
}

// 用例 11：subscription_first，usingGroup 来自 plan fallback（us.upgrade_group 为空）
func TestNewBillingSession_CrossGroup_UsingPlanFallbackGroup(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID, planID, subID = 2011, 2011, 31, 31
	seedUser(t, userID, 10_000_000)
	seedToken(t, tokenID, userID, "sk-cross-11", 5_000_000)
	seedPlan(t, planID, "vip")
	// us.upgrade_group 为空 -> fallback 到 plan vip
	seedSubWithGroup(t, subID, userID, planID, "", 5_000_000, 0, "active", 86400)

	c := newTestGinContext()

	// usingGroup=vip 落在 fallback 集合内 → 走订阅
	ri := makeRelayInfo(userID, tokenID, "sk-cross-11", "vip", "vip", "subscription_first")
	session, apiErr := NewBillingSession(c, ri, 500)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())
	assert.Equal(t, int64(500), getSubscriptionUsed(t, subID))
	assert.Equal(t, 10_000_000, getUserQuota(t, userID))
}

func init() {
	// 保证测试环境内 QuotaPerUnit 已初始化（用于 trust quota 等），即使本测试关闭了 trust。
	if common.QuotaPerUnit == 0 {
		common.QuotaPerUnit = 500000
	}
}
