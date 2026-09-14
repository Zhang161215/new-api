package model

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	LotteryReasonPaymentGrant = "payment_grant"
	LotteryReasonDrawConsume  = "draw_consume"
	LotteryReasonPrizeReturn  = "prize_return"
	LotteryReasonAdminAdjust  = "admin_adjust"

	LotteryRefTopUp = "topup"
	LotteryRefDraw  = "draw"
	LotteryRefAdmin = "admin"
)

var (
	ErrLotteryDisabled          = errors.New("抽奖活动未开启")
	ErrLotteryNoTickets         = errors.New("抽奖次数不足")
	ErrLotteryNoPrize           = errors.New("没有可抽取的奖项")
	ErrLotteryNoStock           = errors.New("奖品库存不足")
	ErrLotterySoldOut           = errors.New("有奖品库存不足，请联系站长补货")
	ErrLotteryCodeNotRedeemable = errors.New("抽奖库存兑换码需抽中后再到兑换页兑换")
	ErrLotteryCodeNotYours      = errors.New("这不是你的抽奖兑换码")
)

// LotteryConfig 转盘全局配置，单行（id = 1）。
// Enabled 只控制能不能抽：关闭后 DrawLottery 拒绝，充值仍按 TicketsPerPayment 送次数。
type LotteryConfig struct {
	Id                int   `json:"id" gorm:"primaryKey"`
	Enabled           bool  `json:"enabled" gorm:"default:true"`
	TicketsPerPayment int   `json:"tickets_per_payment" gorm:"default:1"`
	UpdatedAt         int64 `json:"updated_at" gorm:"bigint"`
}

func (LotteryConfig) TableName() string { return "lottery_configs" }

// LotteryPrize 转盘奖项。额度奖的兑换码存在 redemptions 里（内部按 lottery-{code} 归组），中奖时抽一张未使用码入账。
type LotteryPrize struct {
	Id             int     `json:"id" gorm:"primaryKey;autoIncrement"`
	Code           string  `json:"code" gorm:"type:varchar(32);uniqueIndex;not null"`
	Label          string  `json:"label" gorm:"type:varchar(64);not null"`
	Short          string  `json:"short" gorm:"type:varchar(16)"`
	Hint           string  `json:"hint" gorm:"type:varchar(64)"`
	Weight         int     `json:"weight" gorm:"default:0"`
	QuotaAmount    float64 `json:"quota_amount"`
	ExtraTicket    bool    `json:"extra_ticket" gorm:"default:false"`
	Enabled        bool    `json:"enabled" gorm:"default:true"`
	SortOrder      int     `json:"sort_order" gorm:"default:0"`
	RedemptionName string  `json:"redemption_name" gorm:"type:varchar(64);index"`
	Fill           string  `json:"fill" gorm:"type:varchar(16)"`
	Ink            string  `json:"ink" gorm:"type:varchar(16)"`
	Tier           string  `json:"tier" gorm:"type:varchar(16)"`
	UpdatedAt      int64   `json:"updated_at" gorm:"bigint"`
	Stock          int64   `json:"stock" gorm:"-"`
}

func (LotteryPrize) TableName() string { return "lottery_prizes" }

func (p LotteryPrize) NeedsRedemption() bool {
	return !p.ExtraTicket && strings.TrimSpace(p.RedemptionName) != ""
}

func (p LotteryPrize) IsMiss() bool {
	return !p.ExtraTicket && strings.TrimSpace(p.RedemptionName) == ""
}

type LotteryWallet struct {
	UserId        int     `json:"user_id" gorm:"primaryKey"`
	Tickets       int     `json:"tickets" gorm:"default:0"`
	TotalDraws    int     `json:"total_draws" gorm:"default:0"`
	TotalWonQuota float64 `json:"total_won_quota" gorm:"default:0"`
	UpdatedAt     int64   `json:"updated_at" gorm:"bigint"`
}

func (LotteryWallet) TableName() string { return "lottery_wallets" }

type LotteryTicketLog struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"index;not null"`
	Delta        int    `json:"delta" gorm:"not null"`
	Reason       string `json:"reason" gorm:"type:varchar(32);not null;uniqueIndex:uk_lottery_grant"`
	RefType      string `json:"ref_type" gorm:"type:varchar(16);not null;uniqueIndex:uk_lottery_grant"`
	RefId        string `json:"ref_id" gorm:"type:varchar(64);not null;uniqueIndex:uk_lottery_grant"`
	BalanceAfter int    `json:"balance_after"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index"`
}

func (LotteryTicketLog) TableName() string { return "lottery_ticket_logs" }

