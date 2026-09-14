package model

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

func NormalizeLotteryPrize(p *LotteryPrize) {
	if p == nil {
		return
	}
	p.Code = strings.TrimSpace(p.Code)
	p.Label = strings.TrimSpace(p.Label)
	p.Short = strings.TrimSpace(p.Short)
	p.Hint = strings.TrimSpace(p.Hint)
	p.RedemptionName = strings.TrimSpace(p.RedemptionName)
	if p.Weight < 0 {
		p.Weight = 0
	}
	if p.QuotaAmount < 0 {
		p.QuotaAmount = 0
	}
	if p.ExtraTicket {
		p.RedemptionName = ""
		p.QuotaAmount = 0
		return
	}
	if p.QuotaAmount > 0 && p.RedemptionName == "" && p.Code != "" {
		p.RedemptionName = "lottery-" + p.Code
	}
	if p.QuotaAmount <= 0 {
		p.RedemptionName = ""
	}
}

func ListLotteryPrizes(includeDisabled bool) ([]LotteryPrize, error) {
	var prizes []LotteryPrize
	q := DB.Model(&LotteryPrize{}).Order("sort_order ASC, id ASC")
	if !includeDisabled {
		q = q.Where("enabled = ?", true)
	}
	if err := q.Find(&prizes).Error; err != nil {
		return nil, err
	}
	for i := range prizes {
		prizes[i].Stock, _ = CountLotteryPrizeStock(prizes[i].RedemptionName)
	}
	return prizes, nil
}

func GetLotteryPrizeById(id int) (*LotteryPrize, error) {
	var prize LotteryPrize
	if err := DB.First(&prize, id).Error; err != nil {
		return nil, err
	}
	prize.Stock, _ = CountLotteryPrizeStock(prize.RedemptionName)
	return &prize, nil
}

func SaveLotteryPrize(prize *LotteryPrize) error {
	NormalizeLotteryPrize(prize)
	if prize.Code == "" || prize.Label == "" {
		return errors.New("奖项编码和名称不能为空")
	}
	prize.UpdatedAt = time.Now().Unix()
	return DB.Save(prize).Error
}

func CreateLotteryPrize(prize *LotteryPrize) error {
	NormalizeLotteryPrize(prize)
	if prize.Code == "" {
		prize.Code = fmt.Sprintf("p%d", time.Now().UnixNano())
	}
	if prize.Label == "" {
		prize.Label = "新奖项"
	}
	NormalizeLotteryPrize(prize)
	prize.UpdatedAt = time.Now().Unix()
	return DB.Create(prize).Error
}

func DeleteLotteryPrize(id int) error {
	if id <= 0 {
		return errors.New("无效奖项")
	}
	return DB.Delete(&LotteryPrize{}, id).Error
}

func CountLotteryPrizeStock(name string) (int64, error) {
	if strings.TrimSpace(name) == "" {
		return 0, nil
	}
	now := common.GetTimestamp()
	var n int64
	err := lotteryUnusedStockQuery(DB, name, now).Count(&n).Error
	return n, err
}

func lotteryUnusedStockQuery(tx *gorm.DB, name string, now int64) *gorm.DB {
	return tx.Model(&Redemption{}).
		Where("name = ? AND status = ?", name, common.RedemptionCodeStatusEnabled).
		Where("COALESCE(used_user_id, 0) = 0").
		Where("expired_time = 0 OR expired_time > ?", now)
}

func CountLotteryPrizeUsed(name string) (int64, error) {
	if strings.TrimSpace(name) == "" {
		return 0, nil
	}
	var n int64
	err := DB.Model(&Redemption{}).
		Where("name = ? AND status = ?", name, common.RedemptionCodeStatusUsed).
		Count(&n).Error
	return n, err
}

func lotteryRedemptionKeyCol() string {
	if common.UsingPostgreSQL {
		return `"key"`
	}
	return "`key`"
}

// GenerateLotteryPrizeStock 仅测试使用：生成随机兑换码。管理端只接受手工录入。
func GenerateLotteryPrizeStock(prize *LotteryPrize, count, adminUserId int) ([]string, error) {
	if count < 1 {
		count = 1
	}
	if count > 500 {
		count = 500
	}
	keys := make([]string, 0, count)
	for i := 0; i < count; i++ {
		keys = append(keys, common.GetUUID())
	}
	return AddLotteryPrizeStock(prize, keys, adminUserId)
}

