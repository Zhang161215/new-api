package model

import (
	"time"
)

// PromptAuditLog 提示词安全审核事件记录。
// 完整提示词入库仅供管理员复核，普通用户端不暴露任何查询入口。
type PromptAuditLog struct {
	Id         int     `json:"id"`
	CreatedAt  int64   `json:"created_at" gorm:"bigint;index"`
	UserId     int     `json:"user_id" gorm:"index"`
	Username   string  `json:"username" gorm:"index;default:''"`
	TokenName  string  `json:"token_name"`
	Group      string  `json:"group" gorm:"index;default:''"`
	ModelName  string  `json:"model_name" gorm:"index"`
	ChannelId  int     `json:"channel_id"`
	Endpoint   string  `json:"endpoint"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
	// Blocked 是否实际拦截（影子模式下命中但未拦截为 false）
	Blocked bool `json:"blocked" gorm:"index"`
	// AuditModel 作出判定的审核模型
	AuditModel string `json:"audit_model"`
	// Prompt 送审的完整用户输入（管理员复核用）
	Prompt string `json:"prompt" gorm:"type:text"`
	// LatencyMs 审核耗时
	LatencyMs int    `json:"latency_ms"`
	Ip        string `json:"ip"`
}

// RecordPromptAuditLog 写入一条审核命中记录
func RecordPromptAuditLog(log *PromptAuditLog) error {
	if log.CreatedAt == 0 {
		log.CreatedAt = time.Now().Unix()
	}
	return DB.Create(log).Error
}

// GetPromptAuditLogs 分页查询审核记录。blocked 为 nil 时不按拦截状态过滤。
func GetPromptAuditLogs(startTimestamp, endTimestamp int64, username, modelName, group string,
	blocked *bool, startIdx, num int) (logs []*PromptAuditLog, total int64, err error) {

	tx := DB.Model(&PromptAuditLog{})
	if startTimestamp > 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	if group != "" {
		tx = tx.Where("\"group\" = ?", group)
	}
	if blocked != nil {
		tx = tx.Where("blocked = ?", *blocked)
	}
	if err = tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if num <= 0 {
		num = 20
	}
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	return logs, total, err
}

// PromptAuditStat 审核统计（用于后台展示命中比例）
type PromptAuditStat struct {
	// Total 命中记录总数
	Total int64 `json:"total"`
	// Blocked 实际拦截数
	Blocked int64 `json:"blocked"`
	// Shadow 影子命中数（未拦截）
	Shadow int64 `json:"shadow"`
	// Last24h 近 24 小时命中数
	Last24h int64 `json:"last_24h"`
	// Last7d 近 7 天命中数
	Last7d int64 `json:"last_7d"`
	// TopModels 命中最多的业务模型
	TopModels []PromptAuditModelStat `json:"top_models"`
	// TopUsers 命中最多的用户
	TopUsers []PromptAuditUserStat `json:"top_users"`
	// 判定缓存命中情况（本进程自启动以来累计），用于观察去重实际省下多少次审核调用
	CacheHit     int64   `json:"cache_hit"`
	CacheMiss    int64   `json:"cache_miss"`
	CacheHitRate float64 `json:"cache_hit_rate"`
	// Failed 审核未完成的记录数（confidence < 0）。fail-open 时这些请求未经审核即放行，
	// 是真实的漏审量；与「审过且合规」必须分开统计，否则会高估审核覆盖率
	Failed int64 `json:"failed"`
	// FailedLast24h 近 24 小时的未完成数，用于判断当前审核链路是否在持续异常
	FailedLast24h int64 `json:"failed_last_24h"`
}

// PromptAuditFailureConfidence 审核未完成记录的置信度哨兵值（与 middleware 保持一致）
const PromptAuditFailureConfidence = -1

type PromptAuditModelStat struct {
	ModelName string `json:"model_name"`
	Count     int64  `json:"count"`
}

type PromptAuditUserStat struct {
	Username string `json:"username"`
	Count    int64  `json:"count"`
}

// GetPromptAuditStat 汇总审核命中统计
func GetPromptAuditStat() (*PromptAuditStat, error) {
	stat := &PromptAuditStat{}
	if err := DB.Model(&PromptAuditLog{}).Count(&stat.Total).Error; err != nil {
		return nil, err
	}
	// 未判定记录（审核链路失败）单独统计，不计入命中/拦截口径
	if err := DB.Model(&PromptAuditLog{}).
		Where("confidence < ?", 0).Count(&stat.Failed).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&PromptAuditLog{}).
		Where("blocked = ? AND confidence >= ?", true, 0).
		Count(&stat.Blocked).Error; err != nil {
		return nil, err
	}
	stat.Shadow = stat.Total - stat.Blocked - stat.Failed

	now := time.Now().Unix()
	if err := DB.Model(&PromptAuditLog{}).
		Where("confidence < ? AND created_at >= ?", 0, now-24*3600).
		Count(&stat.FailedLast24h).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&PromptAuditLog{}).Where("created_at >= ?", now-24*3600).Count(&stat.Last24h).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&PromptAuditLog{}).Where("created_at >= ?", now-7*24*3600).Count(&stat.Last7d).Error; err != nil {
		return nil, err
	}

	if err := DB.Model(&PromptAuditLog{}).
		Select("model_name, count(*) as count").
		Group("model_name").Order("count desc").Limit(5).
		Scan(&stat.TopModels).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&PromptAuditLog{}).
		Select("username, count(*) as count").
		Group("username").Order("count desc").Limit(5).
		Scan(&stat.TopUsers).Error; err != nil {
		return nil, err
	}
	return stat, nil
}

// DeletePromptAuditLogsBefore 清理指定时间戳之前的记录，返回删除条数
func DeletePromptAuditLogsBefore(timestamp int64) (int64, error) {
	tx := DB.Where("created_at < ?", timestamp).Delete(&PromptAuditLog{})
	if tx.Error != nil {
		return 0, tx.Error
	}
	return tx.RowsAffected, nil
}

// CountPromptAuditHitsInWindow 统计某用户在时间窗口内被拦截且置信度达标的命中次数。
//
// 用数据库而非内存计数：内存计数在进程重启后归零，用户只要卡着重启时间点就能绕过封号；
// 而且多实例部署时内存计数各算各的，阈值实际被放大 N 倍。
// blocked 与 confidence 双条件保证只统计"真的被拦下来的高置信度命中"，
// 观察模式下的命中、以及审核失败记录（confidence 为负）都不会计入。
func CountPromptAuditHitsInWindow(userId int, since int64, minConfidence float64) (int64, error) {
	var count int64
	err := DB.Model(&PromptAuditLog{}).
		Where("user_id = ? AND created_at >= ? AND blocked = ? AND confidence >= ?",
			userId, since, true, minConfidence).
		Count(&count).Error
	return count, err
}
