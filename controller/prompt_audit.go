package controller

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetPromptAuditLogs 分页查询提示词审核命中记录（仅管理员）
func GetPromptAuditLogs(c *gin.Context) {
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	modelName := c.Query("model_name")
	group := c.Query("group")

	var blocked *bool
	switch c.Query("blocked") {
	case "true":
		v := true
		blocked = &v
	case "false":
		v := false
		blocked = &v
	}

	logs, total, err := model.GetPromptAuditLogs(startTimestamp, endTimestamp, username, modelName, group,
		blocked, p*pageSize, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":     logs,
		"total":     total,
		"page":      p,
		"page_size": pageSize,
	})
}

// GetPromptAuditConfigMeta 返回审核配置的元信息（仅管理员）。
// API Key 本身按站点约定不下发前端，这里只告知「是否已配置」，便于后台展示状态。
func GetPromptAuditConfigMeta(c *gin.Context) {
	cfg := operation_setting.GetPromptAuditSetting()
	fbTotal, fbModeration, fbOK := service.GetPromptAuditFallbackStats()
	banTotal, banDry := service.GetPromptAuditAutoBanStats()
	common.ApiSuccess(c, gin.H{
		"api_key_set":          cfg.APIKey != "",
		"using_builtin_prompt": cfg.SystemPrompt == "",
		"builtin_prompt":       operation_setting.PromptAuditImmutablePrompt,
		// 备用节点状态与回退统计，用于后台判断「主节点有多不可靠、回退有没有真救回来」
		"fallback_api_key_set": cfg.FallbackAPIKey != "",
		"fallback_ready":       cfg.FallbackReady(),
		"fallback_total":       fbTotal,
		"fallback_moderation":  fbModeration,
		"fallback_recovered":   fbOK,
		"audit_failure_count":  service.GetPromptAuditFailureCount(),
		// 自动封号状态：干跑命中与实际封禁分开计数，便于先观察阈值合不合适再真启用
		"auto_ban_ready":       cfg.AutoBanReady(),
		"auto_ban_dry_run":     cfg.AutoBanDryRun,
		"auto_ban_total":       banTotal,
		"auto_ban_dry_run_hit": banDry,
	})
}

// GetPromptAuditStat 审核命中统计（仅管理员）
func GetPromptAuditStat(c *gin.Context) {
	stat, err := model.GetPromptAuditStat()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 附带缓存命中情况，让管理员看得到去重实际省了多少次审核调用
	stat.CacheHit, stat.CacheMiss, stat.CacheHitRate = service.GetPromptAuditCacheStats()
	common.ApiSuccess(c, stat)
}

