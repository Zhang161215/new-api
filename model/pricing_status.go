// Package model — 模型广场可用性状态（日志版 v1）
//
// 依据真实用量日志（logs 表）按模型聚合最近 24h 的：
//   - 可用率  availability = success/(success+failure)*100
//   - 延迟    latency      = AVG(use_time)（仅成功且 use_time>0）
//   - 吞吐    throughput   = SUM(completion_tokens)/SUM(use_time)（仅成功且 use_time>0）
//   - 24 格   每小时一桶的可用率颜色状态
//
// 纯只读查询 + 60s 内存缓存，不触碰计费/下发/pricing 缓存。
package model

import (
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 桶颜色状态
const (
	statusBucketNoData = 0 // 灰：无数据
	statusBucketGreen  = 1 // 绿：可用率 >= 99%
	statusBucketYellow = 2 // 黄：可用率 >= 90%
	statusBucketRed    = 3 // 红：可用率 < 90%
)

const (
	statusWindowSeconds = int64(24 * 3600) // 统计窗口 24h
	statusBucketCount    = 24              // 24 格
	statusCacheTTL       = time.Minute     // 内存缓存 60s
)

// ModelStatus 单个模型的状态快照（前端卡片直接消费）。
type ModelStatus struct {
	Availability float64 `json:"availability"` // 0~100
	Latency      float64 `json:"latency"`      // 平均秒
	Throughput   float64 `json:"throughput"`   // tokens/s
	Buckets      []int   `json:"buckets"`      // 长度 24，0=无数据 1=绿 2=黄 3=红（旧→新）
	HasData      bool    `json:"has_data"`
}

var (
	modelStatusCache     map[string]ModelStatus
	modelStatusCacheTime time.Time
	modelStatusLock      sync.RWMutex
)

// hourBucketExpr 返回按小时分桶的 SQL 表达式（跨库兼容）。
func hourBucketExpr() string {
	if common.UsingMySQL {
		return "created_at DIV 3600"
	}
	// PostgreSQL / SQLite：整数除法
	return "created_at / 3600"
}

// GetModelStatuses 返回所有模型的状态映射（model_name -> ModelStatus），带 60s 缓存。
func GetModelStatuses() map[string]ModelStatus {
	modelStatusLock.RLock()
	if modelStatusCache != nil && time.Since(modelStatusCacheTime) < statusCacheTTL {
		cached := modelStatusCache
		modelStatusLock.RUnlock()
		return cached
	}
	modelStatusLock.RUnlock()

	modelStatusLock.Lock()
	defer modelStatusLock.Unlock()
	// double check
	if modelStatusCache != nil && time.Since(modelStatusCacheTime) < statusCacheTTL {
		return modelStatusCache
	}

	result, err := computeModelStatuses()
	if err != nil {
		common.SysError(fmt.Sprintf("computeModelStatuses error: %v", err))
		// 出错时返回旧缓存（若有）或空 map，绝不影响主流程
		if modelStatusCache != nil {
			return modelStatusCache
		}
		return map[string]ModelStatus{}
	}
	modelStatusCache = result
	modelStatusCacheTime = time.Now()
	return result
}

// computeModelStatuses 执行两条聚合查询并组装结果。
func computeModelStatuses() (map[string]ModelStatus, error) {
	now := time.Now().Unix()
	since := now - statusWindowSeconds

	// ---- 查询 1：按模型的汇总 ----
	type summaryRow struct {
		ModelName       string  `gorm:"column:model_name"`
		Success         int64   `gorm:"column:success"`
		Failure         int64   `gorm:"column:failure"`
		TotalUseTime    int64   `gorm:"column:total_use_time"`
		TotalCompletion int64   `gorm:"column:total_completion"`
		SuccessWithTime int64   `gorm:"column:success_with_time"`
	}
	var summaries []summaryRow
	summarySelect := fmt.Sprintf(
		"model_name, "+
			"COALESCE(SUM(CASE WHEN type = %d THEN 1 ELSE 0 END), 0) AS success, "+
			"COALESCE(SUM(CASE WHEN type = %d THEN 1 ELSE 0 END), 0) AS failure, "+
			"COALESCE(SUM(CASE WHEN type = %d AND use_time > 0 THEN use_time ELSE 0 END), 0) AS total_use_time, "+
			"COALESCE(SUM(CASE WHEN type = %d AND use_time > 0 THEN completion_tokens ELSE 0 END), 0) AS total_completion, "+
			"COALESCE(SUM(CASE WHEN type = %d AND use_time > 0 THEN 1 ELSE 0 END), 0) AS success_with_time",
		LogTypeConsume, LogTypeError, LogTypeConsume, LogTypeConsume, LogTypeConsume,
	)
	err := LOG_DB.Table("logs").
		Select(summarySelect).
		Where("type IN (?) AND created_at >= ?", []int{LogTypeConsume, LogTypeError}, since).
		Group("model_name").
		Scan(&summaries).Error
	if err != nil {
		return nil, err
	}

	// ---- 查询 2：按模型 + 小时桶 ----
	type bucketRow struct {
		ModelName string `gorm:"column:model_name"`
		Bucket    int64  `gorm:"column:bucket"`
		Success   int64  `gorm:"column:success"`
		Failure   int64  `gorm:"column:failure"`
	}
	var buckets []bucketRow
	bucketExpr := hourBucketExpr()
	bucketSelect := fmt.Sprintf(
		"model_name, %s AS bucket, "+
			"COALESCE(SUM(CASE WHEN type = %d THEN 1 ELSE 0 END), 0) AS success, "+
			"COALESCE(SUM(CASE WHEN type = %d THEN 1 ELSE 0 END), 0) AS failure",
		bucketExpr, LogTypeConsume, LogTypeError,
	)
	err = LOG_DB.Table("logs").
		Select(bucketSelect).
		Where("type IN (?) AND created_at >= ?", []int{LogTypeConsume, LogTypeError}, since).
		Group("model_name, " + bucketExpr).
		Scan(&buckets).Error
	if err != nil {
		return nil, err
	}

	// 当前小时桶编号；索引 = statusBucketCount-1 - (currentBucket - bucket)
	currentBucket := now / 3600

	// 先把桶按模型归档
	bucketsByModel := make(map[string][]int) // 每模型 24 长度切片
	ensure := func(m string) []int {
		if _, ok := bucketsByModel[m]; !ok {
			bucketsByModel[m] = make([]int, statusBucketCount)
		}
		return bucketsByModel[m]
	}
	for _, b := range buckets {
		idx := statusBucketCount - 1 - int(currentBucket-b.Bucket)
		if idx < 0 || idx >= statusBucketCount {
			continue
		}
		arr := ensure(b.ModelName)
		arr[idx] = bucketColor(b.Success, b.Failure)
	}

	// 组装最终结果
	result := make(map[string]ModelStatus, len(summaries))
	for _, s := range summaries {
		total := s.Success + s.Failure
		st := ModelStatus{
			Buckets: ensure(s.ModelName),
			HasData: total > 0,
		}
		if total > 0 {
			st.Availability = float64(s.Success) / float64(total) * 100
		}
		if s.SuccessWithTime > 0 {
			st.Latency = float64(s.TotalUseTime) / float64(s.SuccessWithTime)
		}
		if s.TotalUseTime > 0 {
			st.Throughput = float64(s.TotalCompletion) / float64(s.TotalUseTime)
		}
		result[s.ModelName] = st
	}
	return result, nil
}

// bucketColor 根据单桶成功/失败数返回颜色状态。
func bucketColor(success, failure int64) int {
	total := success + failure
	if total == 0 {
		return statusBucketNoData
	}
	avail := float64(success) / float64(total) * 100
	switch {
	case avail >= 99:
		return statusBucketGreen
	case avail >= 90:
		return statusBucketYellow
	default:
		return statusBucketRed
	}
}
