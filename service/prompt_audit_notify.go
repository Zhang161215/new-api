package service

import (
	"context"
	"fmt"
	"html"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// NotifyTypePromptAudit 用于站内通知频率限制的类型标识
const NotifyTypePromptAudit = "prompt_audit"

// PromptAuditNotifyEvent 一次命中告警所需的信息快照
type PromptAuditNotifyEvent struct {
	UserId     int
	Username   string
	TokenName  string
	Group      string
	ModelName  string
	Endpoint   string
	Ip         string
	AuditModel string
	Confidence float64
	Reason     string
	Blocked    bool
	Prompt     string
	LatencyMs  int
	CreatedAt  time.Time
}

// 通知正文里附带的提示词摘要长度：够管理员判断是不是误判，又不至于把邮件塞爆
const promptAuditNotifyPromptChars = 800

// 无 Redis 时的进程内冷却表（生产为单实例部署，够用）
var promptAuditNotifyCooldown sync.Map // key: userId -> time.Time

// promptAuditNotifyAllowed 判断该用户此刻是否还在冷却期内。
// 冷却是为了防止一个用户连续触发把邮箱刷爆，不是安全边界，故失败一律放行。
func promptAuditNotifyAllowed(userId int, cooldown time.Duration) bool {
	if cooldown <= 0 {
		return true
	}
	if promptAuditRedisReady() {
		key := fmt.Sprintf("prompt_audit_notify:%d", userId)
		if v, err := common.RedisGet(key); err == nil && v != "" {
			return false
		}
		// 出错也照常发，宁可多发一封也别漏掉告警
		_ = common.RedisSet(key, "1", cooldown)
		return true
	}
	now := time.Now()
	if v, ok := promptAuditNotifyCooldown.Load(userId); ok {
		if last, ok2 := v.(time.Time); ok2 && now.Sub(last) < cooldown {
			return false
		}
	}
	promptAuditNotifyCooldown.Store(userId, now)
	return true
}

// NotifyPromptAuditHit 命中违规时给管理员发告警。
// 与写记录一样属于旁路行为：任何失败（含 panic）都只记日志，绝不影响用户请求。
func NotifyPromptAuditHit(ctx context.Context, cfg *operation_setting.PromptAuditSetting, ev PromptAuditNotifyEvent) {
	defer func() {
		if r := recover(); r != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 发送告警通知 panic: %v", r))
		}
	}()
	if cfg == nil || !cfg.ShouldNotify(ev.Confidence, ev.Blocked) {
		return
	}
	if !promptAuditNotifyAllowed(ev.UserId, time.Duration(cfg.NotifyCooldownSec)*time.Second) {
		return
	}

	subject := promptAuditNotifySubject(ev)
	// 额外邮箱：直接走 SMTP，不受站内「通知方式」设置影响（管理员填了就是想收邮件）
	if mails := cfg.NotifyEmailList(); len(mails) > 0 {
		body := promptAuditNotifyHTML(ev)
		for _, mail := range mails {
			if err := common.SendEmail(subject, mail, body); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 告警邮件发送失败 to=%s: %s", mail, err.Error()))
			}
		}
		return
	}
	// 未填额外邮箱则复用 root 用户配置的通知渠道（邮件/Webhook/Bark/Gotify）
	NotifyRootUser(NotifyTypePromptAudit, subject, promptAuditNotifyText(ev))
}

func promptAuditNotifySubject(ev PromptAuditNotifyEvent) string {
	action := "命中告警（未拦截）"
	if ev.Blocked {
		action = "已拦截"
	}
	who := ev.Username
	if who == "" {
		who = fmt.Sprintf("#%d", ev.UserId)
	}
	return fmt.Sprintf("[提示词审核] %s：用户 %s 置信度 %.2f", action, who, ev.Confidence)
}

// promptAuditNotifyFields 通知正文里展示的字段，邮件与文本两种格式共用同一份顺序
func promptAuditNotifyFields(ev PromptAuditNotifyEvent) [][2]string {
	ts := ev.CreatedAt
	if ts.IsZero() {
		ts = time.Now()
	}
	disposal := "命中但未拦截（观察模式）"
	if ev.Blocked {
		disposal = "已拦截，请求未到达上游"
	}
	return [][2]string{
		{"时间", ts.Format("2006-01-02 15:04:05")},
		{"处置", disposal},
		{"置信度", fmt.Sprintf("%.2f", ev.Confidence)},
		{"判定理由", ev.Reason},
		{"用户", fmt.Sprintf("%s (#%d)", ev.Username, ev.UserId)},
		{"令牌", ev.TokenName},
		{"分组", ev.Group},
		{"请求模型", ev.ModelName},
		{"端点", ev.Endpoint},
		{"来源 IP", ev.Ip},
		{"审核模型", fmt.Sprintf("%s（耗时 %dms）", ev.AuditModel, ev.LatencyMs)},
	}
}

