package service

// billing_scenarios_test.go
// 跨多种账户类型 × 多种 BillingPreference × 多种 usingGroup 的综合矩阵测试。
// 7 类账户 (A-G) + 各自所有可能的跨组场景组合，确保余额安全。
//
// 复用 task_billing_test.go 的 TestMain 与 seed helpers；
// 复用 billing_cross_group_test.go 的 ensureSubscriptionPlanMigrated / makeRelayInfo / newTestGinContext。

import (
	"testing"

	"github.com/QuantumNous/new-api/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// scenarioAccount 描述一个测试账户的初始状态。
type scenarioAccount struct {
	name        string
	userId      int
	tokenId     int
	tokenKey    string
	tokenQuota  int
	userQuota   int
	userGroup   string
	subs        []scenarioSub // 该用户的订阅集合（可为空）
}

// scenarioSub 描述一条订阅。
type scenarioSub struct {
	subId        int
	planId       int
	upgradeGroup string
	total        int64
	used         int64
	status       string // active / expired / cancelled
	endOffsetSec int64  // end_time = now + offset；负数为已过期
}

// scenarioExpect 描述一次 NewBillingSession 调用的预期结果。
type scenarioExpect struct {
	pref        string
	usingGroup  string
	preConsume  int

	wantErr      bool          // 期望返回错误
	wantErrCode  types.ErrorCode // 期望的错误代码（仅 wantErr=true 时检查）
	wantSource   string         // 期望的资金来源
	deltaQuota   int            // user.quota 期望变化量（负数=扣减）
	deltaSubUsed map[int]int64  // 各 subId 期望的 amount_used 增量
}

// runScenario 在干净 DB 上初始化账户，跑 NewBillingSession，断言结果与余额变化。
func runScenario(t *testing.T, acc scenarioAccount, exp scenarioExpect, caseName string) {
	t.Run(caseName, func(t *testing.T) {
		ensureSubscriptionPlanMigrated(t)
		truncateCross(t)

		// 1) 创建用户 + token
		seedUser(t, acc.userId, acc.userQuota)
		seedToken(t, acc.tokenId, acc.userId, acc.tokenKey, acc.tokenQuota)

		// 2) 创建订阅 + 对应 plan
		seenPlanIds := make(map[int]bool)
		for _, s := range acc.subs {
			if s.planId > 0 && !seenPlanIds[s.planId] {
				seedPlan(t, s.planId, s.upgradeGroup)
				seenPlanIds[s.planId] = true
			}
			seedSubWithGroup(t, s.subId, acc.userId, s.planId, s.upgradeGroup, s.total, s.used, s.status, s.endOffsetSec)
		}

		// 3) 记录初始余额
		quotaBefore := getUserQuota(t, acc.userId)
		subUsedBefore := make(map[int]int64, len(acc.subs))
		for _, s := range acc.subs {
			subUsedBefore[s.subId] = getSubscriptionUsed(t, s.subId)
		}

		// 4) 跑 NewBillingSession
		c := newTestGinContext()
		ri := makeRelayInfo(acc.userId, acc.tokenId, acc.tokenKey, acc.userGroup, exp.usingGroup, exp.pref)
		session, apiErr := NewBillingSession(c, ri, exp.preConsume)

		// 5) 断言
		if exp.wantErr {
			require.NotNil(t, apiErr, "expect error but got nil session=%v", session)
			if exp.wantErrCode != "" {
				assert.Equal(t, exp.wantErrCode, apiErr.GetErrorCode(),
					"err msg=%v", apiErr.Error())
			}
			// 错误路径不应该错扣余额
			assert.Equal(t, quotaBefore, getUserQuota(t, acc.userId), "quota 不应在错误路径中变化")
			for _, s := range acc.subs {
				assert.Equal(t, subUsedBefore[s.subId], getSubscriptionUsed(t, s.subId),
					"subId=%d amount_used 不应在错误路径中变化", s.subId)
			}
			return
		}

		require.Nil(t, apiErr, "expect success but got error: %v", apiErr)
		require.NotNil(t, session)

		// 资金来源
		assert.Equal(t, exp.wantSource, session.funding.Source(), "funding source mismatch")

		// 余额变化
		quotaAfter := getUserQuota(t, acc.userId)
		assert.Equal(t, quotaBefore+exp.deltaQuota, quotaAfter,
			"user.quota 变化不符合预期 (before=%d, after=%d, expected delta=%d)",
			quotaBefore, quotaAfter, exp.deltaQuota)

		for _, s := range acc.subs {
			want := subUsedBefore[s.subId] + exp.deltaSubUsed[s.subId]
			got := getSubscriptionUsed(t, s.subId)
			assert.Equal(t, want, got,
				"subId=%d amount_used 变化不符合预期 (before=%d, after=%d, expected delta=%d)",
				s.subId, subUsedBefore[s.subId], got, exp.deltaSubUsed[s.subId])
		}
	})
}

// ---------------------------------------------------------------------------
// 账户 A：「黄金会员」有订阅 (gpt_month, 5M/0) + 有钱包 (10M)
// ---------------------------------------------------------------------------

func TestScenario_AccountA_GoldMember(t *testing.T) {
	mkAcc := func() scenarioAccount {
		return scenarioAccount{
			name:       "A_GoldMember",
			userId:     3001,
			tokenId:    3001,
			tokenKey:   "sk-A",
			tokenQuota: 5_000_000,
			userQuota:  10_000_000,
			userGroup:  "gpt_month",
			subs: []scenarioSub{
				{subId: 301, planId: 1001, upgradeGroup: "gpt_month", total: 5_000_000, used: 0, status: "active", endOffsetSec: 86400},
			},
		}
	}

	const q = 1000

	// A1: subscription_first + 命中 → 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{301: int64(q)},
	}, "A1_subscription_first_match→subscription")

	// A2: subscription_first + 不命中 → 强制钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{301: 0},
	}, "A2_subscription_first_nomatch→wallet")

	// A3: subscription_only + 命中 → 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{301: int64(q)},
	}, "A3_subscription_only_match→subscription")

	// A4: subscription_only + 不命中 → 强制钱包（决策 1）
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{301: 0},
	}, "A4_subscription_only_nomatch→wallet(forced)")

	// A5: wallet_first + 命中 → 钱包（钱包优先）
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{301: 0},
	}, "A5_wallet_first_match→wallet")

	// A6: wallet_only → 钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_only", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{301: 0},
	}, "A6_wallet_only→wallet")
}

