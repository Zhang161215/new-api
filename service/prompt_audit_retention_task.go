package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
)

var promptAuditRetentionOnce sync.Once

// 审核记录写入很快（线上 12,900 条/天、35MB/天且每条带完整提示词），
// 不定期清理会无限增长。这里每小时检查一次，按配置的保留天数删除过期记录。
const promptAuditRetentionTickInterval = time.Hour

// StartPromptAuditRetentionTask 启动审核记录自动清理任务。
// 仅主节点执行，避免多副本部署时重复删除。
func StartPromptAuditRetentionTask() {
	promptAuditRetentionOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(promptAuditRetentionTickInterval)
			defer ticker.Stop()

			runPromptAuditRetentionOnce()
			for range ticker.C {
				runPromptAuditRetentionOnce()
			}
		})
	})
}

func runPromptAuditRetentionOnce() {
	defer func() {
		if r := recover(); r != nil {
			logger.LogWarn(context.Background(), fmt.Sprintf("[prompt_audit] 自动清理 panic: %v", r))
		}
	}()

	cfg := operation_setting.GetPromptAuditSetting()
	if cfg == nil || cfg.RetentionDays <= 0 {
		return // 未配置保留天数即不自动清理
	}
	if model.DB == nil {
		return
	}

	cutoff := time.Now().AddDate(0, 0, -cfg.RetentionDays).Unix()
	deleted, err := model.DeletePromptAuditLogsBefore(cutoff)
	if err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("[prompt_audit] 自动清理失败: %s", err.Error()))
		return
	}
	if deleted > 0 {
		logger.LogInfo(context.Background(), fmt.Sprintf("[prompt_audit] 自动清理完成：删除 %d 条 %d 天前的记录", deleted, cfg.RetentionDays))
	}
}
