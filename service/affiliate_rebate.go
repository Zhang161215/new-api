// Package service — Affiliate Top-up Rebate trigger
//
// Copyright (C) 2024 QuantumNous
// Licensed under the AGPL v3 License (see project LICENSE).
package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/shopspring/decimal"
)

// CalculateRebateMoney 给定充值美元金额，返回返利美元金额（按当前全局配置）。
// 公式：
//   fivePercent = money * (Percent / 100)
//   if fivePercent < MinThresholdUSD: return BonusUSD + fivePercent
//   else: return fivePercent
func CalculateRebateMoney(money float64) float64 {
	dMoney := decimal.NewFromFloat(money)
	dPercent := decimal.NewFromFloat(common.AffiliateRebatePercent).Div(decimal.NewFromInt(100))
	fivePercent := dMoney.Mul(dPercent)
	dThreshold := decimal.NewFromFloat(common.AffiliateRebateMinThresholdUSD)
	if fivePercent.LessThan(dThreshold) {
		bonus := decimal.NewFromFloat(common.AffiliateRebateBonusUSD)
		return bonus.Add(fivePercent).InexactFloat64()
	}
	return fivePercent.InexactFloat64()
}

// TriggerAffiliateRebate 在 top_up 成功 commit 后调用。
// 幂等：依赖 (aff_rebates.top_up_id) 唯一索引 + Go 端 SELECT 双保险。
// 仅对被邀人的"首次"成功充值生效。
func TriggerAffiliateRebate(topUp *model.TopUp) error {
	if topUp == nil {
		return nil
	}
	if !common.AffiliateRebateEnabled {
		return nil
	}
	if topUp.Status != common.TopUpStatusSuccess {
		return nil
	}
	if topUp.Money <= 0 {
		return nil
	}

	// 1. 取被邀人
	invitee, err := model.GetUserById(topUp.UserId, false)
	if err != nil {
		return err
	}
	if invitee == nil || invitee.InviterId == 0 {
		return nil // 没有邀请人，跳过
	}

	// 2. 检查邀请人是否存在（含软删则跳过）
	var inviterExists bool
	if _, errInviter := model.GetUserById(invitee.InviterId, false); errInviter == nil {
		inviterExists = true
	}
	if !inviterExists {
		common.SysLog(fmt.Sprintf("affiliate rebate skipped: inviter #%d not found for user #%d", invitee.InviterId, invitee.Id))
		return nil
	}

	// 3. 判断是否首充（包含当前这笔已 commit 的 success）
	count, err := model.CountSuccessTopUpsForUser(invitee.Id)
	if err != nil {
		return err
	}
	if count == 0 {
		common.SysLog(fmt.Sprintf("affiliate rebate warning: success count==0 for user #%d after commit", invitee.Id))
		return nil
	}
	if count != 1 {
		return nil // 不是首充
	}

	// 4. 双保险：检查 aff_rebates 是否已有该 topup_id
	if existed, _ := model.GetAffRebateByTopUpId(topUp.Id); existed != nil {
		return nil
	}

	// 5. 计算返利
	rebateMoney := CalculateRebateMoney(topUp.Money)
	if rebateMoney <= 0 {
		return nil
	}
	rebateQuota := int(decimal.NewFromFloat(rebateMoney).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	if rebateQuota <= 0 {
		return nil
	}

	now := time.Now().Unix()
	delaySeconds := int64(common.AffiliateRebateDelayDays) * 86400
	if delaySeconds < 0 {
		delaySeconds = 0
	}

	rebate := &model.AffRebate{
		InviterId:    invitee.InviterId,
		InviteeId:    invitee.Id,
		TopUpId:      topUp.Id,
		TopUpMoney:   topUp.Money,
		RebateAmount: rebateQuota,
		RebateMoney:  rebateMoney,
		Status:       model.AffRebateStatusPending,
		CreatedAt:    now,
		ReleaseAt:    now + delaySeconds,
	}
	if err := model.CreatePendingAffRebate(rebate); err != nil {
		// 可能是 unique 冲突（极端并发）；忽略
		common.SysLog(fmt.Sprintf("create aff_rebate failed (topup #%d): %v", topUp.Id, err))
		return err
	}

	releaseTimeStr := time.Unix(rebate.ReleaseAt, 0).Format("2006-01-02 15:04")
	model.RecordLog(invitee.InviterId, model.LogTypeAffiliateRebate, fmt.Sprintf(
		"邀请用户 #%d 首次充值 $%.2f，返利 $%.2f 已生成，预计 %s 到账",
		invitee.Id, topUp.Money, rebateMoney, releaseTimeStr,
	))
	return nil
}