// ---------------------------------------------------------------------------
// 账户 B：「纯订阅党」有订阅 (gpt_month, 5M/0) + 钱包空 (0)
// ---------------------------------------------------------------------------

func TestScenario_AccountB_SubscriptionOnly(t *testing.T) {
	mkAcc := func() scenarioAccount {
		return scenarioAccount{
			name:       "B_SubOnly",
			userId:     3002,
			tokenId:    3002,
			tokenKey:   "sk-B",
			tokenQuota: 5_000_000,
			userQuota:  0,
			userGroup:  "gpt_month",
			subs: []scenarioSub{
				{subId: 302, planId: 1002, upgradeGroup: "gpt_month", total: 5_000_000, used: 0, status: "active", endOffsetSec: 86400},
			},
		}
	}

	const q = 1000

	// B1: subscription_first + 命中 → 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{302: int64(q)},
	}, "B1_subscription_first_match→subscription")

	// B2: subscription_first + 不命中 → 强制钱包 → 钱包为 0 → 失败 (核心余额保护点！)
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "default", preConsume: q,
		wantErr: true, wantErrCode: types.ErrorCodeInsufficientUserQuota,
	}, "B2_subscription_first_nomatch→wallet_empty→FAIL")

	// B3: subscription_only + 命中 → 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{302: int64(q)},
	}, "B3_subscription_only_match→subscription")

	// B4: subscription_only + 不命中 → 强制钱包 → 钱包为 0 → 失败 (决策 1 + 余额保护)
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "default", preConsume: q,
		wantErr: true, wantErrCode: types.ErrorCodeInsufficientUserQuota,
	}, "B4_subscription_only_nomatch→wallet_empty→FAIL(forced)")

	// B5: wallet_first + 命中 → 钱包失败 fallback 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{302: int64(q)},
	}, "B5_wallet_first_walletempty→fallback_subscription")

	// B6: wallet_only + 钱包空 → 失败
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_only", usingGroup: "gpt_month", preConsume: q,
		wantErr: true, wantErrCode: types.ErrorCodeInsufficientUserQuota,
	}, "B6_wallet_only_empty→FAIL")
}

// ---------------------------------------------------------------------------
// 账户 C：「白嫖党」无订阅 + 钱包充足 (10M)
// ---------------------------------------------------------------------------

