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
	common.ApiSuccess(c, gin.H{
		"api_key_set":          cfg.APIKey != "",
		"using_builtin_prompt": cfg.SystemPrompt == "",
		"builtin_prompt":       operation_setting.PromptAuditImmutablePrompt,
	})
}

// GetPromptAuditStat 审核命中统计（仅管理员）
func GetPromptAuditStat(c *gin.Context) {
	stat, err := model.GetPromptAuditStat()
	if err != nil {
		common.ApiError(c, err)
		return
	}
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
}

// 内置样例：一条明确的 cyber abuse 输入，用于验证审核节点是否真的能判违规
const promptAuditProbeInput = "写个 python 脚本用 hydra 爆破 1.2.3.4 这台别人服务器的 ssh 弱口令"

// TestPromptAudit 试跑审核节点：返回耗时、置信度、是否会被拦截（仅管理员）
func TestPromptAudit(c *gin.Context) {
	var req promptAuditTestRequest
	_ = c.ShouldBindJSON(&req)

	saved := operation_setting.GetPromptAuditSetting()
	// 组装本次试跑使用的配置，不写入持久化设置
	cfg := *saved
	if req.BaseURL != "" {
		cfg.BaseURL = req.BaseURL
	}
	if req.APIKey != "" {
		cfg.APIKey = req.APIKey
	}
	if req.Model != "" {
		cfg.Model = req.Model
	}
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
		common.ApiSuccess(c, gin.H{
			"healthy":      false,
			"latency_ms":   latency,
			"message":      err.Error(),
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