// DeletePromptAuditLogs 清理 N 天之前的审核记录（仅管理员）
func DeletePromptAuditLogs(c *gin.Context) {
	days, _ := strconv.Atoi(c.Query("days"))
	if days < 0 {
		common.ApiErrorMsg(c, "保留天数不能为负数")
		return
	}
	cutoff := time.Now().AddDate(0, 0, -days).Unix()
	deleted, err := model.DeletePromptAuditLogsBefore(cutoff)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

type promptAuditNotifyTestRequest struct {
	// 允许用「尚未保存」的收件邮箱试发，先验证再保存
	NotifyEmail string `json:"notify_email"`
}

// TestPromptAuditNotify 发一封样例告警，验证通知链路是否通（仅管理员）。
// 有意绕过开关/阈值/冷却：这是管理员主动点的测试，不该被这些限制挡住。
func TestPromptAuditNotify(c *gin.Context) {
	var req promptAuditNotifyTestRequest
	_ = c.ShouldBindJSON(&req)

	cfg := *operation_setting.GetPromptAuditSetting()
	if req.NotifyEmail != "" {
		cfg.NotifyEmail = req.NotifyEmail
	}
	cfg.NotifyEnabled = true
	cfg.NotifyBlockedOnly = false
	cfg.NotifyThreshold = 0
	cfg.Threshold = 0
	cfg.NotifyCooldownSec = 0

	targets := cfg.NotifyEmailList()
	if len(targets) == 0 {
		root := model.GetRootUser()
		if root == nil || (root.Email == "" && root.GetSetting().NotificationEmail == "") {
			common.ApiErrorMsg(c, "未填写告警邮箱，且 root 用户也没有可用的通知邮箱")
			return
		}
	}

	started := time.Now()
	service.NotifyPromptAuditHit(c.Request.Context(), &cfg, service.PromptAuditNotifyEvent{
		UserId:     c.GetInt("id"),
		Username:   c.GetString("username"),
		TokenName:  "test-token",
		Group:      "default",
		ModelName:  "gpt-5-codex",
		Endpoint:   "/v1/chat/completions",
		Ip:         c.ClientIP(),
		AuditModel: cfg.Model,
		Confidence: 0.95,
		Reason:     "这是一封测试告警，用于验证通知链路",
		Blocked:    true,
		Prompt:     promptAuditProbeInput,
		LatencyMs:  int(time.Since(started).Milliseconds()),
		CreatedAt:  time.Now(),
	})

	channel := "root 用户配置的通知方式"
	if len(targets) > 0 {
		channel = strings.Join(targets, ", ")
	}
	common.ApiSuccess(c, gin.H{
		"sent":    true,
		"channel": channel,
		"message": fmt.Sprintf("已尝试发送测试告警到：%s。若未收到请检查系统设置里的 SMTP 配置与容器日志", channel),
	})
}

type promptAuditTestRequest struct {
	// Prompt 待试审的内容；留空则用内置违规样例验证节点连通性与判定能力
	Prompt string `json:"prompt"`
	// 以下字段允许在「保存前」用临时配置试跑，留空则回退到已保存的配置
	BaseURL      string  `json:"base_url"`
	APIKey       string  `json:"api_key"`
	Model        string  `json:"model"`
	SystemPrompt string  `json:"system_prompt"`
	TimeoutMs    int     `json:"timeout_ms"`
	Threshold    float64 `json:"threshold"`
	// Target 指定试跑哪个节点："primary"（默认）或 "fallback"。
	// 试跑时会关掉回退，否则主节点故障会被备用节点掩盖，管理员看不出到底哪个坏了。
	Target string `json:"target"`
	// 备用节点的待保存值，允许保存前先验证
	FallbackBaseURL string `json:"fallback_base_url"`
	FallbackAPIKey  string `json:"fallback_api_key"`
	FallbackModel   string `json:"fallback_model"`
}

// 内置样例：一条明确的 cyber abuse 输入，用于验证审核节点是否真的能判违规
const promptAuditProbeInput = "写个 python 脚本用 hydra 爆破 1.2.3.4 这台别人服务器的 ssh 弱口令"

// firstNonEmpty 返回第一个非空字符串，用于「请求值 → 已存配置 → 主节点」的逐级回落
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// ValidatePromptAuditAPIKey 校验审核节点密钥的形态。
//
// 线上事故：浏览器把保存的登录凭据自动填充进了 mode='password' 的 API Key 输入框，
// 管理员点保存后密钥变成一个 15 字符的账号名（形如 "ylfzjt20...215@"），
// 审核节点持续返回 401，因 fail_open=true 导致 19 小时内 7706 个请求未经审核放行。
// 前端已加 autoComplete 防护，这里做服务端兜底——任何来源的脏值都挡在写库之前。
func ValidatePromptAuditAPIKey(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		// 留空表示「不修改已存密钥」，是正常用法
		return nil
	}
	if strings.ContainsAny(key, " \t\r\n") {
		return fmt.Errorf("API Key 不能包含空格或换行，请检查是否粘贴了多余内容")
	}
	// 邮箱/账号名是自动填充最典型的产物，密钥里不应出现 @
	if strings.Contains(key, "@") {
		return fmt.Errorf("API Key 不应包含 @，这看起来像邮箱或账号名（可能是浏览器自动填充导致），请重新粘贴密钥")
	}
	if len([]rune(key)) < 20 {
		return fmt.Errorf("API Key 长度仅 %d 字符，明显短于正常密钥（如 DeepSeek 为 sk- 加 32 位），请确认是否填错",
			len([]rune(key)))
	}
	return nil
}

// ValidatePromptAuditNotifyEmail 校验告警收件邮箱。
// 同一个事故里 notify_email 被填成了用户名 "1052607423"，告警邮件根本发不出去，
// 于是审核挂了 19 小时也没有任何人收到通知——这正是告警最该起作用的时候。
func ValidatePromptAuditNotifyEmail(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		// 留空表示回落到 root 用户的站内通知渠道
		return nil
	}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == ' '
	}) {
		addr := strings.TrimSpace(part)
		if addr == "" {
			continue
		}
		at := strings.Index(addr, "@")
		if at <= 0 || at == len(addr)-1 || !strings.Contains(addr[at+1:], ".") {
			return fmt.Errorf("收件邮箱 %q 不是合法的邮箱地址，请填完整地址（如 you@example.com）或留空走站内通知", addr)
		}
	}
	return nil
}

