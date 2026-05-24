// Package controller — Affiliate Rebate API handlers
//
// Copyright (C) 2024 QuantumNous
// Licensed under the AGPL v3 License (see project LICENSE).
package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 用户端 ----------

// GetUserAffiliateSummary 用户钱包顶部 4 卡片所需数据
// 实际值已包含在 /api/user/self 中（User.AffQuota/AffPendingQuota 等），
// 这里提供一个单独端点便于刷新。
func GetUserAffiliateSummary(c *gin.Context) {
	id := c.GetInt("id")
	user, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"aff_quota":         user.AffQuota,
		"aff_pending_quota": user.AffPendingQuota,
		"aff_history_quota": user.AffHistoryQuota,
		"aff_count":         user.AffCount,
	})
}

// GetUserAffiliateConfig 给前端展示活动规则。
func GetUserAffiliateConfig(c *gin.Context) {
	common.ApiSuccess(c, gin.H{
		"enabled":              common.AffiliateRebateEnabled,
		"percent":              common.AffiliateRebatePercent,
		"min_threshold_usd":    common.AffiliateRebateMinThresholdUSD,
		"bonus_usd":            common.AffiliateRebateBonusUSD,
		"delay_days":           common.AffiliateRebateDelayDays,
		"quota_per_unit":       common.QuotaPerUnit,
	})
}

// GetUserAffiliateHistory 当前用户作为邀请人的全部返利记录。
func GetUserAffiliateHistory(c *gin.Context) {
	id := c.GetInt("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	items, total, err := model.ListInviterRebates(id, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 附加被邀人用户名（脱敏展示前 N 位即可）
	enriched := make([]map[string]interface{}, 0, len(items))
	for _, r := range items {
		entry := map[string]interface{}{
			"id":            r.Id,
			"invitee_id":    r.InviteeId,
			"topup_id":      r.TopUpId,
			"topup_money":   r.TopUpMoney,
			"rebate_amount": r.RebateAmount,
			"rebate_money":  r.RebateMoney,
			"status":        r.Status,
			"created_at":    r.CreatedAt,
			"release_at":    r.ReleaseAt,
			"released_at":   r.ReleasedAt,
			"revoked_at":    r.RevokedAt,
			"revoke_reason": r.RevokeReason,
		}
		if username, _ := model.GetUsernameById(r.InviteeId, false); username != "" {
			entry["invitee_username"] = maskInviteeUsername(username)
		}
		enriched = append(enriched, entry)
	}

	common.ApiSuccess(c, gin.H{
		"items":     enriched,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// maskInviteeUsername 简单脱敏：保留首尾字符。
func maskInviteeUsername(u string) string {
	r := []rune(u)
	if len(r) <= 2 {
		return u
	}
	if len(r) <= 4 {
		return string(r[0]) + "***" + string(r[len(r)-1])
	}
	return string(r[:2]) + "***" + string(r[len(r)-2:])
}

// ---------- 管理员端 ----------

// AdminListAffiliateRebates 管理员列表 + 筛选
func AdminListAffiliateRebates(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 20
	}
	inviterId, _ := strconv.Atoi(c.Query("inviter_id"))
	inviteeId, _ := strconv.Atoi(c.Query("invitee_id"))
	startTime, _ := strconv.ParseInt(c.Query("start_time"), 10, 64)
	endTime, _ := strconv.ParseInt(c.Query("end_time"), 10, 64)

	q := model.ListAffRebatesQuery{
		Status:    c.Query("status"),
		InviterId: inviterId,
		InviteeId: inviteeId,
		StartTime: startTime,
		EndTime:   endTime,
	}

	items, total, err := model.ListAffRebates(q, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	enriched := make([]map[string]interface{}, 0, len(items))
	for _, r := range items {
		entry := map[string]interface{}{
			"id":            r.Id,
			"inviter_id":    r.InviterId,
			"invitee_id":    r.InviteeId,
			"topup_id":      r.TopUpId,
			"topup_money":   r.TopUpMoney,
			"rebate_amount": r.RebateAmount,
			"rebate_money":  r.RebateMoney,
			"status":        r.Status,
			"created_at":    r.CreatedAt,
			"release_at":    r.ReleaseAt,
			"released_at":   r.ReleasedAt,
			"revoked_at":    r.RevokedAt,
			"revoke_reason": r.RevokeReason,
			"operator_id":   r.OperatorId,
		}
		if inviterName, _ := model.GetUsernameById(r.InviterId, false); inviterName != "" {
			entry["inviter_username"] = inviterName
		}
		if inviteeName, _ := model.GetUsernameById(r.InviteeId, false); inviteeName != "" {
			entry["invitee_username"] = inviteeName
		}
		enriched = append(enriched, entry)
	}

	common.ApiSuccess(c, gin.H{
		"items":     enriched,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// AdminReleaseAffiliateRebate 管理员提前到账。
func AdminReleaseAffiliateRebate(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	operatorId := c.GetInt("id")
	ok, err := model.ReleaseAffRebateById(id, operatorId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !ok {
		common.ApiErrorMsg(c, "该返利不是待到账状态，无法到账")
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminRevokeAffiliateRebate 撤销返利
type adminRevokeAffRebateReq struct {
	Reason string `json:"reason"`
}

func AdminRevokeAffiliateRebate(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	var req adminRevokeAffRebateReq
	_ = c.ShouldBindJSON(&req)
	reason := req.Reason
	if len(reason) > 255 {
		reason = reason[:255]
	}

	operatorId := c.GetInt("id")
	if err := model.RevokeAffRebateById(id, operatorId, reason); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
