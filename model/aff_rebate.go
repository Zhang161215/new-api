// Package model — Affiliate Top-up Rebate
//
// Copyright (C) 2024 QuantumNous
// Licensed under the AGPL v3 License (see project LICENSE).
package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AffRebateStatusPending  = "pending"
	AffRebateStatusReleased = "released"
	AffRebateStatusRevoked  = "revoked"
)

// AffRebate 表示一条邀请充值返利记录。
// 每一笔被邀人的首次成功充值会生成且仅生成一条。
type AffRebate struct {
	Id           int     `json:"id" gorm:"primaryKey"`
	InviterId    int     `json:"inviter_id" gorm:"index;not null"`
	InviteeId    int     `json:"invitee_id" gorm:"index;not null"`
	TopUpId      int     `json:"topup_id" gorm:"uniqueIndex;not null"` // 防重
	TopUpMoney   float64 `json:"topup_money"`                          // 充值美元（展示用）
	RebateAmount int     `json:"rebate_amount"`                        // 返利 quota（内部单位）
	RebateMoney  float64 `json:"rebate_money"`                         // 返利美元（展示用）
	Status       string  `json:"status" gorm:"type:varchar(20);index;default:'pending'"`
	CreatedAt    int64   `json:"created_at" gorm:"index"`
	ReleaseAt    int64   `json:"release_at" gorm:"index"`  // 预计到账时间
	ReleasedAt   int64   `json:"released_at"`              // 实际到账时间（手动或定时）
	RevokedAt    int64   `json:"revoked_at"`
	RevokeReason string  `json:"revoke_reason" gorm:"type:varchar(255)"`
	OperatorId   int     `json:"operator_id"` // 管理员操作时记录
}

func (AffRebate) TableName() string {
	return "aff_rebates"
}

// GetAffRebateById 根据主键取记录。
func GetAffRebateById(id int) (*AffRebate, error) {
	if id <= 0 {
		return nil, errors.New("invalid id")
	}
	var r AffRebate
	if err := DB.Where("id = ?", id).First(&r).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

// GetAffRebateByTopUpId 检查同一笔 topup 是否已发放过。
func GetAffRebateByTopUpId(topUpId int) (*AffRebate, error) {
	var r AffRebate
	err := DB.Where("top_up_id = ?", topUpId).First(&r).Error
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// CountSuccessTopUpsForUser 统计某用户成功的充值笔数（含当前已 commit 的）。
func CountSuccessTopUpsForUser(userId int) (int64, error) {
	var c int64
	err := DB.Model(&TopUp{}).Where("user_id = ? AND status = ?", userId, common.TopUpStatusSuccess).Count(&c).Error
	return c, err
}

// CreatePendingAffRebate 在事务里写入返利记录并累加 aff_pending_quota。
func CreatePendingAffRebate(rebate *AffRebate) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(rebate).Error; err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", rebate.InviterId).Update(
			"aff_pending_quota", gorm.Expr("aff_pending_quota + ?", rebate.RebateAmount),
		).Error; err != nil {
			return err
		}
		return nil
	})
}

// ListAffRebatesQuery 列表查询参数
type ListAffRebatesQuery struct {
	Status    string
	InviterId int
	InviteeId int
	StartTime int64
	EndTime   int64
}