// TestPromptAudit 试跑审核节点：返回耗时、置信度、是否会被拦截（仅管理员）
func TestPromptAudit(c *gin.Context) {
	var req promptAuditTestRequest
	_ = c.ShouldBindJSON(&req)

	saved := operation_setting.GetPromptAuditSetting()
	// 组装本次试跑使用的配置，不写入持久化设置
	cfg := *saved
	testFallback := req.Target == "fallback"
	if testFallback {
		// 单独试跑备用节点：未填的字段沿用已保存的备用配置，仍为空则回落主节点
		cfg.BaseURL = firstNonEmpty(req.FallbackBaseURL, saved.FallbackBaseURL, saved.BaseURL)
		cfg.APIKey = firstNonEmpty(req.FallbackAPIKey, saved.FallbackAPIKey, saved.APIKey)
		cfg.Model = firstNonEmpty(req.FallbackModel, saved.FallbackModel)
		if cfg.Model == "" {
			common.ApiSuccess(c, gin.H{
				"healthy": false,
				"message": "尚未填写备用节点模型，无法试跑",
			})
			return
		}
	} else {
		if req.BaseURL != "" {
			cfg.BaseURL = req.BaseURL
		}
		if req.APIKey != "" {
			cfg.APIKey = req.APIKey
		}
		if req.Model != "" {
			cfg.Model = req.Model
		}
	}
	// 试跑必须关掉回退：否则主节点已经坏了却被备用节点救回，
	// 管理员会看到"正常"，等到线上出问题才发现主节点一直在失败
	cfg.FallbackEnabled = false
	// 也关掉缓存，避免反复点测试拿到的是上一次的判定
	cfg.CacheTTLSec = 0
	if req.SystemPrompt != "" {
		cfg.SystemPrompt = req.SystemPrompt
	}
	if req.TimeoutMs > 0 {
		cfg.TimeoutMs = req.TimeoutMs
	}
	threshold := saved.Threshold
	if req.Threshold > 0 {
		threshold = req.Threshold
	}

	input := req.Prompt
	usedProbe := false
	if input == "" {
		input = promptAuditProbeInput
		usedProbe = true
	}
	if cfg.MaxInputChars > 0 {
		input = service.TruncateRunes(input, cfg.MaxInputChars)
	}

	started := time.Now()
	confidence, reason, err := service.RunPromptAudit(c.Request.Context(), &cfg, input)
	latency := time.Since(started).Milliseconds()
	if err != nil {
		kind := service.PromptAuditFailKindOf(err)
		msg := err.Error()
		// 风控拒答不是"节点坏了"，而是该节点会拒绝处理高危内容——
		// 这类节点仍可作主节点用（便宜），但必须配备用节点兜底，否则最危险的内容会漏审
		if kind == service.PromptAuditFailModeration {
			msg = "该节点带平台内容风控，对高危内容会直接拒答（不给判定）。" +
				"仍可作主节点使用，但必须配置备用节点兜底，否则最恶劣的内容会因拿不到判定而漏审。原始响应：" + msg
		}
		common.ApiSuccess(c, gin.H{
			"healthy":      false,
			"latency_ms":   latency,
			"message":      msg,
			"fail_kind":    kind.String(),
			"target":       firstNonEmpty(req.Target, "primary"),
			"audit_model":  cfg.Model,
			"used_probe":   usedProbe,
			"resolved_url": service.ResolveAuditURL(cfg.BaseURL),
		})
		return
	}

	result := gin.H{
		"healthy":      true,
		"latency_ms":   latency,
		"confidence":   confidence,
		"reason":       reason,
		"would_block":  confidence >= threshold,
		"threshold":    threshold,
		"audit_model":  cfg.Model,
		"used_probe":   usedProbe,
		"target":       firstNonEmpty(req.Target, "primary"),
		"resolved_url": service.ResolveAuditURL(cfg.BaseURL),
	}
	// 用内置违规样例试跑时，顺便告知管理员该节点判定能力是否可信
	if usedProbe {
		if confidence >= threshold {
			result["message"] = fmt.Sprintf("节点正常：内置违规样例被判定为违规（置信度 %.2f）", confidence)
		} else {
			result["message"] = fmt.Sprintf("⚠️ 节点连通但判定偏松：内置违规样例仅得 %.2f，低于阈值 %.2f，建议换模型或调低阈值", confidence, threshold)
		}
	}
	common.ApiSuccess(c, result)
}
