package model

import (
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLotteryTables(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(
		&LotteryConfig{},
		&LotteryPrize{},
		&LotteryWallet{},
		&LotteryTicketLog{},
		&LotteryDraw{},
		&Redemption{},
		&User{},
	))
	t.Cleanup(func() {
		DB.Exec("DELETE FROM lottery_draws")
		DB.Exec("DELETE FROM lottery_ticket_logs")
		DB.Exec("DELETE FROM lottery_wallets")
		DB.Exec("DELETE FROM lottery_prizes")
		DB.Exec("DELETE FROM lottery_configs")
		DB.Exec("DELETE FROM redemptions")
	})
}

func TestPickWeightedPrize(t *testing.T) {
	prizes := []LotteryPrize{
		{Code: "a", Weight: 1},
		{Code: "b", Weight: 0},
	}
	got, err := pickWeightedPrize(prizes)
	require.NoError(t, err)
	require.Equal(t, "a", got.Code)
}

func TestLotteryPickableKeepsEmptyStock(t *testing.T) {
	prizes := []LotteryPrize{
		{Code: "cash", Weight: 10, RedemptionName: "lottery-cash", Stock: 0, Enabled: true},
		{Code: "miss", Weight: 10, Enabled: true},
	}
	got := lotteryPickable(prizes)
	require.Len(t, got, 2)
	require.Equal(t, "cash", got[0].Code)
}

func TestLotteryWarehouseEmptyIfAnyPrizeOut(t *testing.T) {
	require.False(t, LotteryWarehouseEmpty([]LotteryPrize{
		{Code: "cash", Enabled: true, RedemptionName: "lottery-cash", Stock: 3},
		{Code: "miss", Enabled: true, Weight: 10},
	}))
	require.True(t, LotteryWarehouseEmpty([]LotteryPrize{
		{Code: "cash", Enabled: true, RedemptionName: "lottery-cash", Stock: 0},
		{Code: "jackpot", Enabled: true, RedemptionName: "lottery-jackpot", Stock: 9},
		{Code: "miss", Enabled: true, Weight: 10},
	}))
	require.False(t, LotteryWarehouseEmpty([]LotteryPrize{
		{Code: "miss", Enabled: true, Weight: 10},
		{Code: "again", Enabled: true, ExtraTicket: true, Weight: 8},
	}))
}

func TestGrantTicketsIdempotentByTradeNo(t *testing.T) {
	setupLotteryTables(t)
	require.NoError(t, EnsureLotteryDefaults())
	u := &User{Username: "lottery-user", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-100"))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-100"))
	wallet, err := GetLotteryWallet(u.Id)
	require.NoError(t, err)
	require.Equal(t, 1, wallet.Tickets)

	var n int64
	require.NoError(t, DB.Model(&LotteryTicketLog{}).Where("user_id = ?", u.Id).Count(&n).Error)
	require.Equal(t, int64(1), n)
}

func TestGrantTicketsWhileDrawDisabled(t *testing.T) {
	setupLotteryTables(t)
	require.NoError(t, EnsureLotteryDefaults())
	_, err := SaveLotteryConfig(false, 1)
	require.NoError(t, err)

	u := &User{Username: "lottery-closed-grant", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-CLOSED"))
	wallet, err := GetLotteryWallet(u.Id)
	require.NoError(t, err)
	require.Equal(t, 1, wallet.Tickets)

	_, err = DrawLottery(u.Id, u.Username)
	require.ErrorIs(t, err, ErrLotteryDisabled)
}

func TestDrawLotteryRedeemsCodeNotDirectBalanceField(t *testing.T) {
	setupLotteryTables(t)
	u := &User{Username: "lottery-draw", Password: "x", Quota: 1000, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
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
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-DRAW"))

	result, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	require.Equal(t, keys[0], result.Draw.RedemptionKey)
	require.InDelta(t, 1, result.Draw.QuotaAwarded, 0.001)
	require.Equal(t, 0, result.Wallet.Tickets)

	var user User
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 1000, user.Quota)

	var code Redemption
	require.NoError(t, DB.Where("name = ? AND used_user_id = ?", "lottery-q1", u.Id).First(&code).Error)
	require.Equal(t, common.RedemptionCodeStatusEnabled, code.Status)
	require.Equal(t, u.Id, code.UsedUserId)

	quota, err := Redeem(keys[0], u.Id)
	require.NoError(t, err)
	require.Equal(t, lotteryAmountToQuota(1), quota)
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 1000+lotteryAmountToQuota(1), user.Quota)
	require.NoError(t, DB.First(&code, code.Id).Error)
	require.Equal(t, common.RedemptionCodeStatusUsed, code.Status)
}

