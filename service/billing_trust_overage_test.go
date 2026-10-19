package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 钱包高于信任阈值（$5）时，预扣估算可以超过余额：跳过虚高预扣，按实际结算。
func TestNewBillingSession_TrustAllowsPreconsumeOverage(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID = 5101, 5101
	wallet := 8 * int(common.QuotaPerUnit) // 刚过 $5 门槛，对得上线上 zcg 这类余额
	seedUser(t, userID, wallet)
	seedToken(t, tokenID, userID, "sk-trust-overage", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-trust-overage", "default", "Claude_官转20X", "wallet_only")
	ri.ForcePreConsume = false
	ri.TokenUnlimited = true

	pre := wallet + int(common.QuotaPerUnit)
	session, apiErr := NewBillingSession(c, ri, pre)
	require.Nil(t, apiErr, "trusted wallet should not 403 on overestimated preconsume")
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	assert.Equal(t, 0, session.GetPreConsumedQuota())
	assert.Equal(t, wallet, getUserQuota(t, userID), "trust skip must not debit wallet up front")
}

// 等于或低于信任阈值（$5）时，估算超过余额仍拦截。
func TestNewBillingSession_BelowTrustStillBlocksOverage(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID = 5102, 5102
	wallet := 5 * int(common.QuotaPerUnit) // 需要大于 $5，等于不放行
	seedUser(t, userID, wallet)
	seedToken(t, tokenID, userID, "sk-trust-low", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-trust-low", "default", "Claude_官转20X", "wallet_only")
	ri.ForcePreConsume = false
	ri.TokenUnlimited = true

	_, apiErr := NewBillingSession(c, ri, wallet+int(common.QuotaPerUnit))
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
	assert.Equal(t, wallet, getUserQuota(t, userID))
}

// ForcePreConsume（异步任务）禁用信任旁路，估算超过余额必须拦截。
func TestNewBillingSession_ForcePreConsumeStillBlocksOverage(t *testing.T) {
	ensureSubscriptionPlanMigrated(t)
	truncateCross(t)

	const userID, tokenID = 5103, 5103
	wallet := 20 * int(common.QuotaPerUnit)
	seedUser(t, userID, wallet)
	seedToken(t, tokenID, userID, "sk-trust-force", 5_000_000)

	c := newTestGinContext()
	ri := makeRelayInfo(userID, tokenID, "sk-trust-force", "default", "Claude_官转20X", "wallet_only")
	_, apiErr := NewBillingSession(c, ri, wallet+int(common.QuotaPerUnit))
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
	assert.Equal(t, wallet, getUserQuota(t, userID))
}
