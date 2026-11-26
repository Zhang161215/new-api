package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

// newLotteryRedeemFixture 建一个用户、一个 $1 奖项（唯一奖项，必中）、一张库存码、一次抽奖机会。
func newLotteryRedeemFixture(t *testing.T, name string, startQuota int) (*User, string) {
	t.Helper()
	u := &User{Username: name, AffCode: name, Password: "x", Quota: startQuota, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	prize := LotteryPrize{
		Code: "q1", Label: "$1.00", Short: "1.00", Weight: 10, QuotaAmount: 1,
		Enabled: true, RedemptionName: "lottery-q1",
	}
	require.NoError(t, CreateLotteryPrize(&prize))
	keys, err := GenerateLotteryPrizeStock(&prize, 1, u.Id)
	require.NoError(t, err)
	require.Len(t, keys, 1)
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-"+name, 10, "alipay"))
	return u, keys[0]
}

func setLotteryAutoRedeem(t *testing.T, on bool) {
	t.Helper()
	_, err := UpdateLotteryConfig(LotteryConfigUpdate{AutoRedeem: &on})
	require.NoError(t, err)
}

func TestLotteryAutoRedeemDefaultsOnAndPersists(t *testing.T) {
	setupLotteryTables(t)
	cfg, err := GetLotteryConfig()
	require.NoError(t, err)
	require.True(t, cfg.AutoRedeem)

	setLotteryAutoRedeem(t, false)
	cfg, err = GetLotteryConfig()
	require.NoError(t, err)
	require.False(t, cfg.AutoRedeem)

	// 旧接口只改开关和规则，不能把自动入账顺带改回去
	cfg, err = SaveLotteryConfig(true, true, nil)
	require.NoError(t, err)
	require.False(t, cfg.AutoRedeem)

	setLotteryAutoRedeem(t, true)
	cfg, err = GetLotteryConfig()
	require.NoError(t, err)
	require.True(t, cfg.AutoRedeem)
}

func TestDrawLotteryAutoRedeemCreditsFromCode(t *testing.T) {
	setupLotteryTables(t)
	u, key := newLotteryRedeemFixture(t, "lottery-auto", 1000)

	result, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	require.True(t, result.Redeemed)
	require.Equal(t, lotteryAmountToQuota(1), result.RedeemedQuota)
	require.Equal(t, key, result.Draw.RedemptionKey)
	require.Equal(t, 0, result.Wallet.Tickets)

	var user User
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 1000+lotteryAmountToQuota(1), user.Quota)

	var code Redemption
	require.NoError(t, DB.First(&code, result.Draw.RedemptionId).Error)
	require.Equal(t, common.RedemptionCodeStatusUsed, code.Status)
	require.Equal(t, u.Id, code.UsedUserId)
	require.NotZero(t, code.RedeemedTime)

	require.Equal(t, map[int]bool{code.Id: true}, LotteryRedeemedCodeIds([]int{code.Id, 0}))

	// 已入账的码不能再兑换：一键兑换和兑换页都拒绝，余额不变
	_, err = RedeemLotteryDraw(u.Id, result.Draw.Id)
	require.ErrorIs(t, err, ErrLotteryCodeRedeemed)
	_, err = Redeem(key, u.Id)
	require.Error(t, err)
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 1000+lotteryAmountToQuota(1), user.Quota)
}

func TestDrawLotteryAutoRedeemOffThenOneClickRedeem(t *testing.T) {
	setupLotteryTables(t)
	setLotteryAutoRedeem(t, false)
	u, _ := newLotteryRedeemFixture(t, "lottery-manual", 500)
	other := &User{Username: "lottery-other", AffCode: "lottery-other", Password: "x", Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(other).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", other.Id).Delete(&User{}) })

	result, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	require.False(t, result.Redeemed)
	require.Zero(t, result.RedeemedQuota)
	require.Equal(t, map[int]bool{result.Draw.RedemptionId: false}, LotteryRedeemedCodeIds([]int{result.Draw.RedemptionId}))

	// 别人拿抽奖记录 id 兑换不了
	_, err = RedeemLotteryDraw(other.Id, result.Draw.Id)
	require.ErrorIs(t, err, ErrLotteryDrawNotFound)

	quota, err := RedeemLotteryDraw(u.Id, result.Draw.Id)
	require.NoError(t, err)
	require.Equal(t, lotteryAmountToQuota(1), quota)
	var user User
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 500+lotteryAmountToQuota(1), user.Quota)

	_, err = RedeemLotteryDraw(u.Id, result.Draw.Id)
	require.ErrorIs(t, err, ErrLotteryCodeRedeemed)
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 500+lotteryAmountToQuota(1), user.Quota)
}

func TestDrawLotteryAutoRedeemAtWalletLimitKeepsCode(t *testing.T) {
	setupLotteryTables(t)
	u, _ := newLotteryRedeemFixture(t, "lottery-full", common.MaxWalletQuota)

	// 余额已到上限：照常开奖、扣次数，码留在用户名下，不报错也不加额度
	result, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	require.False(t, result.Redeemed)
	require.Equal(t, 0, result.Wallet.Tickets)

	var code Redemption
	require.NoError(t, DB.First(&code, result.Draw.RedemptionId).Error)
	require.Equal(t, common.RedemptionCodeStatusEnabled, code.Status)
	require.Equal(t, u.Id, code.UsedUserId)

	var user User
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, common.MaxWalletQuota, user.Quota)

	_, err = RedeemLotteryDraw(u.Id, result.Draw.Id)
	require.ErrorIs(t, err, ErrTopUpQuotaLimitExceeded)
}

func TestDrawLotteryMissHasNothingToRedeem(t *testing.T) {
	setupLotteryTables(t)
	u := &User{Username: "lottery-miss", AffCode: "lottery-miss", Password: "x", Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })
	miss := LotteryPrize{Code: "miss", Label: "谢谢参与", Weight: 10, Enabled: true, Tier: "miss"}
	require.NoError(t, CreateLotteryPrize(&miss))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-miss", 10, "alipay"))

	result, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	require.False(t, result.Redeemed)
	require.Zero(t, result.Draw.RedemptionId)

	_, err = RedeemLotteryDraw(u.Id, result.Draw.Id)
	require.ErrorIs(t, err, ErrLotteryDrawNoCode)
}