func sanitizeLotteryCardKey(raw string) (string, error) {
	key := strings.TrimSpace(raw)
	if key == "" {
		return "", nil
	}
	if strings.ContainsAny(key, " \t") {
		return "", fmt.Errorf("兑换码不能包含空格")
	}
	if n := len(key); n < 4 || n > 32 {
		return "", fmt.Errorf("兑换码长度需为 4–32 位")
	}
	return key, nil
}

// AddLotteryPrizeStock 给额度奖录入兑换码，必须由管理员粘贴，不再自动生成。
func AddLotteryPrizeStock(prize *LotteryPrize, customKeys []string, adminUserId int) ([]string, error) {
	if prize == nil {
		return nil, errors.New("奖项不存在")
	}
	NormalizeLotteryPrize(prize)
	if !prize.NeedsRedemption() {
		return nil, errors.New("谢谢参与 / 再来一次 不需要兑换码")
	}
	quota := lotteryAmountToQuota(prize.QuotaAmount)
	if quota <= 0 {
		return nil, errors.New("请先设置奖项额度")
	}
	planned := make([]string, 0, len(customKeys))
	seen := map[string]struct{}{}
	for _, raw := range customKeys {
		key, err := sanitizeLotteryCardKey(raw)
		if err != nil {
			return nil, err
		}
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		planned = append(planned, key)
	}
	if len(planned) == 0 {
		return nil, errors.New("请粘贴要入库的兑换码")
	}
	if len(planned) > 500 {
		return nil, errors.New("一次最多录入 500 个")
	}
	keys := make([]string, 0, len(planned))
	now := common.GetTimestamp()
	keyCol := lotteryRedemptionKeyCol()
	var firstBlocked string
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, key := range planned {
			var exist Redemption
			err := tx.Where(keyCol+" = ?", key).Take(&exist).Error
			if err == nil {
				if lotteryRedemptionAdoptable(exist, now) {
					if err := tx.Model(&exist).Updates(map[string]interface{}{
						"name":  prize.RedemptionName,
						"quota": quota,
					}).Error; err != nil {
						return err
					}
					keys = append(keys, key)
					continue
				}
				if firstBlocked == "" {
					firstBlocked = key
				}
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			item := Redemption{
				UserId:      adminUserId,
				Name:        prize.RedemptionName,
				Key:         key,
				CreatedTime: now,
				Quota:       quota,
				Status:      common.RedemptionCodeStatusEnabled,
			}
			if err := tx.Create(&item).Error; err != nil {
				return err
			}
			keys = append(keys, key)
		}
		if len(keys) == 0 {
			if firstBlocked != "" {
				return fmt.Errorf("兑换码已存在：%s", firstBlocked)
			}
			return errors.New("请粘贴要入库的兑换码")
		}
		return nil
	})
	return keys, err
}

func lotteryRedemptionAdoptable(item Redemption, now int64) bool {
	if item.Status != common.RedemptionCodeStatusEnabled || item.UsedUserId != 0 {
		return false
	}
	if item.ExpiredTime != 0 && item.ExpiredTime < now {
		return false
	}
	return true
}

type LotteryCodeRow struct {
	Id           int     `json:"id"`
	Key          string  `json:"key"`
	Status       string  `json:"status"`
	PrizeId      int     `json:"prize_id"`
	PrizeCode    string  `json:"prize_code"`
	PrizeLabel   string  `json:"prize_label"`
	QuotaAmount  float64 `json:"quota_amount"`
	UsedUserId   int     `json:"used_user_id"`
	UsedUsername string  `json:"used_username"`
	CreatedTime  int64   `json:"created_time"`
	RedeemedTime int64   `json:"redeemed_time"`
	CanDelete    bool    `json:"can_delete"`
}

func lotteryCodeStatus(item Redemption, now int64) string {
	if item.Status == common.RedemptionCodeStatusUsed {
		return "used"
	}
	if item.Status == common.RedemptionCodeStatusDisabled {
		return "disabled"
	}
	if item.ExpiredTime != 0 && item.ExpiredTime < now {
		return "expired"
	}
	if item.UsedUserId > 0 {
		return "pending"
	}
	return "unused"
}

