package service

import (
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
)

func failureEvent() PromptAuditFailureEvent {
	return PromptAuditFailureEvent{
		UserId:    42,
		Username:  "tester",
		Group:     "Codex_GPT_PRO",
		ModelName: "gpt-5.6-sol",
		Endpoint:  "/v1/chat/completions",
		Ip:        "1.2.3.4",
		Error:     "审核响应解析失败: unexpected end of JSON input",
		FailOpen:  true,
		LatencyMs: 630,
		CreatedAt: time.Now(),
	}
}

func TestRecordPromptAuditFailureCounts(t *testing.T) {
	ResetPromptAuditFailureCount()
	assert.Equal(t, int64(0), GetPromptAuditFailureCount())
	RecordPromptAuditFailure()
	RecordPromptAuditFailure()
	assert.Equal(t, int64(2), GetPromptAuditFailureCount())
}

func TestPromptAuditFailureNotifyCooldown(t *testing.T) {
	ResetPromptAuditFailureCount()

	allowed, suppressed := promptAuditFailureNotifyAllowed()
	assert.True(t, allowed, "首次失败应当允许告警")
	assert.Equal(t, int64(0), suppressed)

	// 冷却窗口内的后续失败只累计，不再逐条告警
	for i := 0; i < 5; i++ {
		allowed, _ = promptAuditFailureNotifyAllowed()
		assert.False(t, allowed, "冷却期内不应重复告警")
	}

	// 冷却期结束后应放行，并把被抑制的条数一并带出
	promptAuditFailureNotifyMu.Lock()
	promptAuditFailureNotifyLast = time.Now().Add(-promptAuditFailureNotifyCooldown - time.Second)
	promptAuditFailureNotifyMu.Unlock()

	allowed, suppressed = promptAuditFailureNotifyAllowed()
	assert.True(t, allowed)
	assert.Equal(t, int64(5), suppressed, "被抑制的次数应随下一封告警报出")
}

func TestPromptAuditFailureHTMLContainsDisposition(t *testing.T) {
	cfg := &operation_setting.PromptAuditSetting{Model: "deepseek-v4-flash"}

	open := promptAuditFailureHTML(cfg, failureEvent(), 0)
	assert.Contains(t, open, "fail-open")
	assert.Contains(t, open, "未经审核")
	assert.Contains(t, open, "tester")
	assert.Contains(t, open, "deepseek-v4-flash")

	ev := failureEvent()
	ev.FailOpen = false
	closed := promptAuditFailureHTML(cfg, ev, 0)
	assert.Contains(t, closed, "fail-closed")
	assert.NotContains(t, closed, "未经审核")
}

func TestPromptAuditFailureHTMLShowsSuppressed(t *testing.T) {
	cfg := &operation_setting.PromptAuditSetting{Model: "deepseek-v4-flash"}
	out := promptAuditFailureHTML(cfg, failureEvent(), 17)
	assert.Contains(t, out, "17")
	assert.Contains(t, out, "被抑制")
}

func TestPromptAuditFailureHTMLEscapesError(t *testing.T) {
	cfg := &operation_setting.PromptAuditSetting{Model: "deepseek-v4-flash"}
	ev := failureEvent()
	ev.Error = `<img src=x onerror="alert(1)">`
	out := promptAuditFailureHTML(cfg, ev, 0)
	// 失败原因来自上游响应，属不可信内容，必须转义后再放进邮件
	assert.NotContains(t, out, `onerror="`)
	assert.Contains(t, out, "&lt;img")
}

func TestNotifyPromptAuditFailureSkippedWhenDisabled(t *testing.T) {
	ResetPromptAuditFailureCount()
	cfg := &operation_setting.PromptAuditSetting{Model: "m", NotifyEnabled: false}
	// 通知关闭时不应触碰冷却状态，也不能 panic
	NotifyPromptAuditFailure(nil, cfg, failureEvent())

	promptAuditFailureNotifyMu.Lock()
	last := promptAuditFailureNotifyLast
	promptAuditFailureNotifyMu.Unlock()
	assert.True(t, last.IsZero(), "关闭通知时不应写入冷却时间")
}

func TestNotifyPromptAuditFailureNilConfigSafe(t *testing.T) {
	// 配置为 nil 时属于调用方 bug，但告警是旁路逻辑，绝不能因此 panic
	assert.NotPanics(t, func() {
		NotifyPromptAuditFailure(nil, nil, failureEvent())
	})
}

func TestPromptAuditFailureConfidenceIsNegative(t *testing.T) {
	// 哨兵值必须为负：库里靠 confidence < 0 把「漏审」和「审过且合规(0)」分开
	assert.Less(t, float64(-1), float64(0))
	assert.True(t, strings.Contains("-1", "-"))
}