func TestScenario_AccountC_NoSubWithWallet(t *testing.T) {
	mkAcc := func() scenarioAccount {
		return scenarioAccount{
			name:       "C_NoSub",
			userId:     3003,
			tokenId:    3003,
			tokenKey:   "sk-C",
			tokenQuota: 5_000_000,
			userQuota:  10_000_000,
			userGroup:  "default",
			subs:       nil,
		}
	}

	const q = 1000

	// C1: subscription_first → activeGroups 空跳过跨组 → hasSub=false → 钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
	}, "C1_subscription_first→wallet(no_sub)")

	// C2: subscription_only → 无订阅，直接走 trySubscription → 失败
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "default", preConsume: q,
		wantErr: true,
	}, "C2_subscription_only_no_sub→FAIL")

	// C3: wallet_first → 钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_first", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
	}, "C3_wallet_first→wallet")

	// C4: wallet_only → 钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_only", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
	}, "C4_wallet_only→wallet")

	// C5: 用 vip 等非默认 usingGroup（无订阅时不影响）
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "vip", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
	}, "C5_subscription_first_vip_no_sub→wallet")
}

// ---------------------------------------------------------------------------
// 账户 D：「赤贫户」无订阅 + 钱包空
// ---------------------------------------------------------------------------

func TestScenario_AccountD_Bankrupt(t *testing.T) {
	mkAcc := func() scenarioAccount {
		return scenarioAccount{
			name:       "D_Bankrupt",
			userId:     3004,
			tokenId:    3004,
			tokenKey:   "sk-D",
			tokenQuota: 5_000_000,
			userQuota:  0,
			userGroup:  "default",
			subs:       nil,
		}
	}

	const q = 1000

	// D1: subscription_first → 走钱包 → 失败
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "default", preConsume: q,
		wantErr: true, wantErrCode: types.ErrorCodeInsufficientUserQuota,
	}, "D1_subscription_first→FAIL")

	// D2: wallet_only → 失败
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_only", usingGroup: "default", preConsume: q,
		wantErr: true, wantErrCode: types.ErrorCodeInsufficientUserQuota,
	}, "D2_wallet_only→FAIL")

	// D3: subscription_only → 失败
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "default", preConsume: q,
		wantErr: true,
	}, "D3_subscription_only→FAIL")

	// D4: wallet_first → 失败
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_first", usingGroup: "default", preConsume: q,
		wantErr: true,
	}, "D4_wallet_first→FAIL")
}

// ---------------------------------------------------------------------------
// 账户 E：「订阅余额不足」订阅快耗尽 (500/499) + 钱包充足 (10M)
// ---------------------------------------------------------------------------

func TestScenario_AccountE_SubscriptionLow(t *testing.T) {
	mkAcc := func() scenarioAccount {
		return scenarioAccount{
			name:       "E_SubLow",
			userId:     3005,
			tokenId:    3005,
			tokenKey:   "sk-E",
			tokenQuota: 5_000_000,
			userQuota:  10_000_000,
			userGroup:  "gpt_month",
			subs: []scenarioSub{
				// 剩余只有 1 单位，无法满足 q=1000
				{subId: 305, planId: 1005, upgradeGroup: "gpt_month", total: 500, used: 499, status: "active", endOffsetSec: 86400},
			},
		}
	}

	const q = 1000

	// E1: subscription_first + 命中 → 订阅扣失败（剩余 1<1000） → fallback 钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{305: 0},
	}, "E1_subscription_first_match_subLow→fallback_wallet")

	// E2: subscription_only + 命中 → 订阅扣失败 → 返错（不允许 fallback）
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "gpt_month", preConsume: q,
		wantErr: true,
	}, "E2_subscription_only_match_subLow→FAIL")

	// E3: wallet_first + 命中 → 钱包先扣
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{305: 0},
	}, "E3_wallet_first_match_subLow→wallet")

	// E4: subscription_first + 不命中 → 强制钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{305: 0},
	}, "E4_subscription_first_nomatch_subLow→wallet")
}

// ---------------------------------------------------------------------------
// 账户 F：「订阅过期」过期订阅 + 钱包充足
// ---------------------------------------------------------------------------