func isLotteryRedemptionName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	if strings.HasPrefix(name, "lottery-") {
		return true
	}
	var n int64
	if err := DB.Model(&LotteryPrize{}).Where("redemption_name = ?", name).Count(&n).Error; err != nil {
		return false
	}
	return n > 0
}

func ListLotteryPrizeCodes(prizeId int, status, keyword string, page, size int) ([]LotteryCodeRow, int64, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 10
	}
	if size > 100 {
		size = 100
	}
	prizes, err := ListLotteryPrizes(true)
	if err != nil {
		return nil, 0, err
	}
	prizeByName := map[string]LotteryPrize{}
	names := make([]string, 0, len(prizes))
	for _, p := range prizes {
		if !p.NeedsRedemption() {
			continue
		}
		prizeByName[p.RedemptionName] = p
		if prizeId > 0 && p.Id != prizeId {
			continue
		}
		names = append(names, p.RedemptionName)
	}
	if prizeId > 0 && len(names) == 0 {
		return []LotteryCodeRow{}, 0, nil
	}
	now := common.GetTimestamp()
	q := DB.Model(&Redemption{})
	if len(names) > 0 {
		if prizeId > 0 {
			q = q.Where("name IN ?", names)
		} else {
			q = q.Where("name IN ? OR name LIKE ?", names, "lottery-%")
		}
	} else {
		q = q.Where("name LIKE ?", "lottery-%")
	}
	switch status {
	case "unused":
		q = q.Where("status = ?", common.RedemptionCodeStatusEnabled).
			Where("COALESCE(used_user_id, 0) = 0").
			Where("expired_time = 0 OR expired_time > ?", now)
	case "pending":
		q = q.Where("status = ?", common.RedemptionCodeStatusEnabled).
			Where("COALESCE(used_user_id, 0) > 0")
	case "used":
		q = q.Where("status = ?", common.RedemptionCodeStatusUsed)
	}
	q = applyLotteryCodeKeyword(q, keyword)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []Redemption
	if err := q.Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	userIds := make([]int, 0)
	seenUser := map[int]struct{}{}
	for _, item := range items {
		if item.UsedUserId > 0 {
			if _, ok := seenUser[item.UsedUserId]; ok {
				continue
			}
			seenUser[item.UsedUserId] = struct{}{}
			userIds = append(userIds, item.UsedUserId)
		}
	}
	usernames := map[int]string{}
	if len(userIds) > 0 {
		var users []User
		if err := DB.Select("id", "username").Where("id IN ?", userIds).Find(&users).Error; err != nil {
			return nil, 0, err
		}
		for _, u := range users {
			usernames[u.Id] = u.Username
		}
	}
	out := make([]LotteryCodeRow, 0, len(items))
	for _, item := range items {
		st := lotteryCodeStatus(item, now)
		row := LotteryCodeRow{
			Id:           item.Id,
			Key:          item.Key,
			Status:       st,
			QuotaAmount:  lotteryQuotaToAmount(item.Quota),
			UsedUserId:   item.UsedUserId,
			UsedUsername: usernames[item.UsedUserId],
			CreatedTime:  item.CreatedTime,
			RedeemedTime: item.RedeemedTime,
			CanDelete:    st == "unused",
		}
		if p, ok := prizeByName[item.Name]; ok {
			row.PrizeId = p.Id
			row.PrizeCode = p.Code
			row.PrizeLabel = p.Label
		} else {
			row.PrizeLabel = "已删除奖项"
		}
		out = append(out, row)
	}
	return out, total, nil
}

func applyLotteryCodeKeyword(q *gorm.DB, keyword string) *gorm.DB {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return q
	}
	like := "%" + keyword + "%"
	keyCol := lotteryRedemptionKeyCol()
	if id, err := strconv.Atoi(keyword); err == nil && id > 0 {
		if len(keyword) >= 4 {
			return q.Where(keyCol+" LIKE ? OR COALESCE(used_user_id, 0) = ?", like, id)
		}
		return q.Where(keyCol+" = ? OR COALESCE(used_user_id, 0) = ?", keyword, id)
	}
	var ids []int
	_ = DB.Model(&User{}).Where("username LIKE ?", like).Limit(200).Pluck("id", &ids)
	if len(ids) == 0 {
		return q.Where(keyCol+" LIKE ?", like)
	}
	return q.Where(keyCol+" LIKE ? OR used_user_id IN ?", like, ids)
}