type LotteryDraw struct {
	Id             int     `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId         int     `json:"user_id" gorm:"index;not null"`
	Username       string  `json:"username" gorm:"type:varchar(64);index"`
	PrizeCode      string  `json:"prize_code" gorm:"type:varchar(32);index"`
	PrizeLabel     string  `json:"prize_label" gorm:"type:varchar(64)"`
	QuotaAwarded   float64 `json:"quota_awarded"`
	ExtraTicket    bool    `json:"extra_ticket"`
	IsWin          bool    `json:"is_win" gorm:"index"`
	RedemptionId   int     `json:"redemption_id"`
	RedemptionKey  string  `json:"redemption_key" gorm:"type:varchar(64)"`
	RedemptionName string  `json:"redemption_name" gorm:"type:varchar(64)"`
	CreatedAt      int64   `json:"created_at" gorm:"bigint;index"`
}

func (LotteryDraw) TableName() string { return "lottery_draws" }

func lotteryDB(tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return DB
}

func GetLotteryConfig() (*LotteryConfig, error) {
	return getLotteryConfig(DB)
}

func getLotteryConfig(tx *gorm.DB) (*LotteryConfig, error) {
	var cfg LotteryConfig
	err := lotteryDB(tx).First(&cfg, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		cfg = LotteryConfig{Id: 1, Enabled: true, TicketsPerPayment: 1, UpdatedAt: time.Now().Unix()}
		if createErr := lotteryDB(tx).Create(&cfg).Error; createErr != nil {
			return nil, createErr
		}
		return &cfg, nil
	}
	return &cfg, err
}

func SaveLotteryConfig(enabled bool, ticketsPerPayment int) (*LotteryConfig, error) {
	if ticketsPerPayment < 1 {
		ticketsPerPayment = 1
	}
	if ticketsPerPayment > 10 {
		ticketsPerPayment = 10
	}
	cfg, err := GetLotteryConfig()
	if err != nil {
		return nil, err
	}
	cfg.Enabled = enabled
	cfg.TicketsPerPayment = ticketsPerPayment
	cfg.UpdatedAt = time.Now().Unix()
	if err := DB.Save(cfg).Error; err != nil {
		return nil, err
	}
	return cfg, nil
}

func GetLotteryWallet(userId int) (*LotteryWallet, error) {
	var wallet LotteryWallet
	err := DB.First(&wallet, userId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &LotteryWallet{UserId: userId}, nil
	}
	return &wallet, err
}

type LotteryWalletView struct {
	UserId        int     `json:"user_id"`
	Username      string  `json:"username"`
	Tickets       int     `json:"tickets"`
	TotalDraws    int     `json:"total_draws"`
	TotalWonQuota float64 `json:"total_won_quota"`
	UpdatedAt     int64   `json:"updated_at"`
}

func LookupLotteryWallets(keyword string, page, size int) ([]LotteryWalletView, int64, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 10
	}
	keyword = strings.TrimSpace(keyword)
	var total int64
	if err := lotteryWalletLookupBase(keyword).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []LotteryWalletView
	err := lotteryWalletLookupBase(keyword).
		Select(`users.id AS user_id,
			users.username AS username,
			COALESCE(lottery_wallets.tickets, 0) AS tickets,
			COALESCE(lottery_wallets.total_draws, 0) AS total_draws,
			COALESCE(lottery_wallets.total_won_quota, 0) AS total_won_quota,
			COALESCE(lottery_wallets.updated_at, 0) AS updated_at`).
		Order("tickets DESC, user_id DESC").
		Limit(size).
		Offset((page - 1) * size).
		Scan(&rows).Error
	return rows, total, err
}

func lotteryWalletLookupBase(keyword string) *gorm.DB {
	q := DB.Model(&User{}).
		Joins("LEFT JOIN lottery_wallets ON lottery_wallets.user_id = users.id")
	if keyword == "" {
		return q.Where("lottery_wallets.user_id IS NOT NULL")
	}
	like := "%" + keyword + "%"
	if id, err := strconv.Atoi(keyword); err == nil && id > 0 {
		return q.Where("users.id = ? OR users.username LIKE ?", id, like)
	}
	return q.Where("users.username LIKE ?", like)
}

func getOrCreateLotteryWallet(tx *gorm.DB, userId int) (*LotteryWallet, error) {
	var wallet LotteryWallet
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&wallet, userId).Error
	if err == nil {
		return &wallet, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	wallet = LotteryWallet{UserId: userId, UpdatedAt: time.Now().Unix()}
	if err := tx.Create(&wallet).Error; err != nil && !isLotteryUniqueErr(err) {
		return nil, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&wallet, userId).Error; err != nil {
		return nil, err
	}
	return &wallet, nil
}

func isLotteryUniqueErr(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "unique") || strings.Contains(s, "duplicate")
}

func lotteryQuotaToAmount(quota int) float64 {
	if common.QuotaPerUnit <= 0 {
		return 0
	}
	return float64(quota) / common.QuotaPerUnit
}

func lotteryAmountToQuota(amount float64) int {
	if amount <= 0 || common.QuotaPerUnit <= 0 {
		return 0
	}
	return int(math.Round(amount * common.QuotaPerUnit))
}

func CountLotteryPaymentGrants(userId int) (int64, error) {
	var n int64
	err := DB.Model(&LotteryTicketLog{}).
		Where("user_id = ? AND reason = ?", userId, LotteryReasonPaymentGrant).
		Count(&n).Error
	return n, err
}

func CountUserLotteryDrawsSince(userId int, since int64) (int64, error) {
	var n int64
	q := DB.Model(&LotteryDraw{}).Where("user_id = ?", userId)
	if since > 0 {
		q = q.Where("created_at >= ?", since)
	}
	return n, q.Count(&n).Error
}

func startOfTodayUnix() int64 {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
}

func startOfWeekUnix() int64 {
	now := time.Now()
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	wd := int(today.Weekday())
	if wd == 0 {
		wd = 7
	}
	return today.AddDate(0, 0, 1-wd).Unix()
}

// GrantLotteryTicketsForSuccessfulTopUp 充值成功后发放次数。同一 trade_no 只入账一次。
// 不看抽奖开关：关闭转盘时充值仍送次数。不改 users.quota。
func GrantLotteryTicketsForSuccessfulTopUp(tx *gorm.DB, userId int, tradeNo string) error {
	if tradeNo == "" {
		return errors.New("empty trade no")
	}
	run := func(db *gorm.DB) error {
		cfg, err := getLotteryConfig(db)
		if err != nil {
			return err
		}
		n := cfg.TicketsPerPayment
		if n < 1 {
			n = 1
		}
		return addLotteryTickets(db, userId, n, LotteryReasonPaymentGrant, LotteryRefTopUp, tradeNo)
	}
	if tx != nil {
		return run(tx)
	}
	return DB.Transaction(run)
}

func AdminGrantLotteryTickets(userId, n int, refId string) error {
	if n < 1 {
		n = 1
	}
	if n > 100 {
		n = 100
	}
	if refId == "" {
		refId = fmt.Sprintf("%d-%d", userId, time.Now().UnixNano())
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return addLotteryTickets(tx, userId, n, LotteryReasonAdminAdjust, LotteryRefAdmin, refId)
	})
}

func addLotteryTickets(tx *gorm.DB, userId, n int, reason, refType, refId string) error {
	if n == 0 || refId == "" {
		return nil
	}
	var exists LotteryTicketLog
	err := tx.Where("reason = ? AND ref_type = ? AND ref_id = ?", reason, refType, refId).First(&exists).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	wallet, err := getOrCreateLotteryWallet(tx, userId)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	wallet.Tickets += n
	wallet.UpdatedAt = now
	if err := tx.Save(wallet).Error; err != nil {
		return err
	}
	log := LotteryTicketLog{
		UserId:       userId,
		Delta:        n,
		Reason:       reason,
		RefType:      refType,
		RefId:        refId,
		BalanceAfter: wallet.Tickets,
		CreatedAt:    now,
	}
	if err := tx.Create(&log).Error; err != nil {
		if isLotteryUniqueErr(err) {
			return nil
		}
		return err
	}
	return nil
}

// claimLotteryTicket 原子扣 1 次：WHERE tickets>=1。SQLite 无行锁时靠 RowsAffected 防并发超抽。
func claimLotteryTicket(tx *gorm.DB, userId int) (*LotteryWallet, error) {
	wallet, err := getOrCreateLotteryWallet(tx, userId)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	res := tx.Model(&LotteryWallet{}).
		Where("user_id = ? AND tickets >= 1", userId).
		Updates(map[string]interface{}{
			"tickets":     gorm.Expr("tickets - ?", 1),
			"total_draws": gorm.Expr("total_draws + ?", 1),
			"updated_at":  now,
		})
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected != 1 {
		return nil, ErrLotteryNoTickets
	}
	if err := tx.Where("user_id = ?", userId).First(wallet).Error; err != nil {
		return nil, err
	}
	return wallet, nil
}

func logLotteryTicketConsume(tx *gorm.DB, wallet *LotteryWallet, drawId int) error {
	return tx.Create(&LotteryTicketLog{
		UserId:       wallet.UserId,
		Delta:        -1,
		Reason:       LotteryReasonDrawConsume,
		RefType:      LotteryRefDraw,
		RefId:        fmt.Sprintf("%d", drawId),
		BalanceAfter: wallet.Tickets,
		CreatedAt:    time.Now().Unix(),
	}).Error
}

func returnLotteryTicket(tx *gorm.DB, wallet *LotteryWallet, drawId int) error {
	now := time.Now().Unix()
	wallet.Tickets += 1
	wallet.UpdatedAt = now
	if err := tx.Save(wallet).Error; err != nil {
		return err
	}
	log := LotteryTicketLog{
		UserId:       wallet.UserId,
		Delta:        1,
		Reason:       LotteryReasonPrizeReturn,
		RefType:      LotteryRefDraw,
		RefId:        fmt.Sprintf("%d", drawId),
		BalanceAfter: wallet.Tickets,
		CreatedAt:    now,
	}
	return tx.Create(&log).Error
}