func promptAuditNotifyText(ev PromptAuditNotifyEvent) string {
	var sb strings.Builder
	for _, f := range promptAuditNotifyFields(ev) {
		if f[1] == "" {
			continue
		}
		sb.WriteString(f[0])
		sb.WriteString("：")
		sb.WriteString(f[1])
		sb.WriteString("\n")
	}
	sb.WriteString("\n提示词摘要：\n")
	sb.WriteString(TruncateRunes(strings.TrimSpace(ev.Prompt), promptAuditNotifyPromptChars))
	sb.WriteString("\n\n完整记录见后台「提示词审核 - 审核记录」。")
	return sb.String()
}

func promptAuditNotifyHTML(ev PromptAuditNotifyEvent) string {
	var sb strings.Builder
	sb.WriteString(`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#1c1f23;line-height:1.7">`)
	sb.WriteString(`<p style="margin:0 0 12px">`)
	sb.WriteString(html.EscapeString(promptAuditNotifySubject(ev)))
	sb.WriteString(`</p><table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">`)
	for _, f := range promptAuditNotifyFields(ev) {
		if f[1] == "" {
			continue
		}
		sb.WriteString(`<tr><td style="color:#6b7280;white-space:nowrap;vertical-align:top">`)
		sb.WriteString(html.EscapeString(f[0]))
		sb.WriteString(`</td><td style="vertical-align:top">`)
		sb.WriteString(html.EscapeString(f[1]))
		sb.WriteString(`</td></tr>`)
	}
	sb.WriteString(`</table><p style="margin:16px 0 6px;color:#6b7280">提示词摘要</p>`)
	// 提示词是不可信的用户输入，必须转义后再放进 HTML 邮件，避免注入
	sb.WriteString(`<pre style="margin:0;padding:12px;background:#f5f6f7;border-radius:6px;white-space:pre-wrap;word-break:break-word;font-size:12px">`)
	sb.WriteString(html.EscapeString(TruncateRunes(strings.TrimSpace(ev.Prompt), promptAuditNotifyPromptChars)))
	sb.WriteString(`</pre>`)
	sb.WriteString(`<p style="margin:16px 0 0;color:#6b7280;font-size:12px">完整记录见后台「提示词审核 - 审核记录」。</p></div>`)
	return sb.String()
}

// lookupPromptAuditUserEmail 读取用户绑定邮箱。测试可替换。没有邮箱或查不到就返回空。
var lookupPromptAuditUserEmail = defaultLookupPromptAuditUserEmail

func defaultLookupPromptAuditUserEmail(userId int) string {
	if userId <= 0 || model.DB == nil {
		return ""
	}
	user, err := model.GetUserById(userId, false)
	if err != nil || user == nil {
		return ""
	}
	email := strings.TrimSpace(user.Email)
	if email == "" {
		email = strings.TrimSpace(user.GetSetting().NotificationEmail)
	}
	return email
}

func promptAuditUserNotifyAllowed(userId int, cooldown time.Duration) bool {
	if cooldown <= 0 {
		return true
	}
	if promptAuditRedisReady() {
		key := fmt.Sprintf("prompt_audit_user_notify:%d", userId)
		if v, err := common.RedisGet(key); err == nil && v != "" {
			return false
		}
		_ = common.RedisSet(key, "1", cooldown)
		return true
	}
	now := time.Now()
	if v, ok := promptAuditUserNotifyCooldown.Load(userId); ok {
		if last, ok2 := v.(time.Time); ok2 && now.Sub(last) < cooldown {
			return false
		}
	}
	promptAuditUserNotifyCooldown.Store(userId, now)
	return true
}

var promptAuditUserNotifyCooldown sync.Map

func plausibleEmail(addr string) bool {
	addr = strings.TrimSpace(addr)
	if addr == "" || strings.ContainsAny(addr, " \t\r\n") {
		return false
	}
	at := strings.IndexByte(addr, '@')
	if at <= 0 || at != strings.LastIndexByte(addr, '@') {
		return false
	}
	return at < len(addr)-1
}

// NotifyPromptAuditUser 拦截后给用户自己发邮件。没有绑定邮箱就跳过。
// 与管理员告警独立：管理员关了告警，用户仍能收到。旁路行为，失败不影响请求。
func NotifyPromptAuditUser(ctx context.Context, cfg *operation_setting.PromptAuditSetting, ev PromptAuditNotifyEvent) {
	defer func() {
		if r := recover(); r != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 用户拦截通知 panic: %v", r))
		}
	}()
	if cfg == nil || !cfg.ShouldNotifyUser(ev.Blocked) {
		return
	}
	email := lookupPromptAuditUserEmail(ev.UserId)
	if !plausibleEmail(email) {
		return
	}
	if !promptAuditUserNotifyAllowed(ev.UserId, time.Duration(cfg.NotifyCooldownSec)*time.Second) {
		return
	}

	subject := promptAuditUserNotifySubject()
	body := promptAuditUserNotifyHTML(ev, cfg)
	if err := common.SendEmail(subject, email, body); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 用户拦截邮件发送失败 user=%d: %s", ev.UserId, err.Error()))
	}
}