func DeleteLotteryPrizeCode(id int) error {
	if id <= 0 {
		return errors.New("无效兑换码")
	}
	var item Redemption
	if err := DB.First(&item, id).Error; err != nil {
		return err
	}
	if !isLotteryRedemptionName(item.Name) {
		return errors.New("只能删除抽奖兑换码")
	}
	if item.Status == common.RedemptionCodeStatusUsed || item.UsedUserId > 0 {
		return errors.New("已发放的兑换码不能删除")
	}
	return DB.Unscoped().Delete(&item).Error
}

func pickWeightedPrize(prizes []LotteryPrize) (*LotteryPrize, error) {
	total := 0
	for _, p := range prizes {
		if p.Weight > 0 {
			total += p.Weight
		}
	}
	if total <= 0 {
		return nil, ErrLotteryNoPrize
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(total)))
	if err != nil {
		return nil, err
	}
	roll := n.Int64()
	var acc int64
	for i := range prizes {
		if prizes[i].Weight <= 0 {
			continue
		}
		acc += int64(prizes[i].Weight)
		if roll < acc {
			return &prizes[i], nil
		}
	}
	return &prizes[len(prizes)-1], nil
}

func lotteryPickable(prizes []LotteryPrize) []LotteryPrize {
	out := make([]LotteryPrize, 0, len(prizes))
	for _, p := range prizes {
		if !p.Enabled || p.Weight <= 0 {
			continue
		}
		out = append(out, p)
	}
	return out
}

// LotteryWarehouseEmpty 任一额度奖缺货就停抽，避免把缺货项踢出池子后抬高其余奖概率。
// 未绑定兑换码的奖项（未中奖 / 再抽一次）不参与这项检查。
func LotteryWarehouseEmpty(prizes []LotteryPrize) bool {
	for _, p := range prizes {
		if !p.Enabled || !p.NeedsRedemption() {
			continue
		}
		if p.Stock <= 0 {
			return true
		}
	}
	return false
}

// takeLotteryRedemption 从奖品库锁一张未使用兑换码发给中奖用户，不改额度。
// 用户拿到码后去兑换页自行兑换。used_user_id 先记下归属，status 仍是未使用。
func takeLotteryRedemption(tx *gorm.DB, name string, userId int) (*Redemption, error) {
	if strings.TrimSpace(name) == "" {
		return nil, ErrLotteryNoStock
	}
	now := common.GetTimestamp()
	var item Redemption
	err := lotteryUnusedStockQuery(tx, name, now).Order("id ASC").First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrLotteryNoStock
	}
	if err != nil {
		return nil, err
	}
	res := tx.Model(&Redemption{}).
		Where("id = ? AND status = ? AND COALESCE(used_user_id, 0) = 0", item.Id, common.RedemptionCodeStatusEnabled).
		Updates(map[string]interface{}{
			"used_user_id": userId,
		})
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected != 1 {
		return nil, ErrLotteryNoStock
	}
	item.UsedUserId = userId
	return &item, nil
}

type LotteryDrawResult struct {
	Draw   *LotteryDraw
	Prize  *LotteryPrize
	Wallet *LotteryWallet
}

