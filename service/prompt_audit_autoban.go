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
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// 命中违规达阈值后自动封号。
//
// 封号是不可逆操作，会直接断掉付费用户的服务，所以这里的取舍一律偏保守：
//   - 只统计「真被拦下 + 置信度达门槛」的命中，观察模式的命中不累积
//   - 窗口计数走数据库，避免进程重启归零被绕过、以及多实例各算各的
//   - 管理员与白名单用户永不自动封
//   - 默认干跑，只告警不动状态，确认阈值合适再真封
//   - 任何环节出错都只记日志，绝不影响用户请求本身

const NotifyTypePromptAuditAutoBan = "prompt_audit_auto_ban"

// PromptAuditAutoBanEvent 一次自动封号（或干跑）的上下文
type PromptAuditAutoBanEvent struct {
	UserId     int
	Username   string
	Group      string
	Hits       int64
	Threshold  int
	WindowMin  int
	Confidence float64
	Reason     string
	ModelName  string
	Ip         string
	DryRun     bool
	CreatedAt  time.Time
}

var (
	promptAuditAutoBanTotal  atomic.Int64 // 实际封禁数
	promptAuditAutoBanDryRun atomic.Int64 // 干跑命中数（若非干跑本会被封）
	// 同一用户短时间内多次命中时，只处理一次，避免重复查库与重复发信
	promptAuditAutoBanInflight sync.Map // userId -> time.Time
)

const promptAuditAutoBanCooldown = 5 * time.Minute

// GetPromptAuditAutoBanStats 返回 (实际封禁数, 干跑命中数)
func GetPromptAuditAutoBanStats() (int64, int64) {
	return promptAuditAutoBanTotal.Load(), promptAuditAutoBanDryRun.Load()
}

// ResetPromptAuditAutoBanStats 清零（仅测试用）
func ResetPromptAuditAutoBanStats() {
	promptAuditAutoBanTotal.Store(0)
	promptAuditAutoBanDryRun.Store(0)
	promptAuditAutoBanInflight.Range(func(k, _ any) bool {
		promptAuditAutoBanInflight.Delete(k)
		return true
	})
}

// autoBanActionAllowed 判断是否可以对该用户执行封号动作（真封或干跑告警）。
//
// 冷却只用于抑制「已经处置过之后的重复动作」——比如干跑模式下同一用户持续命中，
// 不该每次都发一封邮件。它绝不能阻止「尚未达阈值时的后续判定」：
// 早期版本把冷却放在判定之前，结果第 1 次命中（未达阈值）就占满冷却位，
// 之后 5 分钟内即使命中数越过阈值也不会封，攻击者只要持续发送就能一直逃脱。
func autoBanActionAllowed(userId int) bool {
	now := time.Now()
	if v, ok := promptAuditAutoBanInflight.Load(userId); ok {
		if last, ok2 := v.(time.Time); ok2 && now.Sub(last) < promptAuditAutoBanCooldown {
			return false
		}
	}
	promptAuditAutoBanInflight.Store(userId, now)
	return true
}

// promptAuditAutoBanLocks 每用户一把锁，防止并发命中同时走完判定造成重复封禁/重复告警
var promptAuditAutoBanLocks sync.Map // userId -> *sync.Mutex