// ListAffRebates 管理员列表。
func ListAffRebates(q ListAffRebatesQuery, page, pageSize int) (items []*AffRebate, total int64, err error) {
	if pageSize <= 0 {
		pageSize = 20
	}
	if page <= 0 {
		page = 1
	}
	tx := DB.Model(&AffRebate{})
	if q.Status != "" {
		tx = tx.Where("status = ?", q.Status)
	}
	if q.InviterId > 0 {
		tx = tx.Where("inviter_id = ?", q.InviterId)
	}
	if q.InviteeId > 0 {
		tx = tx.Where("invitee_id = ?", q.InviteeId)
	}
	if q.StartTime > 0 {
		tx = tx.Where("created_at >= ?", q.StartTime)
	}
	if q.EndTime > 0 {
		tx = tx.Where("created_at <= ?", q.EndTime)
	}
	if err = tx.Count(&total).Error; err != nil {
		return
	}
	err = tx.Order("id desc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&items).Error
	return
}

// ListInviterRebates 用户端查询自己作为邀请人的全部返利记录。
func ListInviterRebates(inviterId int, page, pageSize int) (items []*AffRebate, total int64, err error) {
	if pageSize <= 0 {
		pageSize = 20
	}
	if page <= 0 {
		page = 1
	}
	tx := DB.Model(&AffRebate{}).Where("inviter_id = ?", inviterId)
	if err = tx.Count(&total).Error; err != nil {
		return
	}
	err = tx.Order("id desc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&items).Error
	return
}

// ReleaseAffRebateById 单条到账（管理员手动 / 定时任务复用）。
// 成功则返回 true；如果状态已不是 pending（被并发抢占），返回 false。
func ReleaseAffRebateById(id int, operatorId int) (bool, error) {
	var released bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var r AffRebate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&r).Error; err != nil {
			return err
		}
		if r.Status != AffRebateStatusPending {
			return nil
		}
		now := time.Now().Unix()
		updates := map[string]interface{}{
			"status":      AffRebateStatusReleased,
			"released_at": now,
		}
		if operatorId > 0 {
			updates["operator_id"] = operatorId
		}
		if err := tx.Model(&AffRebate{}).Where("id = ?", r.Id).Updates(updates).Error; err != nil {
			return err
		}
		// 邀请人：pending -> aff_quota + aff_history
		userUpdates := map[string]interface{}{
			"aff_pending_quota": gorm.Expr("aff_pending_quota - ?", r.RebateAmount),
			"aff_quota":         gorm.Expr("aff_quota + ?", r.RebateAmount),
			"aff_history":       gorm.Expr("aff_history + ?", r.RebateAmount),
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", r.InviterId).Updates(userUpdates).Error; err != nil {
			return err
		}
		released = true
		RecordLog(r.InviterId, LogTypeAffiliateRebate, fmt.Sprintf("邀请返利 $%.2f 已到账（被邀人 #%d 首次充值 $%.2f）", r.RebateMoney, r.InviteeId, r.TopUpMoney))
		return nil
	})
	return released, err
}

// ReleaseDueAffRebates 定时任务批量到账。返回成功到账数量。
func ReleaseDueAffRebates(batch int) (int, error) {
	if batch <= 0 {
		batch = 100
	}
	var due []AffRebate
	now := time.Now().Unix()
	if err := DB.Where("status = ? AND release_at <= ?", AffRebateStatusPending, now).
		Order("id asc").Limit(batch).Find(&due).Error; err != nil {
		return 0, err
	}
	released := 0
	for _, r := range due {
		ok, err := ReleaseAffRebateById(r.Id, 0)
		if err != nil {
			common.SysError(fmt.Sprintf("release aff_rebate #%d failed: %v", r.Id, err))
			continue
		}
		if ok {
			released++
		}
	}
	return released, nil
}

// RevokeAffRebateById 管理员撤销。
// pending → 仅扣 aff_pending_quota。
// released → 优先扣 aff_quota，不足继续扣 quota（允许变负，主人决策）；同时回退 aff_history。
func RevokeAffRebateById(id int, operatorId int, reason string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var r AffRebate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&r).Error; err != nil {
			return err
		}
		if r.Status == AffRebateStatusRevoked {
			return errors.New("该返利已被撤销")
		}
		now := time.Now().Unix()

		// 找邀请人（含软删）
		var inviter User
		if err := tx.Unscoped().Where("id = ?", r.InviterId).First(&inviter).Error; err != nil {
			return err
		}

		switch r.Status {
		case AffRebateStatusPending:
			if err := tx.Unscoped().Model(&User{}).Where("id = ?", r.InviterId).Update(
				"aff_pending_quota", gorm.Expr("aff_pending_quota - ?", r.RebateAmount),
			).Error; err != nil {
				return err
			}
		case AffRebateStatusReleased:
			deductFromAff := r.RebateAmount
			if inviter.AffQuota < deductFromAff {
				deductFromAff = inviter.AffQuota
			}
			if deductFromAff < 0 {
				deductFromAff = 0
			}
			remain := r.RebateAmount - deductFromAff

			updates := map[string]interface{}{
				"aff_quota":   gorm.Expr("aff_quota - ?", deductFromAff),
				"aff_history": gorm.Expr("aff_history - ?", r.RebateAmount),
			}
			if remain > 0 {
				updates["quota"] = gorm.Expr("quota - ?", remain)
			}
			if err := tx.Unscoped().Model(&User{}).Where("id = ?", r.InviterId).Updates(updates).Error; err != nil {
				return err
			}
		default:
			return fmt.Errorf("不支持的状态: %s", r.Status)
		}

		// 更新 rebate
		updates := map[string]interface{}{
			"status":        AffRebateStatusRevoked,
			"revoked_at":    now,
			"revoke_reason": reason,
		}
		if operatorId > 0 {
			updates["operator_id"] = operatorId
		}
		if err := tx.Model(&AffRebate{}).Where("id = ?", r.Id).Updates(updates).Error; err != nil {
			return err
		}

		RecordLog(r.InviterId, LogTypeAffiliateRebate, fmt.Sprintf("邀请返利 $%.2f 已被撤销（原因：%s）", r.RebateMoney, reason))
		return nil
	})
}