func DrawLottery(userId int, username string) (*LotteryDrawResult, error) {
	var result *LotteryDrawResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		cfg, err := getLotteryConfig(tx)
		if err != nil {
			return err
		}
		if !cfg.Enabled {
			return ErrLotteryDisabled
		}

		var prizes []LotteryPrize
		if err := tx.Where("enabled = ?", true).Order("sort_order ASC, id ASC").Find(&prizes).Error; err != nil {
			return err
		}
		nowTs := common.GetTimestamp()
		for i := range prizes {
			if !prizes[i].NeedsRedemption() {
				continue
			}
			var n int64
			if err := lotteryUnusedStockQuery(tx, prizes[i].RedemptionName, nowTs).Count(&n).Error; err != nil {
				return err
			}
			prizes[i].Stock = n
		}

		if LotteryWarehouseEmpty(prizes) {
			return ErrLotterySoldOut
		}

		wallet, err := claimLotteryTicket(tx, userId)
		if err != nil {
			return err
		}

		picked, pickErr := pickWeightedPrize(lotteryPickable(prizes))
		if pickErr != nil {
			return pickErr
		}
		var code *Redemption
		if picked.NeedsRedemption() {
			taken, takeErr := takeLotteryRedemption(tx, picked.RedemptionName, userId)
			if errors.Is(takeErr, ErrLotteryNoStock) {
				return ErrLotterySoldOut
			}
			if takeErr != nil {
				return takeErr
			}
			code = taken
		}
		prize := picked

		now := time.Now().Unix()
		draw := &LotteryDraw{
			UserId:         userId,
			Username:       username,
			PrizeCode:      prize.Code,
			PrizeLabel:     prize.Label,
			ExtraTicket:    prize.ExtraTicket,
			IsWin:          prize.ExtraTicket || code != nil,
			RedemptionName: prize.RedemptionName,
			CreatedAt:      now,
		}
		if code != nil {
			draw.RedemptionId = code.Id
			draw.RedemptionKey = strings.TrimSpace(code.Key)
			draw.QuotaAwarded = lotteryQuotaToAmount(code.Quota)
		}
		if err := tx.Create(draw).Error; err != nil {
			return err
		}
		if err := logLotteryTicketConsume(tx, wallet, draw.Id); err != nil {
			return err
		}
		if prize.ExtraTicket {
			if err := returnLotteryTicket(tx, wallet, draw.Id); err != nil {
				return err
			}
		}
		if draw.QuotaAwarded > 0 {
			wallet.TotalWonQuota += draw.QuotaAwarded
			wallet.UpdatedAt = now
			if err := tx.Save(wallet).Error; err != nil {
				return err
			}
		}
		result = &LotteryDrawResult{Draw: draw, Prize: prize, Wallet: wallet}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

type LotteryListFilter struct {
	UserId  int
	Keyword string
	Filter  string
	Prize   string
	From    int64
	To      int64
	Page    int
	Size    int
}

func (f *LotteryListFilter) normalize() {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.Size < 1 || f.Size > 100 {
		f.Size = 10
	}
}

func ListLotteryDraws(f LotteryListFilter) ([]LotteryDraw, int64, error) {
	f.normalize()
	q := DB.Model(&LotteryDraw{})
	if f.UserId > 0 {
		q = q.Where("user_id = ?", f.UserId)
	}
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		like := "%" + kw + "%"
		if id, err := strconv.Atoi(kw); err == nil && id > 0 {
			q = q.Where("user_id = ? OR username LIKE ?", id, like)
		} else {
			q = q.Where("username LIKE ? OR prize_label LIKE ?", like, like)
		}
	}
	switch f.Filter {
	case "win":
		q = q.Where("is_win = ?", true)
	case "miss":
		q = q.Where("is_win = ?", false)
	}
	if prize := strings.TrimSpace(f.Prize); prize != "" {
		q = q.Where("prize_code = ?", prize)
	}
	if f.From > 0 {
		q = q.Where("created_at >= ?", f.From)
	}
	if f.To > 0 {
		q = q.Where("created_at <= ?", f.To)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []LotteryDraw
	err := q.Order("id DESC").Limit(f.Size).Offset((f.Page - 1) * f.Size).Find(&rows).Error
	return rows, total, err
}

func ListLotteryTicketLogs(f LotteryListFilter) ([]LotteryTicketLog, int64, error) {
	f.normalize()
	var total int64
	if err := lotteryTicketLogQuery(f).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []LotteryTicketLog
	err := lotteryTicketLogQuery(f).Order("id DESC").Limit(f.Size).Offset((f.Page - 1) * f.Size).Find(&rows).Error
	return rows, total, err
}

func lotteryTicketLogQuery(f LotteryListFilter) *gorm.DB {
	q := DB.Model(&LotteryTicketLog{})
	if f.UserId > 0 {
		q = q.Where("user_id = ?", f.UserId)
	}
	if reason := strings.TrimSpace(f.Filter); reason != "" && reason != "all" {
		q = q.Where("reason = ?", reason)
	}
	if f.From > 0 {
		q = q.Where("created_at >= ?", f.From)
	}
	if f.To > 0 {
		q = q.Where("created_at <= ?", f.To)
	}
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		like := "%" + kw + "%"
		var ids []int
		_ = DB.Model(&User{}).Where("username LIKE ?", like).Pluck("id", &ids)
		if len(ids) > 0 {
			q = q.Where("user_id IN ? OR ref_id LIKE ?", ids, like)
		} else {
			q = q.Where("ref_id LIKE ?", like)
		}
	}
	return q
}