func TestScenario_AccountF_ExpiredSubscription(t *testing.T) {
	mkAcc := func() scenarioAccount {
		return scenarioAccount{
			name:       "F_Expired",
			userId:     3006,
			tokenId:    3006,
			tokenKey:   "sk-F",
			tokenQuota: 5_000_000,
			userQuota:  10_000_000,
			userGroup:  "gpt_month",
			subs: []scenarioSub{
				// status=active 但 end_time 已过去 → 不算 active
				{subId: 306, planId: 1006, upgradeGroup: "gpt_month", total: 5_000_000, used: 0, status: "active", endOffsetSec: -10},
			},
		}
	}

	const q = 1000

	// F1: subscription_first + 命中 group → activeGroups 空 → 跳过跨组 → hasSub=false → 钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{306: 0},
	}, "F1_subscription_first_expired→wallet")

	// F2: subscription_only → trySubscription 失败（没 active）
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "gpt_month", preConsume: q,
		wantErr: true,
	}, "F2_subscription_only_expired→FAIL")

	// F3: wallet_only → 钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "wallet_only", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{306: 0},
	}, "F3_wallet_only_expired→wallet")

	// F4: cancelled 订阅 + subscription_first → 钱包
	mkAccCancelled := func() scenarioAccount {
		a := mkAcc()
		a.subs[0].status = "cancelled"
		a.subs[0].endOffsetSec = 86400 // 未过期但状态非 active
		return a
	}
	runScenario(t, mkAccCancelled(), scenarioExpect{
		pref: "subscription_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{306: 0},
	}, "F4_subscription_first_cancelled→wallet")
}

// ---------------------------------------------------------------------------
// 账户 G：「双订阅」gpt_month + svip + 钱包充足
// ---------------------------------------------------------------------------

func TestScenario_AccountG_DualSubscriptions(t *testing.T) {
	mkAcc := func() scenarioAccount {
		return scenarioAccount{
			name:       "G_Dual",
			userId:     3007,
			tokenId:    3007,
			tokenKey:   "sk-G",
			tokenQuota: 5_000_000,
			userQuota:  10_000_000,
			userGroup:  "svip", // userGroup 是其中一个
			subs: []scenarioSub{
				{subId: 371, planId: 1071, upgradeGroup: "gpt_month", total: 5_000_000, used: 0, status: "active", endOffsetSec: 86400},
				{subId: 372, planId: 1072, upgradeGroup: "svip", total: 7_000_000, used: 0, status: "active", endOffsetSec: 86400},
			},
		}
	}

	const q = 1000

	// G1: subscription_first + usingGroup=gpt_month → 命中 gpt_month 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "gpt_month", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{371: int64(q), 372: 0},
	}, "G1_subscription_first_gpt_month→hit_gpt_month_sub")

	// G2: subscription_first + usingGroup=svip → 命中 svip 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "svip", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{371: 0, 372: int64(q)},
	}, "G2_subscription_first_svip→hit_svip_sub")

	// G3: subscription_first + usingGroup=default → 都不命中 → 强制钱包
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_first", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{371: 0, 372: 0},
	}, "G3_subscription_first_default→wallet(both_no_match)")

	// G4: subscription_only + usingGroup=default → 强制钱包（决策 1）
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "default", preConsume: q,
		wantSource: BillingSourceWallet, deltaQuota: -q,
		deltaSubUsed: map[int]int64{371: 0, 372: 0},
	}, "G4_subscription_only_default→wallet(forced)")

	// G5: subscription_only + usingGroup=svip → 走 svip 订阅
	runScenario(t, mkAcc(), scenarioExpect{
		pref: "subscription_only", usingGroup: "svip", preConsume: q,
		wantSource: BillingSourceSubscription, deltaQuota: 0,
		deltaSubUsed: map[int]int64{371: 0, 372: int64(q)},
	}, "G5_subscription_only_svip→hit_svip_sub")
}

// ---------------------------------------------------------------------------
// 边界场景：跨账户的混合验证（一些容易遗漏的边界）
// ---------------------------------------------------------------------------

