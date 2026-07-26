package service

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func sampleNotifyEvent() PromptAuditNotifyEvent {
	return PromptAuditNotifyEvent{
		UserId:     7,
		Username:   "alice",
		TokenName:  "codex-cli",
		Group:      "Codex_GPT_PRO",
		ModelName:  "gpt-5-codex",
		Endpoint:   "/v1/chat/completions",
		Ip:         "1.2.3.4",
		AuditModel: "deepseek-v4-flash",
		Confidence: 0.95,
		Reason:     "请求编写 SSH 爆破脚本",
		Blocked:    true,
		Prompt:     "用 hydra 爆破 1.2.3.4 的 ssh",
		LatencyMs:  1053,
		CreatedAt:  time.Date(2026, 7, 26, 10, 30, 0, 0, time.Local),
	}
}

func TestPromptAuditNotifySubject(t *testing.T) {
	ev := sampleNotifyEvent()
	subject := promptAuditNotifySubject(ev)
	require.Contains(t, subject, "已拦截")
	require.Contains(t, subject, "alice")
	require.Contains(t, subject, "0.95")

	// 观察模式要能从标题看出没拦
	ev.Blocked = false
	require.Contains(t, promptAuditNotifySubject(ev), "未拦截")

	// 没有用户名时回落到 #id，不能出现空的「用户 」
	ev.Username = ""
	require.Contains(t, promptAuditNotifySubject(ev), "#7")
}

func TestPromptAuditNotifyTextIncludesKeyFacts(t *testing.T) {
	body := promptAuditNotifyText(sampleNotifyEvent())
	for _, want := range []string{
		"alice", "codex-cli", "Codex_GPT_PRO", "gpt-5-codex",
		"/v1/chat/completions", "1.2.3.4", "deepseek-v4-flash",
		"0.95", "SSH 爆破", "hydra",
	} {
		require.Contains(t, body, want)
	}
}

func TestPromptAuditNotifyTextSkipsEmptyFields(t *testing.T) {
	ev := sampleNotifyEvent()
	ev.Group = ""
	ev.Ip = ""
	body := promptAuditNotifyText(ev)
	// 空字段整行省略，不能留「分组：」这种空标签
	require.NotContains(t, body, "分组：")
	require.NotContains(t, body, "来源 IP：")
}

func TestPromptAuditNotifyHTMLEscapesPrompt(t *testing.T) {
	ev := sampleNotifyEvent()
	// 提示词是不可信输入，直接拼进 HTML 邮件会被当标签解析
	ev.Prompt = `<img src=x onerror="alert(1)">`
	ev.Reason = `<b>注入</b>`
	body := promptAuditNotifyHTML(ev)
	// 关键是尖括号与引号都被转义，构不成标签；转义后的字面量出现是正常的
	require.NotContains(t, body, "<img")
	require.NotContains(t, body, `onerror="`)
	require.NotContains(t, body, "<b>注入</b>")
	require.Contains(t, body, "&lt;img")
	require.Contains(t, body, "&lt;b&gt;注入")
}

func TestPromptAuditNotifyTruncatesLongPrompt(t *testing.T) {
	ev := sampleNotifyEvent()
	ev.Prompt = strings.Repeat("中", 5000)
	body := promptAuditNotifyText(ev)
	// 超长提示词必须截断，否则一封邮件能塞进整个上下文
	require.Less(t, strings.Count(body, "中"), promptAuditNotifyPromptChars+1)
}

func TestPromptAuditNotifyCooldown(t *testing.T) {
	promptAuditNotifyCooldown.Delete(4242)

	// 冷却为 0 表示不限制，连续多次都放行
	for i := 0; i < 3; i++ {
		require.True(t, promptAuditNotifyAllowed(4242, 0))
	}

	// 首次放行，冷却期内的后续调用被挡住
	require.True(t, promptAuditNotifyAllowed(4242, time.Minute))
	require.False(t, promptAuditNotifyAllowed(4242, time.Minute))

	// 不同用户互不影响
	require.True(t, promptAuditNotifyAllowed(4243, time.Minute))

	// 极短冷却过后应重新放行
	promptAuditNotifyCooldown.Delete(4244)
	require.True(t, promptAuditNotifyAllowed(4244, time.Millisecond))
	time.Sleep(5 * time.Millisecond)
	require.True(t, promptAuditNotifyAllowed(4244, time.Millisecond))
}