type LotteryTicketTopUp struct {
	TradeNo       string  `json:"trade_no"`
	Money         float64 `json:"money"`
	PaymentMethod string  `json:"payment_method"`
	Status        string  `json:"status"`
	Kind          string  `json:"kind"`
}

type LotteryAdminTicketLog struct {
	Id           int                 `json:"id"`
	UserId       int                 `json:"user_id"`
	Username     string              `json:"username"`
	Delta        int                 `json:"delta"`
	Reason       string              `json:"reason"`
	RefType      string              `json:"ref_type"`
	RefId        string              `json:"ref_id"`
	BalanceAfter int                 `json:"balance_after"`
	CreatedAt    int64               `json:"created_at"`
	TopUp        *LotteryTicketTopUp `json:"topup,omitempty"`
}

func ListLotteryAdminTicketLogs(f LotteryListFilter) ([]LotteryAdminTicketLog, int64, error) {
	rows, total, err := ListLotteryTicketLogs(f)
	if err != nil {
		return nil, 0, err
	}
	out := attachLotteryAdminTicketLogs(rows)
	return out, total, nil
}

func attachLotteryAdminTicketLogs(rows []LotteryTicketLog) []LotteryAdminTicketLog {
	out := make([]LotteryAdminTicketLog, 0, len(rows))
	if len(rows) == 0 {
		return out
	}
	ids := make([]int, 0, len(rows))
	tradeNos := make([]string, 0)
	seenID := map[int]struct{}{}
	seenTrade := map[string]struct{}{}
	for _, row := range rows {
		if _, ok := seenID[row.UserId]; !ok && row.UserId > 0 {
			seenID[row.UserId] = struct{}{}
			ids = append(ids, row.UserId)
		}
		if row.Reason == LotteryReasonPaymentGrant && row.RefId != "" {
			if _, ok := seenTrade[row.RefId]; !ok {
				seenTrade[row.RefId] = struct{}{}
				tradeNos = append(tradeNos, row.RefId)
			}
		}
	}
	names := map[int]string{}
	if len(ids) > 0 {
		var users []User
		_ = DB.Select("id, username").Where("id IN ?", ids).Find(&users).Error
		for _, u := range users {
			names[u.Id] = u.Username
		}
	}
	topups := map[string]TopUp{}
	subs := map[string]SubscriptionOrder{}
	if len(tradeNos) > 0 {
		var found []TopUp
		_ = DB.Where("trade_no IN ?", tradeNos).Find(&found).Error
		for _, item := range found {
			topups[item.TradeNo] = item
		}
		var orders []SubscriptionOrder
		_ = DB.Where("trade_no IN ?", tradeNos).Find(&orders).Error
		for _, item := range orders {
			subs[item.TradeNo] = item
		}
	}
	for _, row := range rows {
		item := LotteryAdminTicketLog{
			Id:           row.Id,
			UserId:       row.UserId,
			Username:     names[row.UserId],
			Delta:        row.Delta,
			Reason:       row.Reason,
			RefType:      row.RefType,
			RefId:        row.RefId,
			BalanceAfter: row.BalanceAfter,
			CreatedAt:    row.CreatedAt,
		}
		if row.Reason == LotteryReasonPaymentGrant && row.RefId != "" {
			item.TopUp = lotteryTicketTopUpRef(row.RefId, topups, subs)
		}
		out = append(out, item)
	}
	return out
}

