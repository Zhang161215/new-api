// Package service — Affiliate Top-up Rebate trigger
//
// Copyright (C) 2024 QuantumNous
// Licensed under the AGPL v3 License (see project LICENSE).
package service

import (
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/shopspring/decimal"
)

// CalculateRebateMoney 给定充值金额，返回返利美元金额（按当前全局配置）。
// 每笔返利模式：money * Percent / 100。
// 首充模式额外保底：若 money * Percent / 100 < MinThresholdUSD，再加 BonusUSD（阈值或奖励为 0 即不生效）。
func CalculateRebateMoney(money float64) float64 {
	dMoney := decimal.NewFromFloat(money)
	dPercent := decimal.NewFromFloat(common.AffiliateRebatePercent).Div(decimal.NewFromInt(100))
	rebate := dMoney.Mul(dPercent)
	if common.AffiliateRebateEveryTopUp {
		return rebate.InexactFloat64()
	}
	dThreshold := decimal.NewFromFloat(common.AffiliateRebateMinThresholdUSD)
	if rebate.LessThan(dThreshold) {
		bonus := decimal.NewFromFloat(common.AffiliateRebateBonusUSD)
		return bonus.Add(rebate).InexactFloat64()
	}
	return rebate.InexactFloat64()
}

// sameRegisterNetwork 判断两个注册 IP 是否算同一来源：IPv4 完全相同，IPv6 同一 /64。
// 任一为空或解析失败都不算（老账号没有注册 IP，不能误伤）。
func sameRegisterNetwork(a, b string) bool {
	ipA := net.ParseIP(strings.TrimSpace(a))
	ipB := net.ParseIP(strings.TrimSpace(b))
	if ipA == nil || ipB == nil {
		return false
	}
	if v4a, v4b := ipA.To4(), ipB.To4(); v4a != nil || v4b != nil {
		return v4a != nil && v4b != nil && v4a.Equal(v4b)
	}
	mask := net.CIDRMask(64, 128)
	return ipA.Mask(mask).Equal(ipB.Mask(mask))
}

// isSharedEgressIP 是否在「共享出口 IP」名单里（线路机、公司网等多人共用的出口），这类 IP 不做同 IP 判断。
// 名单支持单个 IP 或 CIDR，逗号 / 空白 / 换行分隔。
func isSharedEgressIP(ip string, list string) bool {
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		return false
	}
	for _, item := range strings.FieldsFunc(list, func(r rune) bool {
		switch r {
		case ',', '，', ';', '；', '、', ' ', '\n', '\r', '\t':
			return true
		}
		return false
	}) {
		if strings.Contains(item, "/") {
			if _, cidr, err := net.ParseCIDR(item); err == nil && cidr.Contains(parsed) {
				return true
			}
			continue
		}
		if other := net.ParseIP(item); other != nil && other.Equal(parsed) {
			return true
		}
	}
	return false
}

// isSameIPInvite 被邀人与邀请人注册 IP 相同（且不在共享出口名单里）视为非真实邀请。
func isSameIPInvite(inviter, invitee *model.User) bool {
	if !common.AffiliateRebateSameIPCheck || inviter == nil || invitee == nil {
		return false
	}
	if !sameRegisterNetwork(inviter.RegisterIP, invitee.RegisterIP) {
		return false
	}
	return !isSharedEgressIP(invitee.RegisterIP, common.AffiliateRebateSharedIPs)
}

// TriggerAffiliateRebate 在 top_up 成功 commit 后调用。
// 幂等：依赖 (aff_rebates.top_up_id) 唯一索引 + Go 端 SELECT 双保险。
// 默认被邀人每笔成功充值都返利；关掉 AffiliateRebateEveryTopUp 时只返首充。
// 被邀人与邀请人同 IP 注册时不返利，只留一条 revoked 记录（skip_reason=same_ip）供管理员复核。
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
	inviter, errInviter := model.GetUserById(invitee.InviterId, false)
	if errInviter != nil || inviter == nil {
		common.SysLog(fmt.Sprintf("affiliate rebate skipped: inviter #%d not found for user #%d", invitee.InviterId, invitee.Id))
		return nil
	}

	// 3. 首充模式：只认被邀人的第一笔成功充值（包含当前这笔已 commit 的 success）
	if !common.AffiliateRebateEveryTopUp {
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
	rebate := &model.AffRebate{
		InviterId:    invitee.InviterId,
		InviteeId:    invitee.Id,
		TopUpId:      topUp.Id,
		TopUpMoney:   topUp.Money,
		RebateAmount: rebateQuota,
		RebateMoney:  rebateMoney,
		CreatedAt:    now,
	}

	// 6. 同 IP 注册：判为非真实邀请，留痕不发
	if isSameIPInvite(inviter, invitee) {
		if err := model.CreateSkippedAffRebate(rebate, model.AffRebateSkipSameIP, model.AffRebateSameIPReason); err != nil {
			common.SysLog(fmt.Sprintf("create skipped aff_rebate failed (topup #%d): %v", topUp.Id, err))
			return err
		}
		common.SysLog(fmt.Sprintf("affiliate rebate skipped (same register ip): inviter #%d invitee #%d topup #%d", inviter.Id, invitee.Id, topUp.Id))
		return nil
	}

	delaySeconds := int64(common.AffiliateRebateDelayDays) * 86400
	if delaySeconds < 0 {
		delaySeconds = 0
	}
	rebate.Status = model.AffRebateStatusPending
	rebate.ReleaseAt = now + delaySeconds
	if err := model.CreatePendingAffRebate(rebate); err != nil {
		// 可能是 unique 冲突（极端并发）；忽略
		common.SysLog(fmt.Sprintf("create aff_rebate failed (topup #%d): %v", topUp.Id, err))
		return err
	}

	releaseTimeStr := time.Unix(rebate.ReleaseAt, 0).Format("2006-01-02 15:04")
	model.RecordLog(invitee.InviterId, model.LogTypeAffiliateRebate, common.NewMessage(
		"邀请用户 #{{invitee}} 充值 ${{topup}}，返利 ${{rebate}} 已生成，预计 {{release_at}} 到账",
		map[string]any{
			"invitee":    invitee.Id,
			"topup":      fmt.Sprintf("%.2f", topUp.Money),
			"rebate":     fmt.Sprintf("%.2f", rebateMoney),
			"release_at": releaseTimeStr,
		},
	))
	return nil
}