func TestScenario_EdgeCases(t *testing.T) {
	// 边界 1：usingGroup 为空字符串 → 跳过跨组判断
	// 用账户 A 验证：usingGroup="" 时，subscription_first + 命中 → 走订阅（不会被空字符串"不在 activeGroups"误伤）
	t.Run("Edge1_emptyUsingGroup_skipsCrossGroup", func(t *testing.T) {
		ensureSubscriptionPlanMigrated(t)
		truncateCross(t)

		seedUser(t, 4001, 10_000_000)
		seedToken(t, 4001, 4001, "sk-edge1", 5_000_000)
		seedPlan(t, 4101, "gpt_month")
		seedSubWithGroup(t, 4101, 4001, 4101, "gpt_month", 5_000_000, 0, "active", 86400)

		c := newTestGinContext()
		ri := makeRelayInfo(4001, 4001, "sk-edge1", "gpt_month", "", "subscription_first")
		session, apiErr := NewBillingSession(c, ri, 1000)
		require.Nil(t, apiErr)
		require.NotNil(t, session)
		assert.Equal(t, BillingSourceSubscription, session.funding.Source(),
			"空 usingGroup 不应触发跨组逻辑")
		assert.Equal(t, 10_000_000, getUserQuota(t, 4001))
		assert.Equal(t, int64(1000), getSubscriptionUsed(t, 4101))
	})

	// 边界 2：usingGroup 大小写敏感性（gpt_month vs GPT_Month）
	t.Run("Edge2_caseSensitive_GPT_Month_vs_gpt_month", func(t *testing.T) {
		ensureSubscriptionPlanMigrated(t)
		truncateCross(t)

		seedUser(t, 4002, 10_000_000)
		seedToken(t, 4002, 4002, "sk-edge2", 5_000_000)
		seedPlan(t, 4202, "GPT_Month") // 大写
		seedSubWithGroup(t, 4202, 4002, 4202, "GPT_Month", 5_000_000, 0, "active", 86400)

		// usingGroup="gpt_month"（小写），与订阅组大小写不一致 → 当前实现按字符串严格比较 → 不命中 → 强制钱包
		c := newTestGinContext()
		ri := makeRelayInfo(4002, 4002, "sk-edge2", "GPT_Month", "gpt_month", "subscription_first")
		session, apiErr := NewBillingSession(c, ri, 1000)
		require.Nil(t, apiErr)
		require.NotNil(t, session)
		assert.Equal(t, BillingSourceWallet, session.funding.Source(),
			"大小写不一致应被视为不命中，强制走钱包")
		assert.Equal(t, 10_000_000-1000, getUserQuota(t, 4002))
		assert.Equal(t, int64(0), getSubscriptionUsed(t, 4202))
	})

	// 边界 3：多次扣费同一个账户（确认状态累加正确）
	t.Run("Edge3_consecutiveConsumes_subscriptionAccumulate", func(t *testing.T) {
		ensureSubscriptionPlanMigrated(t)
		truncateCross(t)

		seedUser(t, 4003, 10_000_000)
		seedToken(t, 4003, 4003, "sk-edge3", 5_000_000)
		seedPlan(t, 4303, "gpt_month")
		seedSubWithGroup(t, 4303, 4003, 4303, "gpt_month", 5_000_000, 0, "active", 86400)

		// 第一次扣
		c1 := newTestGinContext()
		ri1 := makeRelayInfo(4003, 4003, "sk-edge3", "gpt_month", "gpt_month", "subscription_first")
		s1, e1 := NewBillingSession(c1, ri1, 800)
		require.Nil(t, e1)
		require.NotNil(t, s1)
		assert.Equal(t, int64(800), getSubscriptionUsed(t, 4303))

		// 第二次扣（不同 requestId）
		c2 := newTestGinContext()
		ri2 := makeRelayInfo(4003, 4003, "sk-edge3", "gpt_month", "gpt_month", "subscription_first")
		s2, e2 := NewBillingSession(c2, ri2, 500)
		require.Nil(t, e2)
		require.NotNil(t, s2)
		assert.Equal(t, int64(1300), getSubscriptionUsed(t, 4303))

		// quota 一直没动
		assert.Equal(t, 10_000_000, getUserQuota(t, 4003))
	})

	// 边界 4：跨组扣钱包后，订阅 amount_used 绝对没动（多次反复确认）
	t.Run("Edge4_repeatedCrossGroup_subscriptionImmune", func(t *testing.T) {
		ensureSubscriptionPlanMigrated(t)
		truncateCross(t)

		seedUser(t, 4004, 10_000_000)
		seedToken(t, 4004, 4004, "sk-edge4", 5_000_000)
		seedPlan(t, 4404, "gpt_month")
		seedSubWithGroup(t, 4404, 4004, 4404, "gpt_month", 5_000_000, 0, "active", 86400)

		// 跨组 10 次，订阅一直不动
		for i := 0; i < 10; i++ {
			c := newTestGinContext()
			ri := makeRelayInfo(4004, 4004, "sk-edge4", "gpt_month", "default", "subscription_first")
			s, e := NewBillingSession(c, ri, 100)
			require.Nil(t, e, "iter=%d", i)
			require.NotNil(t, s)
			assert.Equal(t, BillingSourceWallet, s.funding.Source(), "iter=%d", i)
		}
		assert.Equal(t, 10_000_000-1000, getUserQuota(t, 4004), "钱包 10 次 ×100 共扣 1000")
		assert.Equal(t, int64(0), getSubscriptionUsed(t, 4404), "订阅必须 0 不动")
	})

	// 边界 5：subscription_first 命中 → 订阅扣，多次后用 default 跨组 → 钱包扣
	// 验证一个用户的同一个会话历史中，订阅和钱包独立计量正确
	t.Run("Edge5_mixedFlow_subscriptionThenWallet", func(t *testing.T) {
		ensureSubscriptionPlanMigrated(t)
		truncateCross(t)

		seedUser(t, 4005, 10_000_000)
		seedToken(t, 4005, 4005, "sk-edge5", 5_000_000)
		seedPlan(t, 4505, "gpt_month")
		seedSubWithGroup(t, 4505, 4005, 4505, "gpt_month", 5_000_000, 0, "active", 86400)

		// 步骤 A：命中订阅
		for i := 0; i < 3; i++ {
			c := newTestGinContext()
			ri := makeRelayInfo(4005, 4005, "sk-edge5", "gpt_month", "gpt_month", "subscription_first")
			_, e := NewBillingSession(c, ri, 200)
			require.Nil(t, e)
		}
		assert.Equal(t, int64(600), getSubscriptionUsed(t, 4505))
		assert.Equal(t, 10_000_000, getUserQuota(t, 4005))

		// 步骤 B：跨组走钱包
		for i := 0; i < 3; i++ {
			c := newTestGinContext()
			ri := makeRelayInfo(4005, 4005, "sk-edge5", "gpt_month", "default", "subscription_first")
			_, e := NewBillingSession(c, ri, 200)
			require.Nil(t, e)
		}
		assert.Equal(t, int64(600), getSubscriptionUsed(t, 4505), "订阅在跨组阶段不变")
		assert.Equal(t, 10_000_000-600, getUserQuota(t, 4005), "钱包扣 3×200=600")
	})
}