func lotteryTicketTopUpRef(tradeNo string, topups map[string]TopUp, subs map[string]SubscriptionOrder) *LotteryTicketTopUp {
	ref := &LotteryTicketTopUp{TradeNo: tradeNo, Kind: "missing"}
	if order, ok := subs[tradeNo]; ok {
		ref.Money = order.Money
		ref.PaymentMethod = order.PaymentMethod
		ref.Status = order.Status
		ref.Kind = "subscription"
		return ref
	}
	if top, ok := topups[tradeNo]; ok {
		ref.Money = top.Money
		ref.PaymentMethod = top.PaymentMethod
		ref.Status = top.Status
		ref.Kind = "wallet"
		return ref
	}
	if strings.HasPrefix(tradeNo, "SIM-") {
		ref.Kind = "simulated"
	}
	return ref
}

func ListPublicLotteryFeed(limit int) ([]LotteryDraw, error) {
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	var rows []LotteryDraw
	err := DB.Where("is_win = ?", true).Order("id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

type LotteryUserSummary struct {
	UserId   int     `json:"user_id"`
	Username string  `json:"username"`
	Draws    int64   `json:"draws"`
	Wins     int64   `json:"wins"`
	Quota    float64 `json:"quota"`
	LastAt   int64   `json:"last_at"`
	Tickets  int     `json:"tickets"`
}

func lotteryUserSummaryQuery(keyword string) *gorm.DB {
	q := DB.Model(&LotteryDraw{})
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return q
	}
	like := "%" + keyword + "%"
	if id, err := strconv.Atoi(keyword); err == nil && id > 0 {
		return q.Where("user_id = ? OR username LIKE ?", id, like)
	}
	return q.Where("username LIKE ?", like)
}

func ListLotteryUserSummaries(page, size int, keyword string) ([]LotteryUserSummary, int64, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 10
	}
	var total int64
	if err := lotteryUserSummaryQuery(keyword).Distinct("user_id").Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []LotteryUserSummary
	err := lotteryUserSummaryQuery(keyword).
		Select("user_id, MAX(username) as username, COUNT(*) as draws, SUM(CASE WHEN is_win THEN 1 ELSE 0 END) as wins, COALESCE(SUM(quota_awarded),0) as quota, MAX(created_at) as last_at").
		Group("user_id").
		Order("last_at DESC").
		Limit(size).
		Offset((page - 1) * size).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	ids := make([]int, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.UserId)
	}
	if len(ids) > 0 {
		var wallets []LotteryWallet
		_ = DB.Where("user_id IN ?", ids).Find(&wallets).Error
		byId := map[int]int{}
		for _, w := range wallets {
			byId[w.UserId] = w.Tickets
		}
		for i := range rows {
			rows[i].Tickets = byId[rows[i].UserId]
		}
	}
	return rows, total, nil
}

type LotteryPeriodStats struct {
	Draws    int64   `json:"draws"`
	Wins     int64   `json:"wins"`
	Users    int64   `json:"users"`
	WonQuota float64 `json:"won_quota"`
}

type LotteryPrizeStat struct {
	Code  string  `json:"code"`
	Label string  `json:"label"`
	Draws int64   `json:"draws"`
	Wins  int64   `json:"wins"`
	Quota float64 `json:"quota"`
}

type LotteryOverview struct {
	Users       int64               `json:"users"`
	Draws       int64               `json:"draws"`
	TodayDraws  int64               `json:"today_draws"`
	WonQuota    float64             `json:"won_quota"`
	Today       LotteryPeriodStats  `json:"today"`
	Week        LotteryPeriodStats  `json:"week"`
	All         LotteryPeriodStats  `json:"all"`
	TodayPrizes []LotteryPrizeStat `json:"today_prizes"`
	WeekPrizes  []LotteryPrizeStat `json:"week_prizes"`
	AllPrizes   []LotteryPrizeStat `json:"all_prizes"`
}

func lotteryPeriodQuery(since int64) *gorm.DB {
	q := DB.Model(&LotteryDraw{})
	if since > 0 {
		q = q.Where("created_at >= ?", since)
	}
	return q
}

func lotteryPeriodStats(since int64) (LotteryPeriodStats, error) {
	out := LotteryPeriodStats{}
	if err := lotteryPeriodQuery(since).Count(&out.Draws).Error; err != nil {
		return out, err
	}
	if err := lotteryPeriodQuery(since).Where("is_win = ?", true).Count(&out.Wins).Error; err != nil {
		return out, err
	}
	if err := lotteryPeriodQuery(since).Distinct("user_id").Count(&out.Users).Error; err != nil {
		return out, err
	}
	_ = lotteryPeriodQuery(since).Select("COALESCE(SUM(quota_awarded),0)").Scan(&out.WonQuota).Error
	return out, nil
}