func TestDrawLotteryNoStockDoesNotConsumeTicket(t *testing.T) {
	setupLotteryTables(t)
	u := &User{Username: "lottery-empty", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	prize := LotteryPrize{
		Code: "q1", Label: "$1.00", Weight: 10, QuotaAmount: 1,
		Enabled: true, RedemptionName: "lottery-empty",
	}
	require.NoError(t, CreateLotteryPrize(&prize))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-EMPTY"))

	_, err := DrawLottery(u.Id, u.Username)
	require.ErrorIs(t, err, ErrLotterySoldOut)
	wallet, err := GetLotteryWallet(u.Id)
	require.NoError(t, err)
	require.Equal(t, 1, wallet.Tickets)
}

func TestDrawLotteryPartialEmptyStockBlocks(t *testing.T) {
	setupLotteryTables(t)
	u := &User{Username: "lottery-partial", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	empty := LotteryPrize{
		Code: "q01", Label: "$0.50", Weight: 38, QuotaAmount: 0.5,
		Enabled: true, RedemptionName: "lottery-q01-empty",
	}
	jackpot := LotteryPrize{
		Code: "q10", Label: "$10.00", Weight: 2, QuotaAmount: 10,
		Enabled: true, RedemptionName: "lottery-q10-live",
	}
	require.NoError(t, CreateLotteryPrize(&empty))
	require.NoError(t, CreateLotteryPrize(&jackpot))
	_, err := AddLotteryPrizeStock(&jackpot, []string{"JACKPOT-KEEP-01"}, 1)
	require.NoError(t, err)
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-PARTIAL"))

	_, err = DrawLottery(u.Id, u.Username)
	require.ErrorIs(t, err, ErrLotterySoldOut)
	wallet, err := GetLotteryWallet(u.Id)
	require.NoError(t, err)
	require.Equal(t, 1, wallet.Tickets)
	var n int64
	require.NoError(t, DB.Model(&LotteryDraw{}).Where("user_id = ?", u.Id).Count(&n).Error)
	require.Equal(t, int64(0), n)
}

func TestDrawLotteryExtraTicketReturnsChance(t *testing.T) {
	setupLotteryTables(t)
	u := &User{Username: "lottery-again", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	prize := LotteryPrize{Code: "again", Label: "再抽一次", Weight: 10, ExtraTicket: true, Enabled: true}
	require.NoError(t, CreateLotteryPrize(&prize))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-AGAIN"))

	result, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	require.True(t, result.Draw.ExtraTicket)
	require.Equal(t, 1, result.Wallet.Tickets)
	require.Equal(t, 0, u.Quota)
	var user User
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 0, user.Quota)
}

func TestAddLotteryPrizeStockCustomKeys(t *testing.T) {
	setupLotteryTables(t)
	prize := LotteryPrize{
		Code: "cash", Label: "$3.00", Weight: 10, QuotaAmount: 3,
		Enabled: true, RedemptionName: "lottery-cash",
	}
	require.NoError(t, CreateLotteryPrize(&prize))
	keys, err := AddLotteryPrizeStock(&prize, []string{"CARD-AAA-001", "CARD-AAA-001", " CARD-BBB-002 "}, 1)
	require.NoError(t, err)
	require.Equal(t, []string{"CARD-AAA-001", "CARD-BBB-002"}, keys)
	stock, err := CountLotteryPrizeStock(prize.RedemptionName)
	require.NoError(t, err)
	require.Equal(t, int64(2), stock)
	again, err := AddLotteryPrizeStock(&prize, []string{"CARD-AAA-001"}, 1)
	require.NoError(t, err)
	require.Equal(t, []string{"CARD-AAA-001"}, again)
	stock, err = CountLotteryPrizeStock(prize.RedemptionName)
	require.NoError(t, err)
	require.Equal(t, int64(2), stock)
	_, err = AddLotteryPrizeStock(&prize, nil, 1)
	require.Error(t, err)
}

func TestListAndDeleteLotteryPrizeCode(t *testing.T) {
	setupLotteryTables(t)
	prize := LotteryPrize{
		Code: "cash", Label: "$1.00", Weight: 10, QuotaAmount: 1,
		Enabled: true, RedemptionName: "lottery-cash",
	}
	require.NoError(t, CreateLotteryPrize(&prize))
	keys, err := AddLotteryPrizeStock(&prize, []string{"KEEP-CODE-01", "DROP-CODE-01"}, 1)
	require.NoError(t, err)
	require.Len(t, keys, 2)

	rows, total, err := ListLotteryPrizeCodes(prize.Id, "unused", "", 1, 10)
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	require.Len(t, rows, 2)

	var drop Redemption
	require.NoError(t, DB.Where(&Redemption{Key: "DROP-CODE-01"}).First(&drop).Error)
	require.NoError(t, DeleteLotteryPrizeCode(drop.Id))
	stock, err := CountLotteryPrizeStock(prize.RedemptionName)
	require.NoError(t, err)
	require.Equal(t, int64(1), stock)

	u := &User{Username: "lottery-code", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-CODE"))
	result, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	require.Equal(t, "KEEP-CODE-01", result.Draw.RedemptionKey)

	var used Redemption
	require.NoError(t, DB.Where(&Redemption{Key: "KEEP-CODE-01"}).First(&used).Error)
	err = DeleteLotteryPrizeCode(used.Id)
	require.Error(t, err)
}

func TestRedeemRejectsLotteryPrizeKeys(t *testing.T) {
	setupLotteryTables(t)
	prize := LotteryPrize{
		Code: "q1", Label: "$1.00", Weight: 10, QuotaAmount: 1,
		Enabled: true, RedemptionName: "lottery-q1",
	}
	require.NoError(t, CreateLotteryPrize(&prize))
	keys, err := AddLotteryPrizeStock(&prize, []string{"KEEP-STOCK-01"}, 1)
	require.NoError(t, err)
	require.Equal(t, []string{"KEEP-STOCK-01"}, keys)

	u := &User{Username: "lottery-redeem-block", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	_, err = Redeem("KEEP-STOCK-01", u.Id)
	require.ErrorIs(t, err, ErrLotteryCodeNotRedeemable)

	var item Redemption
	require.NoError(t, DB.Where(&Redemption{Key: "KEEP-STOCK-01"}).First(&item).Error)
	require.Equal(t, common.RedemptionCodeStatusEnabled, item.Status)
	require.Equal(t, 0, item.UsedUserId)

	var user User
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 0, user.Quota)
}

func TestTakeLotteryRedemptionClaimsOnce(t *testing.T) {
	setupLotteryTables(t)
	prize := LotteryPrize{
		Code: "q1", Label: "$1.00", Weight: 10, QuotaAmount: 1,
		Enabled: true, RedemptionName: "lottery-q1",
	}
	require.NoError(t, CreateLotteryPrize(&prize))
	_, err := AddLotteryPrizeStock(&prize, []string{"ONCE-CODE-01"}, 1)
	require.NoError(t, err)

	u := &User{Username: "lottery-once", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	err = DB.Transaction(func(tx *gorm.DB) error {
		_, takeErr := takeLotteryRedemption(tx, prize.RedemptionName, u.Id)
		return takeErr
	})
	require.NoError(t, err)

	err = DB.Transaction(func(tx *gorm.DB) error {
		_, takeErr := takeLotteryRedemption(tx, prize.RedemptionName, u.Id)
		return takeErr
	})
	require.ErrorIs(t, err, ErrLotteryNoStock)

	var user User
	require.NoError(t, DB.First(&user, u.Id).Error)
	require.Equal(t, 0, user.Quota)
	var item Redemption
	require.NoError(t, DB.Where(&Redemption{Key: "ONCE-CODE-01"}).First(&item).Error)
	require.Equal(t, common.RedemptionCodeStatusEnabled, item.Status)
	require.Equal(t, u.Id, item.UsedUserId)
}

func TestDrawLotterySecondDrawNeedsAnotherTicket(t *testing.T) {
	setupLotteryTables(t)
	u := &User{Username: "lottery-twice", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })

	prize := LotteryPrize{Code: "miss", Label: "谢谢参与", Weight: 10, Enabled: true}
	require.NoError(t, CreateLotteryPrize(&prize))
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-TWICE"))

	_, err := DrawLottery(u.Id, u.Username)
	require.NoError(t, err)
	_, err = DrawLottery(u.Id, u.Username)
	require.ErrorIs(t, err, ErrLotteryNoTickets)
}

func TestListLotteryAdminTicketLogsAttachesTopUp(t *testing.T) {
	setupLotteryTables(t)
	require.NoError(t, DB.AutoMigrate(&TopUp{}))
	require.NoError(t, EnsureLotteryDefaults())
	u := &User{Username: "lottery-ledger", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() {
		DB.Unscoped().Where("id = ?", u.Id).Delete(&User{})
		DB.Where("trade_no = ?", "T-LEDGER-1").Delete(&TopUp{})
	})
	require.NoError(t, DB.Create(&TopUp{
		UserId:        u.Id,
		TradeNo:       "T-LEDGER-1",
		Money:         12.5,
		PaymentMethod: "epay",
		Status:        common.TopUpStatusSuccess,
		CreateTime:    1,
	}).Error)
	require.NoError(t, GrantLotteryTicketsForSuccessfulTopUp(nil, u.Id, "T-LEDGER-1"))

	rows, total, err := ListLotteryAdminTicketLogs(LotteryListFilter{Page: 1, Size: 10, Keyword: "ledger"})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	require.Equal(t, "lottery-ledger", rows[0].Username)
	require.Equal(t, LotteryReasonPaymentGrant, rows[0].Reason)
	require.NotNil(t, rows[0].TopUp)
	require.Equal(t, "T-LEDGER-1", rows[0].TopUp.TradeNo)
	require.Equal(t, 12.5, rows[0].TopUp.Money)
	require.Equal(t, "wallet", rows[0].TopUp.Kind)
	require.Equal(t, "epay", rows[0].TopUp.PaymentMethod)
}

func TestListLotteryUserSummariesKeyword(t *testing.T) {
	setupLotteryTables(t)
	now := time.Now().Unix()
	u1 := &User{Username: "alice-draw", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser, AffCode: "al01"}
	u2 := &User{Username: "bob-draw", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser, AffCode: "bo02"}
	require.NoError(t, DB.Create(u1).Error)
	require.NoError(t, DB.Create(u2).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id IN ?", []int{u1.Id, u2.Id}).Delete(&User{}) })
	require.NoError(t, DB.Create(&LotteryDraw{UserId: u1.Id, Username: u1.Username, PrizeCode: "thanks", PrizeLabel: "未中奖", CreatedAt: now}).Error)
	require.NoError(t, DB.Create(&LotteryDraw{UserId: u2.Id, Username: u2.Username, PrizeCode: "thanks", PrizeLabel: "未中奖", CreatedAt: now}).Error)

	rows, total, err := ListLotteryUserSummaries(1, 10, "alice")
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	require.Equal(t, u1.Id, rows[0].UserId)

	rows, total, err = ListLotteryUserSummaries(1, 10, strconv.Itoa(u2.Id))
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	require.Equal(t, u2.Id, rows[0].UserId)
}

func TestListLotteryPrizeCodesKeywordUsername(t *testing.T) {
	setupLotteryTables(t)
	prize := LotteryPrize{
		Code: "cash", Label: "$1.00", Weight: 10, QuotaAmount: 1,
		Enabled: true, RedemptionName: "lottery-cash",
	}
	require.NoError(t, CreateLotteryPrize(&prize))
	_, err := AddLotteryPrizeStock(&prize, []string{"KEEP-USER-01", "KEEP-OTHER-01"}, 1)
	require.NoError(t, err)
	u := &User{Username: "code-owner", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser, AffCode: "co03"}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })
	require.NoError(t, DB.Model(&Redemption{}).Where(lotteryRedemptionKeyCol()+" = ?", "KEEP-USER-01").Update("used_user_id", u.Id).Error)

	rows, total, err := ListLotteryPrizeCodes(prize.Id, "all", "code-own", 1, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	require.Equal(t, "KEEP-USER-01", rows[0].Key)
	require.Equal(t, "code-owner", rows[0].UsedUsername)

	rows, total, err = ListLotteryPrizeCodes(prize.Id, "all", strconv.Itoa(u.Id), 1, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, "KEEP-USER-01", rows[0].Key)

	byKey, total, err := ListLotteryPrizeCodes(prize.Id, "all", "KEEP-OTHER", 1, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, "KEEP-OTHER-01", byKey[0].Key)
}

func TestLookupLotteryWalletsByIdAndUsername(t *testing.T) {
	setupLotteryTables(t)
	u := &User{Username: "swy9926", Password: "x", Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })
	require.NoError(t, AdminGrantLotteryTickets(u.Id, 2, "lookup-test"))

	byId, total, err := LookupLotteryWallets(strconv.Itoa(u.Id), 1, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, byId, 1)
	require.Equal(t, u.Id, byId[0].UserId)
	require.Equal(t, "swy9926", byId[0].Username)
	require.Equal(t, 2, byId[0].Tickets)

	byName, total, err := LookupLotteryWallets("swy", 1, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, byName, 1)
	require.Equal(t, u.Id, byName[0].UserId)
	require.Equal(t, 2, byName[0].Tickets)
}

func TestGetLotteryOverviewPeriods(t *testing.T) {
	setupLotteryTables(t)
	now := time.Now().Unix()
	weekAgo := startOfWeekUnix() - 86400
	require.NoError(t, DB.Create(&LotteryDraw{
		UserId: 11, Username: "today-win", PrizeCode: "q1", PrizeLabel: "$1.00",
		QuotaAwarded: 1, IsWin: true, CreatedAt: now,
	}).Error)
	require.NoError(t, DB.Create(&LotteryDraw{
		UserId: 12, Username: "today-miss", PrizeCode: "thanks", PrizeLabel: "未中奖",
		IsWin: false, CreatedAt: now,
	}).Error)
	require.NoError(t, DB.Create(&LotteryDraw{
		UserId: 13, Username: "old-win", PrizeCode: "q3", PrizeLabel: "$3.00",
		QuotaAwarded: 3, IsWin: true, CreatedAt: weekAgo,
	}).Error)

	ov, err := GetLotteryOverview()
	require.NoError(t, err)
	require.Equal(t, int64(2), ov.Today.Draws)
	require.Equal(t, int64(1), ov.Today.Wins)
	require.Equal(t, 1.0, ov.Today.WonQuota)
	require.Equal(t, ov.Today.Draws, ov.TodayDraws)
	require.Equal(t, int64(3), ov.All.Draws)
	require.Equal(t, 4.0, ov.All.WonQuota)
	require.Len(t, ov.TodayPrizes, 2)
}

func TestClaimMonthlyLotteryGift(t *testing.T) {
	setupLotteryTables(t)
	require.NoError(t, DB.AutoMigrate(&TopUp{}, &Log{}))
	require.NoError(t, EnsureLotteryDefaults())
	now := time.Now()
	start, _ := LotteryMonthRange(now)
	mid := start + 86400

	makeUser := func(name string) *User {
		u := &User{Username: name, Password: "x", AffCode: name, Quota: 0, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
		require.NoError(t, DB.Create(u).Error)
		t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })
		return u
	}

	idle := makeUser("gift-idle")
	idleResult, err := ClaimMonthlyLotteryGiftAt(idle.Id, now)
	require.NoError(t, err)
	require.False(t, idleResult.Eligible)
	require.False(t, idleResult.Granted)
	idleWallet, err := GetLotteryWallet(idle.Id)
	require.NoError(t, err)
	require.Equal(t, 0, idleWallet.Tickets)

	paid := makeUser("gift-paid")
	require.NoError(t, DB.Create(&TopUp{
		UserId: paid.Id, Amount: 1, Money: 10, TradeNo: "GIFT-PAY-1",
		Status: common.TopUpStatusSuccess, CreateTime: mid, CompleteTime: mid,
	}).Error)
	paidResult, err := ClaimMonthlyLotteryGiftAt(paid.Id, now)
	require.NoError(t, err)
	require.True(t, paidResult.Eligible)
	require.True(t, paidResult.Granted)
	require.Equal(t, 1, paidResult.Tickets)
	again, err := ClaimMonthlyLotteryGiftAt(paid.Id, now)
	require.NoError(t, err)
	require.True(t, again.Already)
	require.False(t, again.Granted)
	require.Equal(t, 1, again.Tickets)

	spentA := makeUser("gift-spent-a")
	spentB := makeUser("gift-spent-b")
	require.NoError(t, DB.Create(&Log{UserId: spentA.Id, Type: LogTypeConsume, Quota: 100, CreatedAt: mid}).Error)
	require.NoError(t, DB.Create(&Log{UserId: spentB.Id, Type: LogTypeConsume, Quota: 100, CreatedAt: mid}).Error)
	a, err := ClaimMonthlyLotteryGiftAt(spentA.Id, now)
	require.NoError(t, err)
	b, err := ClaimMonthlyLotteryGiftAt(spentB.Id, now)
	require.NoError(t, err)
	require.True(t, a.Granted)
	require.True(t, b.Granted)
	require.Equal(t, 1, a.Tickets)
	require.Equal(t, 1, b.Tickets)
	require.Equal(t, LotteryGiftPeriod(now), a.Period)
}
