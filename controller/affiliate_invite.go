// Package controller — 邀请返利页（本站）：邀请码管理、已邀请用户、返利一键转余额
package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

type inviteCodeView struct {
	Id          int    `json:"id"`
	Code        string `json:"code"`
	CreatedAt   int64  `json:"created_at"`
	InviteCount int    `json:"invite_count"`
	RebateQuota int    `json:"rebate_quota"`
}

// GetUserAffiliateOverview 邀请返利页顶部卡片 + 邀请码列表。
func GetUserAffiliateOverview(c *gin.Context) {
	id := c.GetInt("id")
	user, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stats, inviteCount, err := model.GetInviteCodeStats(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	codes, err := model.ListUserInviteCodes(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	statOf := func(codeId int) model.InviteCodeStat {
		if s := stats[codeId]; s != nil {
			return *s
		}
		return model.InviteCodeStat{}
	}
	rebateTotal := 0
	for _, s := range stats {
		rebateTotal += s.RebateQuota
	}
	def := statOf(0)
	views := make([]inviteCodeView, 0, len(codes))
	for _, code := range codes {
		s := statOf(code.Id)
		views = append(views, inviteCodeView{
			Id: code.Id, Code: code.Code, CreatedAt: code.CreatedAt,
			InviteCount: s.InviteCount, RebateQuota: s.RebateQuota,
		})
	}
	common.ApiSuccess(c, gin.H{
		"enabled":           common.AffiliateRebateEnabled,
		"percent":           common.AffiliateRebatePercent,
		"every_top_up":      common.AffiliateRebateEveryTopUp,
		"min_threshold_usd": common.AffiliateRebateMinThresholdUSD,
		"bonus_usd":         common.AffiliateRebateBonusUSD,
		"delay_days":        common.AffiliateRebateDelayDays,
		"same_ip_check":     common.AffiliateRebateSameIPCheck,
		"extra_rules":       common.AffiliateRebateExtraRules,
		"transfer_enabled":  operation_setting.IsPaymentComplianceConfirmed(),
		"invite_count":      inviteCount,
		"aff_quota":         user.AffQuota,
		"aff_pending_quota": user.AffPendingQuota,
		"aff_history_quota": user.AffHistoryQuota,
		"rebate_total":      rebateTotal,
		"default_code": inviteCodeView{
			Code: user.AffCode, InviteCount: def.InviteCount, RebateQuota: def.RebateQuota,
		},
		"codes":     views,
		"max_codes": model.AffInviteCodeMaxPerUser,
	})
}

// GetUserAffiliateInvitees 已邀请用户（邮箱脱敏）及每人带来的返利。
func GetUserAffiliateInvitees(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	rows, total, err := model.ListInvitees(c.GetInt("id"), page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "page": page})
}

type createInviteCodeRequest struct {
	Code string `json:"code"`
}

// CreateUserAffiliateCode 新建自定义邀请码。
func CreateUserAffiliateCode(c *gin.Context) {
	var req createInviteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	code, err := model.CreateUserInviteCode(c.GetInt("id"), req.Code)
	if err != nil {
		if isInviteCodeUserError(err) {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, inviteCodeView{Id: code.Id, Code: code.Code, CreatedAt: code.CreatedAt})
}

// DeleteUserAffiliateCode 删除自定义邀请码，链接立即失效。
func DeleteUserAffiliateCode(c *gin.Context) {
	codeId, err := strconv.Atoi(c.Param("id"))
	if err != nil || codeId <= 0 {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	if err := model.DeleteUserInviteCode(c.GetInt("id"), codeId); err != nil {
		if isInviteCodeUserError(err) {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// TransferAllAffiliateQuota 可用返利额度一键全部转入余额。
func TransferAllAffiliateQuota(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	moved, err := model.TransferAllAffQuotaToQuota(c.GetInt("id"))
	if err != nil {
		if errors.Is(err, model.ErrNoAffQuotaToTransfer) {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"quota": moved})
}

func isInviteCodeUserError(err error) bool {
	return errors.Is(err, model.ErrInviteCodeInvalid) || errors.Is(err, model.ErrInviteCodeTaken) ||
		errors.Is(err, model.ErrInviteCodeLimit) || errors.Is(err, model.ErrInviteCodeMissing) ||
		errors.Is(err, model.ErrInviteCodeQuota)
}

// AdminApproveAffiliateRebate 管理员复核：被系统判为同 IP 的返利确认是真实邀请，补发到账。
func AdminApproveAffiliateRebate(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	if err := model.ApproveSkippedAffRebateById(id, c.GetInt("id")); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, nil)
}