func lotteryPrizeBreakdown(since int64) ([]LotteryPrizeStat, error) {
	var rows []LotteryPrizeStat
	err := lotteryPeriodQuery(since).
		Select("prize_code as code, MAX(prize_label) as label, COUNT(*) as draws, SUM(CASE WHEN is_win THEN 1 ELSE 0 END) as wins, COALESCE(SUM(quota_awarded),0) as quota").
		Group("prize_code").
		Order("quota DESC, draws DESC").
		Scan(&rows).Error
	if rows == nil {
		rows = []LotteryPrizeStat{}
	}
	return rows, err
}

func GetLotteryOverview() (*LotteryOverview, error) {
	out := &LotteryOverview{}
	today := startOfTodayUnix()
	week := startOfWeekUnix()
	all, err := lotteryPeriodStats(0)
	if err != nil {
		return nil, err
	}
	todayStats, err := lotteryPeriodStats(today)
	if err != nil {
		return nil, err
	}
	weekStats, err := lotteryPeriodStats(week)
	if err != nil {
		return nil, err
	}
	todayPrizes, err := lotteryPrizeBreakdown(today)
	if err != nil {
		return nil, err
	}
	weekPrizes, err := lotteryPrizeBreakdown(week)
	if err != nil {
		return nil, err
	}
	allPrizes, err := lotteryPrizeBreakdown(0)
	if err != nil {
		return nil, err
	}
	out.Users = all.Users
	out.Draws = all.Draws
	out.TodayDraws = todayStats.Draws
	out.WonQuota = all.WonQuota
	out.All = all
	out.Today = todayStats
	out.Week = weekStats
	out.TodayPrizes = todayPrizes
	out.WeekPrizes = weekPrizes
	out.AllPrizes = allPrizes
	return out, nil
}

func MaskLotteryName(name string) string {
	r := []rune(strings.TrimSpace(name))
	if len(r) == 0 {
		return "*"
	}
	if len(r) == 1 {
		return string(r[0]) + "*"
	}
	return string(r[0]) + "*" + string(r[len(r)-1])
}

func EnsureLotteryDefaults() error {
	if _, err := GetLotteryConfig(); err != nil {
		return err
	}
	var n int64
	if err := DB.Model(&LotteryPrize{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	now := time.Now().Unix()
	navy, cream := "#1e3a5f", "#f4e6c1"
	sand, ink := "#efe6d2", "#1a2744"
	prizes := []LotteryPrize{
		{Code: "q01", Label: "$0.50", Short: "0.50", Hint: "额度", Weight: 38, QuotaAmount: 0.5, Tier: "common", Fill: navy, Ink: cream, RedemptionName: "lottery-q01"},
		{Code: "thanks", Label: "未中奖", Short: "未中", Hint: "再接再厉", Weight: 37, Tier: "miss", Fill: sand, Ink: ink},
		{Code: "q1", Label: "$1.00", Short: "1.00", Hint: "额度", Weight: 14, QuotaAmount: 1, Tier: "uncommon", Fill: sand, Ink: ink, RedemptionName: "lottery-q1"},
		{Code: "again", Label: "再抽一次", Short: "+1次", Hint: "次数返还", Weight: 8, ExtraTicket: true, Tier: "uncommon", Fill: navy, Ink: cream},
		{Code: "q3", Label: "$3.00", Short: "3.00", Hint: "额度", Weight: 2, QuotaAmount: 3, Tier: "rare", Fill: sand, Ink: ink, RedemptionName: "lottery-q3"},
		{Code: "q10", Label: "$10.00", Short: "$10", Hint: "大奖", Weight: 1, QuotaAmount: 10, Tier: "legend", Fill: navy, Ink: cream, RedemptionName: "lottery-q10"},
	}
	for i := range prizes {
		prizes[i].Enabled = true
		prizes[i].SortOrder = i
		prizes[i].UpdatedAt = now
		NormalizeLotteryPrize(&prizes[i])
		if err := DB.Create(&prizes[i]).Error; err != nil {
			return err
		}
	}
	return nil
}
