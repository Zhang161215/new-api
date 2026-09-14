package model

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

// 本地模拟用户场景：同分组两张月卡。
// A 五天后重置，B 今天重置。请求走 Codex_GPT_PRO。
// 断言整条 PreConsume 链路扣的是哪一张，而不只测排序函数。

const (
	flowPlanNever  = 21
	flowPlanWeekly = 22
)

func setupConsumeFlow(t *testing.T) {
	t.Helper()
	setupSubQuotaTest(t)
	require.NoError(t, DB.Exec("DELETE FROM users").Error)
	require.NoError(t, DB.Exec(
		`INSERT INTO subscription_plans (id,title,upgrade_group,quota_reset_period,enabled,created_at,updated_at)
		 VALUES (?, 'never','Codex_GPT_PRO','never',1,0,0),
		        (?, 'weekly','Codex_GPT_PRO','weekly',1,0,0)`,
		flowPlanNever, flowPlanWeekly).Error)
}

func seedFlowSub(t *testing.T, id, userId, planId int, group string, total, used, nextReset, lastReset int64) {
	t.Helper()
	now := time.Now().Unix()
	if lastReset <= 0 {
		lastReset = now - 86400
	}
	require.NoError(t, DB.Create(&UserSubscription{
		Id:            id,
		UserId:        userId,
		PlanId:        planId,
		UpgradeGroup:  group,
		AmountTotal:   total,
		AmountUsed:    used,
		Status:        "active",
		StartTime:     lastReset,
		EndTime:       now + 86400*60,
		NextResetTime: nextReset,
		LastResetTime: lastReset,
	}).Error)
}

func seedFlowUser(t *testing.T, userId int, preferredSubId int) {
	t.Helper()
	setting := dto.UserSetting{PreferredSubscriptionId: preferredSubId}
	raw, err := json.Marshal(setting)
	require.NoError(t, err)
	require.NoError(t, DB.Create(&User{
		Id:       userId,
		Username: fmt.Sprintf("flow-%d", userId),
		Password: "password",
		Status:   1,
		Setting:  string(raw),
	}).Error)
}

func consume(t *testing.T, req string, userId int, group string, amount int64) *SubscriptionPreConsumeResult {
	t.Helper()
	res, err := PreConsumeUserSubscription(req, userId, "gpt-5.6-sol", group, 0, amount)
	require.NoError(t, err)
	return res
}

func TestConsumeFlow_SoonestResetUsedFirst(t *testing.T) {
	setupConsumeFlow(t)
	const userID = 6101
	now := time.Now().Unix()
	// A 五天后重置，B 今天重置（1 小时后）
	seedFlowSub(t, 11, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 0, now+5*86400, 0)
	seedFlowSub(t, 12, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 0, now+3600, 0)

	res := consume(t, "flow-reset-1", userID, "Codex_GPT_PRO", 200)
	require.Equal(t, 12, res.UserSubscriptionId, "应先扣今天重置的 B")
	require.Equal(t, int64(200), subUsed(t, 12))
	require.Equal(t, int64(0), subUsed(t, 11), "五天后重置的 A 不应被动")
}

func TestConsumeFlow_FallbackWhenSoonestInsufficient(t *testing.T) {
	setupConsumeFlow(t)
	const userID = 6102
	now := time.Now().Unix()
	seedFlowSub(t, 21, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 0, now+5*86400, 0) // A
	seedFlowSub(t, 22, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 900, now+3600, 0)  // B 只剩 100

	res := consume(t, "flow-fallback-1", userID, "Codex_GPT_PRO", 200)
	require.Equal(t, 21, res.UserSubscriptionId, "B 不够 200 时应改扣 A")
	require.Equal(t, int64(900), subUsed(t, 22), "B 额度保持原样")
	require.Equal(t, int64(200), subUsed(t, 21))
}

func TestConsumeFlow_PreferredPinBeatsSoonerReset(t *testing.T) {
	setupConsumeFlow(t)
	const userID = 6103
	now := time.Now().Unix()
	seedFlowUser(t, userID, 31) // 指定先扣 A
	seedFlowSub(t, 31, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 0, now+5*86400, 0)
	seedFlowSub(t, 32, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 0, now+3600, 0)

	res := consume(t, "flow-pin-1", userID, "Codex_GPT_PRO", 150)
	require.Equal(t, 31, res.UserSubscriptionId, "点了优先扣 A 就应先扣 A，即使 B 更早重置")
	require.Equal(t, int64(150), subUsed(t, 31))
	require.Equal(t, int64(0), subUsed(t, 32))
}

func TestConsumeFlow_GroupMatchBeatsSoonerOtherGroup(t *testing.T) {
	setupConsumeFlow(t)
	const userID = 6104
	now := time.Now().Unix()
	seedFlowSub(t, 41, userID, flowPlanNever, "Claude_Aws", 1000, 0, now+600, 0)          // Claude 马上重置
	seedFlowSub(t, 42, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 0, now+5*86400, 0) // GPT 五天后重置

	res := consume(t, "flow-group-1", userID, "Codex_GPT_PRO", 120)
	require.Equal(t, 42, res.UserSubscriptionId, "GPT 请求不能先去扣马上重置的 Claude 卡")
	require.Equal(t, int64(120), subUsed(t, 42))
	require.Equal(t, int64(0), subUsed(t, 41))
}

func TestConsumeFlow_DueResetThenConsumeB(t *testing.T) {
	setupConsumeFlow(t)
	const userID = 6105
	now := time.Now().Unix()
	// B 上一周期已用掉 980，下次重置点已过；LastReset 必须是一周前，
	// 否则惰性重置会认为周期还没到，B 只剩 20，请求 200 会落到 A。
	seedFlowSub(t, 51, userID, flowPlanWeekly, "Codex_GPT_PRO", 1000, 100, now+5*86400, now-2*86400)
	seedFlowSub(t, 52, userID, flowPlanWeekly, "Codex_GPT_PRO", 1000, 980, now-60, now-7*86400)

	res := consume(t, "flow-due-reset-1", userID, "Codex_GPT_PRO", 200)
	require.Equal(t, 52, res.UserSubscriptionId, "今天该重置的 B 应先被选中")
	require.Equal(t, int64(200), subUsed(t, 52), "B 重置后从 0 起扣 200，不应是 980+200")
	require.Equal(t, int64(100), subUsed(t, 51), "A 不应被动")
}

func TestConsumeFlow_TwoRequestsDrainBThenA(t *testing.T) {
	setupConsumeFlow(t)
	const userID = 6106
	now := time.Now().Unix()
	seedFlowSub(t, 61, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 0, now+5*86400, 0) // A
	seedFlowSub(t, 62, userID, flowPlanNever, "Codex_GPT_PRO", 1000, 850, now+3600, 0)  // B 剩 150

	first := consume(t, "flow-seq-1", userID, "Codex_GPT_PRO", 150)
	require.Equal(t, 62, first.UserSubscriptionId, "第一笔应抽干 B")
	require.Equal(t, int64(1000), subUsed(t, 62))

	second := consume(t, "flow-seq-2", userID, "Codex_GPT_PRO", 150)
	require.Equal(t, 61, second.UserSubscriptionId, "B 抽干后第二笔才扣 A")
	require.Equal(t, int64(150), subUsed(t, 61))
}