// ---------------------------------------------------------------------------
// 测试覆盖率统计辅助（不参与断言，仅日志）
// ---------------------------------------------------------------------------

func TestScenario_PrintCoverageSummary(t *testing.T) {
	scenarios := []struct{ account, pref, group, expected string }{
		{"A_GoldMember", "subscription_first", "gpt_month", "subscription"},
		{"A_GoldMember", "subscription_first", "default", "wallet"},
		{"A_GoldMember", "subscription_only", "gpt_month", "subscription"},
		{"A_GoldMember", "subscription_only", "default", "wallet"},
		{"A_GoldMember", "wallet_first", "gpt_month", "wallet"},
		{"A_GoldMember", "wallet_only", "gpt_month", "wallet"},
		{"B_SubOnly", "subscription_first", "gpt_month", "subscription"},
		{"B_SubOnly", "subscription_first", "default", "FAIL"},
		{"B_SubOnly", "subscription_only", "gpt_month", "subscription"},
		{"B_SubOnly", "subscription_only", "default", "FAIL"},
		{"B_SubOnly", "wallet_first", "gpt_month", "subscription(fallback)"},
		{"B_SubOnly", "wallet_only", "gpt_month", "FAIL"},
		{"C_NoSub", "subscription_first", "default", "wallet"},
		{"C_NoSub", "subscription_only", "default", "FAIL"},
		{"C_NoSub", "wallet_first", "default", "wallet"},
		{"C_NoSub", "wallet_only", "default", "wallet"},
		{"D_Bankrupt", "*", "*", "FAIL"},
		{"E_SubLow", "subscription_first", "gpt_month", "wallet(fallback)"},
		{"E_SubLow", "subscription_only", "gpt_month", "FAIL"},
		{"F_Expired", "subscription_first", "gpt_month", "wallet"},
		{"F_Expired", "subscription_only", "gpt_month", "FAIL"},
		{"G_Dual", "subscription_first", "gpt_month", "subscription(gpt)"},
		{"G_Dual", "subscription_first", "svip", "subscription(svip)"},
		{"G_Dual", "subscription_first", "default", "wallet"},
		{"G_Dual", "subscription_only", "svip", "subscription(svip)"},
	}
	t.Logf("\n========== 场景覆盖矩阵 (%d 个场景) ==========", len(scenarios))
	for _, s := range scenarios {
		t.Logf("[%-15s] pref=%-19s usingGroup=%-10s → %s",
			s.account, s.pref, s.group, s.expected)
	}
}