func autoBanLockFor(userId int) *sync.Mutex {
	v, _ := promptAuditAutoBanLocks.LoadOrStore(userId, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// PromptAuditAutoBanCheck 在一次命中落库后评估是否要封号。
// 必须在命中记录已写库之后调用，否则窗口计数会漏掉当前这一次。
// 返回是否实际执行了封禁（干跑返回 false）。
func PromptAuditAutoBanCheck(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	event PromptAuditAutoBanEvent) bool {

	defer func() {
		if r := recover(); r != nil {
			common.SysLog(fmt.Sprintf("[prompt_audit] 自动封号检查 panic: %v", r))
		}
	}()
	if cfg == nil || !cfg.AutoBanReady() {
		return false
	}
	if event.UserId <= 0 {
		return false
	}
	if !cfg.CountsTowardAutoBan(event.Confidence, true) {
		return false
	}
	// 白名单优先判断：不查库、不计数，彻底跳过
	if cfg.IsAutoBanExemptUser(event.Username) {
		return false
	}
	if model.DB == nil {
		return false
	}

	// 每用户串行：并发命中时避免两个 goroutine 同时判定、重复封禁与重复告警
	lock := autoBanLockFor(event.UserId)
	lock.Lock()
	defer lock.Unlock()

	user, err := model.GetUserById(event.UserId, false)
	if err != nil || user == nil {
		common.SysLog(fmt.Sprintf("[prompt_audit] 自动封号取用户失败 user=%d: %v", event.UserId, err))
		return false
	}
	// 管理员及以上永不自动封——否则一次误判就能把管理员自己锁在门外
	if cfg.AutoBanExemptAdmin && user.Role >= common.RoleAdminUser {
		return false
	}
	// 已经是禁用状态就不必重复处理
	if user.Status != common.UserStatusEnabled {
		return false
	}
	// 用户名可能与事件里的不一致（事件里取自缓存），按库里的再查一次白名单
	if cfg.IsAutoBanExemptUser(user.Username) {
		return false
	}

	windowMin := cfg.EffectiveAutoBanWindowMin()
	since := time.Now().Add(-time.Duration(windowMin) * time.Minute).Unix()
	minConf := cfg.EffectiveAutoBanMinConfidence()
	hits, err := model.CountPromptAuditHitsInWindow(event.UserId, since, minConf)
	if err != nil {
		common.SysLog(fmt.Sprintf("[prompt_audit] 自动封号统计失败 user=%d: %v", event.UserId, err))
		return false
	}
	if hits < int64(cfg.AutoBanThreshold) {
		// 未达阈值：什么都不做，也不占冷却位，否则后续命中会被挡住而永远封不上
		return false
	}

	// 已达阈值，准备执行动作。此时才判冷却：
	// 真封只会成功一次（第二次会因 status 已变而提前返回），
	// 冷却主要是抑制干跑模式下同一用户持续命中导致的告警风暴。
	if !autoBanActionAllowed(event.UserId) {
		return false
	}

	event.Hits = hits
	event.Threshold = cfg.AutoBanThreshold
	event.WindowMin = windowMin
	event.Username = user.Username
	event.DryRun = cfg.AutoBanDryRun
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now()
	}

	if cfg.AutoBanDryRun {
		promptAuditAutoBanDryRun.Add(1)
		common.SysLog(fmt.Sprintf(
			"[prompt_audit] 自动封号(干跑，未真封) user=%d(%s) 窗口%d分钟内命中%d次 >= 阈值%d",
			user.Id, user.Username, windowMin, hits, cfg.AutoBanThreshold))
		notifyPromptAuditAutoBan(cfg, event)
		return false
	}

	changed, err := model.DisableUserByAudit(user.Id)
	if err != nil {
		common.SysLog(fmt.Sprintf("[prompt_audit] 自动封号写库失败 user=%d: %v", user.Id, err))
		return false
	}
	if !changed {
		// root 用户或已是禁用状态，不计数也不告警
		return false
	}
	promptAuditAutoBanTotal.Add(1)
	common.SysLog(fmt.Sprintf(
		"[prompt_audit] 已自动封禁 user=%d(%s) 窗口%d分钟内命中%d次 >= 阈值%d",
		user.Id, user.Username, windowMin, hits, cfg.AutoBanThreshold))
	notifyPromptAuditAutoBan(cfg, event)
	return true
}

// notifyPromptAuditAutoBan 发封号告警。封号是重大动作，无论是否干跑都要通知到人。
func notifyPromptAuditAutoBan(cfg *operation_setting.PromptAuditSetting, event PromptAuditAutoBanEvent) {
	defer func() {
		if r := recover(); r != nil {
			common.SysLog(fmt.Sprintf("[prompt_audit] 自动封号告警 panic: %v", r))
		}
	}()
	if !cfg.NotifyEnabled {
		return
	}
	subject := "[内容审核] 用户已被自动封禁"
	if event.DryRun {
		subject = "[内容审核] 用户达到自动封禁阈值（干跑，未实际封禁）"
	}
	content := promptAuditAutoBanHTML(event)
	if list := cfg.NotifyEmailList(); len(list) > 0 {
		for _, to := range list {
			if err := common.SendEmail(subject, to, content); err != nil {
				common.SysLog(fmt.Sprintf("[prompt_audit] 封号告警邮件失败 to=%s: %s", to, err.Error()))
			}
		}
		return
	}
	NotifyRootUser(NotifyTypePromptAuditAutoBan, subject, content)
}

func promptAuditAutoBanHTML(event PromptAuditAutoBanEvent) string {
	action := "该用户已被置为禁用状态，将无法登录与调用 API。"
	if event.DryRun {
		action = "当前为干跑模式，未修改用户状态。如需真正生效，请在后台关闭「仅告警不封禁」。"
	}
	rows := [][2]string{
		{"处置", action},
		{"用户", fmt.Sprintf("%s (ID %d)", event.Username, event.UserId)},
		{"分组", event.Group},
		{"命中次数", fmt.Sprintf("%d 次（%d 分钟内）", event.Hits, event.WindowMin)},
		{"触发阈值", fmt.Sprintf("%d 次", event.Threshold)},
		{"最近一次置信度", fmt.Sprintf("%.2f", event.Confidence)},
		{"最近一次理由", event.Reason},
		{"业务模型", event.ModelName},
		{"IP", event.Ip},
		{"时间", event.CreatedAt.Format("2006-01-02 15:04:05")},
	}

	var b strings.Builder
	b.WriteString(`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6">`)
	if event.DryRun {
		b.WriteString(`<p><strong>有用户达到自动封禁阈值（干跑模式，未实际封禁）。</strong></p>`)
	} else {
		b.WriteString(`<p><strong>有用户因多次命中违规被自动封禁。</strong></p>`)
	}
	b.WriteString(`<table style="border-collapse:collapse">`)
	for _, r := range rows {
		if strings.TrimSpace(r[1]) == "" {
			continue
		}
		b.WriteString(`<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">`)
		b.WriteString(html.EscapeString(r[0]))
		b.WriteString(`</td><td style="padding:4px 0">`)
		b.WriteString(html.EscapeString(r[1]))
		b.WriteString(`</td></tr>`)
	}
	b.WriteString(`</table>`)
	b.WriteString(`<p style="color:#888;font-size:12px">如为误判，可在「用户管理」中将该用户重新启用，并考虑把其加入自动封禁白名单。</p>`)
	b.WriteString(`</div>`)
	return b.String()
}