func promptAuditUserNotifySubject() string {
	name := strings.TrimSpace(common.SystemName)
	if name == "" {
		name = "New API"
	}
	return fmt.Sprintf("【%s】违规请求已被拦截", name)
}

// promptAuditBanWindowText 把封号统计窗口写成用户能看懂的时段。
func promptAuditBanWindowText(minutes int) string {
	if minutes <= 0 {
		minutes = 60
	}
	if minutes%1440 == 0 {
		d := minutes / 1440
		if d == 1 {
			return "24 小时内"
		}
		return fmt.Sprintf("%d 天内", d)
	}
	if minutes%60 == 0 {
		h := minutes / 60
		if h == 1 {
			return "1 小时内"
		}
		return fmt.Sprintf("%d 小时内", h)
	}
	return fmt.Sprintf("%d 分钟内", minutes)
}

func promptAuditUserBanWarning(cfg *operation_setting.PromptAuditSetting) string {
	threshold := 3
	windowMin := 60
	if cfg != nil {
		if cfg.AutoBanThreshold > 0 {
			threshold = cfg.AutoBanThreshold
		}
		windowMin = cfg.EffectiveAutoBanWindowMin()
	}
	return fmt.Sprintf("严重警告：%s拦截次数达到 %d 次，账号将被立即封禁。封禁后无法登录、无法调用 API，已购额度与套餐一律不予退还。请立即停止提交同类内容。",
		promptAuditBanWindowText(windowMin), threshold)
}

func promptAuditUserNotifyHTML(ev PromptAuditNotifyEvent, cfg *operation_setting.PromptAuditSetting) string {
	ts := ev.CreatedAt
	if ts.IsZero() {
		ts = time.Now()
	}
	account := fmt.Sprintf("#%d", ev.UserId)
	if name := strings.TrimSpace(ev.Username); name != "" {
		account = fmt.Sprintf("%s (#%d)", name, ev.UserId)
	}
	reason := strings.TrimSpace(ev.Reason)
	if reason == "" {
		reason = "请求内容违反平台安全规则"
	}
	reason = TruncateRunes(reason, 120)
	warning := promptAuditUserBanWarning(cfg)

	var sb strings.Builder
	sb.WriteString(`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#1c1f23;line-height:1.7">`)
	sb.WriteString(`<p style="margin:0 0 12px">`)
	if ev.Username != "" {
		sb.WriteString(html.EscapeString(ev.Username))
		sb.WriteString("：")
	} else {
		sb.WriteString("你好：")
	}
	sb.WriteString(`</p>`)
	sb.WriteString(`<p style="margin:0 0 12px">你的本次 API 请求因<strong>违反平台内容安全规则</strong>已被系统拦截，<strong>没有发送给模型</strong>。本次拦截已记入违规记录。</p>`)
	sb.WriteString(`<p style="margin:0 0 8px;color:#6b7280;font-size:12px">判定理由</p>`)
	sb.WriteString(`<p style="margin:0 0 16px;padding:12px 14px;background:#f5f6f7;border-left:3px solid #1c1f23;font-size:14px">`)
	sb.WriteString(html.EscapeString(reason))
	sb.WriteString(`</p>`)
	sb.WriteString(`<p style="margin:0 0 16px;padding:12px 14px;background:#fff1f0;border:1px solid #ffa39e;color:#a8071a;font-weight:600">`)
	sb.WriteString(html.EscapeString(warning))
	sb.WriteString(`</p>`)
	sb.WriteString(`<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">`)
	for _, f := range [][2]string{
		{"时间", ts.Format("2006-01-02 15:04:05")},
		{"账号", account},
		{"请求模型", ev.ModelName},
	} {
		if f[1] == "" {
			continue
		}
		sb.WriteString(`<tr><td style="color:#6b7280;white-space:nowrap;vertical-align:top">`)
		sb.WriteString(html.EscapeString(f[0]))
		sb.WriteString(`</td><td style="vertical-align:top">`)
		sb.WriteString(html.EscapeString(f[1]))
		sb.WriteString(`</td></tr>`)
	}
	sb.WriteString(`</table>`)
	sb.WriteString(`<p style="margin:16px 0 0;color:#6b7280;font-size:12px">如确属误判，请联系管理员处理，切勿反复重试同一请求。本邮件由系统自动发送。</p></div>`)
	return sb.String()
}
