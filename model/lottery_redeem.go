package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"gorm.io/gorm"
)

// redeemLotteryCodeTx 把已经发给 userId 的抽奖兑换码按兑换流程入账：先加额度，再把码标成已使用。
// 额度只来自这张码本身（库存里预先生成的），和用户在兑换页手动兑换走同一套归属 / 状态 / 过期校验。
// 任何一步失败都返回错误，由调用方回滚事务，不会出现“码已用但没加额度”或反过来的半截状态。
func redeemLotteryCodeTx(tx *gorm.DB, codeId, userId int) (int, error) {
	if codeId <= 0 || userId <= 0 {
		return 0, ErrLotteryDrawNoCode
	}
	var item Redemption
	if err := lockForUpdate(tx).Where("id = ?", codeId).First(&item).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, ErrLotteryDrawNoCode
		}
		return 0, err
	}
	if !isLotteryRedemptionName(tx, item.Name) {
		return 0, ErrLotteryCodeNotRedeemable
	}
	if item.UsedUserId != userId {
		return 0, ErrLotteryCodeNotYours
	}
	if item.Status == common.RedemptionCodeStatusUsed {
		return 0, ErrLotteryCodeRedeemed
	}
	if item.Status != common.RedemptionCodeStatusEnabled {
		return 0, ErrLotteryCodeNotRedeemable
	}
	now := common.GetTimestamp()
	if item.ExpiredTime != 0 && item.ExpiredTime < now {
		return 0, ErrLotteryCodeExpired
	}
	if err := creditTopUpQuota(tx, userId, item.Quota, nil); err != nil {
		return 0, err
	}
	res := tx.Model(&Redemption{}).
		Where("id = ? AND status = ? AND used_user_id = ?", item.Id, common.RedemptionCodeStatusEnabled, userId).
		Updates(map[string]any{
			"redeemed_time": now,
			"status":        common.RedemptionCodeStatusUsed,
		})
	if res.Error != nil {
		return 0, res.Error
	}
	if res.RowsAffected != 1 {
		return 0, ErrLotteryCodeRedeemed
	}
	return item.Quota, nil
}

// afterLotteryRedeem 事务提交后同步额度缓存并记一条充值日志（和兑换页兑换同一条文案）。
func afterLotteryRedeem(userId, quota, codeId int) {
	if quota <= 0 {
		return
	}
	syncCreditUserQuotaCache(userId, quota, common.LogText("lottery redemption"))
	RecordLog(userId, LogTypeTopup, common.NewMessage("Topped up {{quota}} with a redemption code, code ID {{id}}", map[string]any{"quota": logger.FormatQuota(quota), "id": codeId}))
}

func isLotteryRedeemUserError(err error) bool {
	return errors.Is(err, ErrLotteryDrawNotFound) ||
		errors.Is(err, ErrLotteryDrawNoCode) ||
		errors.Is(err, ErrLotteryCodeRedeemed) ||
		errors.Is(err, ErrLotteryCodeExpired) ||
		errors.Is(err, ErrLotteryCodeNotYours) ||
		errors.Is(err, ErrLotteryCodeNotRedeemable) ||
		errors.Is(err, ErrTopUpQuotaLimitExceeded) ||
		errors.Is(err, ErrInvalidTopUpQuota)
}

// RedeemLotteryDraw 用户在抽奖页一键兑换自己某次中奖的兑换码（自动入账关闭时，或历史上没兑换的码）。
// 只认这条抽奖记录本人；不需要兑换页的随机延迟，因为不接受用户输入的码，没有撞码的可能。
func RedeemLotteryDraw(userId, drawId int) (int, error) {
	if userId <= 0 || drawId <= 0 {
		return 0, ErrLotteryDrawNotFound
	}
	var draw LotteryDraw
	if err := DB.Where("id = ? AND user_id = ?", drawId, userId).First(&draw).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, ErrLotteryDrawNotFound
		}
		return 0, err
	}
	if draw.RedemptionId <= 0 {
		return 0, ErrLotteryDrawNoCode
	}
	quota := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		q, err := redeemLotteryCodeTx(tx, draw.RedemptionId, userId)
		quota = q
		return err
	})
	if err != nil {
		if isLotteryRedeemUserError(err) {
			return 0, err
		}
		common.SysError(common.LogText("lottery redemption failed: %s", err.Error()))
		return 0, ErrRedeemFailed
	}
	afterLotteryRedeem(userId, quota, draw.RedemptionId)
	return quota, nil
}

// LotteryRedeemedCodeIds 返回这些兑换码里已经兑换（status=已使用）的 id 集合，给抽奖记录标「已入账」。
func LotteryRedeemedCodeIds(ids []int) map[int]bool {
	out := make(map[int]bool, len(ids))
	uniq := make([]int, 0, len(ids))
	for _, id := range ids {
		if id > 0 {
			if _, ok := out[id]; !ok {
				out[id] = false
				uniq = append(uniq, id)
			}
		}
	}
	if len(uniq) == 0 {
		return out
	}
	var used []int
	if err := DB.Model(&Redemption{}).
		Where("id IN ? AND status = ?", uniq, common.RedemptionCodeStatusUsed).
		Pluck("id", &used).Error; err != nil {
		return out
	}
	for _, id := range used {
		out[id] = true
	}
	return out
}
