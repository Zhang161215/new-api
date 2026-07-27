package service

import (
	"context"
	"fmt"
	"html"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// 审核失败（fail-open 漏审 / fail-closed 拒绝）的可观测性支持。
//
// 背景：线上曾出现 20 小时内 15 次 fail-open，另有数百条审核输出解析失败，
// 这些请求实际上没有被审核，但当时只打了一行 WARN 日志——既不落库也不告警，
// 事后无法统计漏审规模。这里补上计数器与限频告警。

const NotifyTypePromptAuditFailure = "prompt_audit_failure"

// PromptAuditFailureEvent 一次审核失败的上下文
type PromptAuditFailureEvent struct {
	UserId    int
	Username  string
	Group     string
	ModelName string
	Endpoint  string
	Ip        string
	Error     string
	FailOpen  bool
	LatencyMs int
	CreatedAt time.Time
}

// promptAuditFailureTotal 进程内累计失败次数，供后台统计展示
var promptAuditFailureTotal atomic.Int64

// promptAuditFailureNotifyCooldown 全局告警冷却（非按用户）：
// 审核节点抖动会让所有用户同时失败，按用户冷却挡不住邮件风暴
const promptAuditFailureNotifyCooldown = 10 * time.Minute

var (
	promptAuditFailureNotifyMu   sync.Mutex
	promptAuditFailureNotifyLast time.Time
	// 冷却窗口内被抑制的失败数，随下一封告警一起报出，避免管理员低估故障规模
	promptAuditFailureSuppressed int64
)

// RecordPromptAuditFailure 累加一次审核失败计数
func RecordPromptAuditFailure() {
	promptAuditFailureTotal.Add(1)
}

// GetPromptAuditFailureCount 返回本进程累计的审核失败次数
func GetPromptAuditFailureCount() int64 {
	return promptAuditFailureTotal.Load()
}

// ResetPromptAuditFailureCount 清零计数（仅测试用）
func ResetPromptAuditFailureCount() {
	promptAuditFailureTotal.Store(0)
	promptAuditFailureNotifyMu.Lock()
	promptAuditFailureNotifyLast = time.Time{}
	promptAuditFailureSuppressed = 0
	promptAuditFailureNotifyMu.Unlock()
}

// promptAuditFailureNotifyAllowed 判断本次是否可以发告警，并取回被抑制的条数
func promptAuditFailureNotifyAllowed() (bool, int64) {
	promptAuditFailureNotifyMu.Lock()
	defer promptAuditFailureNotifyMu.Unlock()
	now := time.Now()
	if !promptAuditFailureNotifyLast.IsZero() &&
		now.Sub(promptAuditFailureNotifyLast) < promptAuditFailureNotifyCooldown {
		promptAuditFailureSuppressed++
		return false, 0
	}
	suppressed := promptAuditFailureSuppressed
	promptAuditFailureSuppressed = 0
	promptAuditFailureNotifyLast = now
	return true, suppressed
}

// NotifyPromptAuditFailure 审核链路失败时告警管理员。
// 复用命中告警的收件配置（NotifyEmail 优先，否则走 root 用户通知渠道）。
func NotifyPromptAuditFailure(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	event PromptAuditFailureEvent) {

	defer func() {
		if r := recover(); r != nil {
			common.SysLog(fmt.Sprintf("[prompt_audit] 发送审核失败告警 panic: %v", r))
		}
	}()
	if cfg == nil || !cfg.NotifyEnabled {
		return
	}
	allowed, suppressed := promptAuditFailureNotifyAllowed()
	if !allowed {
		return
	}

	subject := "[内容审核] 审核链路异常"
	if cfg.FailOpen {
		subject += "（请求已放行，存在漏审）"
	} else {
		subject += "（请求已拒绝）"
	}

	content := promptAuditFailureHTML(cfg, event, suppressed)
	if list := cfg.NotifyEmailList(); len(list) > 0 {
		for _, to := range list {
			if err := common.SendEmail(subject, to, content); err != nil {
				common.SysLog(fmt.Sprintf("[prompt_audit] 审核失败告警邮件发送失败 to=%s: %s", to, err.Error()))
			}
		}
		return
	}
	NotifyRootUser(NotifyTypePromptAuditFailure, subject, content)
}

func promptAuditFailureHTML(cfg *operation_setting.PromptAuditSetting,
	event PromptAuditFailureEvent, suppressed int64) string {

	disposition := "已放行（fail-open）——该请求未经审核即送达上游"
	if !event.FailOpen {
		disposition = "已拒绝（fail-closed）"
	}
	rows := [][2]string{
		{"处置", disposition},
		{"失败原因", event.Error},
		{"审核模型", cfg.Model},
		{"用户", fmt.Sprintf("%s (ID %d)", event.Username, event.UserId)},
		{"分组", event.Group},
		{"业务模型", event.ModelName},
		{"端点", event.Endpoint},
		{"IP", event.Ip},
		{"耗时", fmt.Sprintf("%d ms", event.LatencyMs)},
		{"时间", event.CreatedAt.Format("2006-01-02 15:04:05")},
		{"本进程累计失败", fmt.Sprintf("%d 次", GetPromptAuditFailureCount())},
	}
	if suppressed > 0 {
		rows = append(rows, [2]string{"冷却期内被抑制",
			fmt.Sprintf("%d 次（同类失败，未逐条告警）", suppressed)})
	}

	var b strings.Builder
	b.WriteString(`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6">`)
	b.WriteString(`<p><strong>内容安全审核链路出现异常，请检查审核节点可用性。</strong></p>`)
	b.WriteString(`<table style="border-collapse:collapse">`)
	for _, r := range rows {
		b.WriteString(`<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">`)
		b.WriteString(html.EscapeString(r[0]))
		b.WriteString(`</td><td style="padding:4px 0">`)
		b.WriteString(html.EscapeString(r[1]))
		b.WriteString(`</td></tr>`)
	}
	b.WriteString(`</table>`)
	b.WriteString(`<p style="color:#888;font-size:12px">告警已限频，同类失败 `)
	b.WriteString(promptAuditFailureNotifyCooldown.String())
	b.WriteString(` 内只发一封。审核失败的请求在后台记录中置信度为 -1，可据此筛出漏审内容。</p>`)
	b.WriteString(`</div>`)
	return b.String()
}
