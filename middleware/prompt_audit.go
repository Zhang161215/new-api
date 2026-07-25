package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// promptAuditPeek 用于从原始请求体里轻量提取用户输入，兼容 OpenAI / Claude / Responses 三种格式
type promptAuditPeek struct {
	Messages []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"messages"`
	Input  json.RawMessage `json:"input"`  // OpenAI Responses
	Prompt json.RawMessage `json:"prompt"` // 图片生成 / legacy completions
}

// 仅审核这些携带用户提示词的端点，其余（embeddings/audio/rerank/models…）直接放行，避免无谓延迟
var promptAuditPathSuffixes = []string{
	"/chat/completions",
	"/completions",
	"/messages",
	"/responses",
	"/responses/compact",
	"/images/generations",
	"/images/edits",
}

// promptAuditAsyncTimeout 影子模式下后台审核的超时（比同步略宽松，不影响用户）
func promptAuditAsyncTimeout(cfg *operation_setting.PromptAuditSetting) time.Duration {
	if cfg.TimeoutMs > 0 {
		return time.Duration(cfg.TimeoutMs) * time.Millisecond * 3
	}
	return 15 * time.Second
}

func promptAuditPathMatches(path string) bool {
	for _, suffix := range promptAuditPathSuffixes {
		if strings.HasSuffix(path, suffix) {
			return true
		}
	}
	return false
}

// PromptAudit 前置提示词安全审核中间件
func PromptAudit() gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := operation_setting.GetPromptAuditSetting()
		if cfg == nil || !cfg.Enabled {
			c.Next()
			return
		}
		// 跳过审核模型自身的回环请求
		if c.GetHeader(service.PromptAuditGuardHeader) != "" {
			c.Next()
			return
		}
		if cfg.BaseURL == "" || cfg.Model == "" {
			c.Next()
			return
		}
		if !promptAuditPathMatches(c.Request.URL.Path) {
			c.Next()
			return
		}

		// 分组白名单：只审核指定分组（留空=全部）。生效分组与 relay 口径一致
		if !cfg.ShouldAuditGroup(effectiveGroup(c)) {
			c.Next()
			return
		}

		storage, err := common.GetBodyStorage(c)
		if err != nil {
			c.Next()
			return
		}
		body, err := storage.Bytes()
		if err != nil || len(body) == 0 {
			c.Next()
			return
		}
		// 读完重置存储游标，供下游 relay 再次读取
		if _, seekErr := storage.Seek(0, io.SeekStart); seekErr == nil {
			c.Request.Body = io.NopCloser(storage)
		}

		userInput := extractUserInput(body)
		if strings.TrimSpace(userInput) == "" {
			c.Next()
			return
		}
		if cfg.MaxInputChars > 0 {
			userInput = service.TruncateRunes(userInput, cfg.MaxInputChars)
		}

		meta := newPromptAuditMeta(c, userInput)

		// 影子模式：异步审核并记录，不阻塞、不给用户增加任何延迟
		if !cfg.Blocking {
			auditCtx := c.Request.Context()
			gopool.Go(func() {
				bgCtx, cancel := context.WithTimeout(context.Background(), promptAuditAsyncTimeout(cfg))
				defer cancel()
				started := time.Now()
				confidence, reason, auditErr := service.RunPromptAudit(bgCtx, cfg, userInput)
				if auditErr != nil {
					logger.LogWarn(auditCtx, fmt.Sprintf("[prompt_audit] 影子审核失败: %s", auditErr.Error()))
					return
				}
				hit := confidence >= cfg.Threshold
				if hit {
					logger.LogWarn(auditCtx, fmt.Sprintf("[prompt_audit] 影子命中(未拦截) user=%d token=%s confidence=%.2f reason=%s", meta.userId, meta.tokenName, confidence, reason))
				}
				// 命中必记；开启「记录全部」时合规结果也记，便于确认审核在正常工作
				if hit || cfg.RecordAll {
					meta.record(auditCtx, cfg, confidence, reason, false, time.Since(started))
				}
			})
			c.Next()
			return
		}

		started := time.Now()
		confidence, reason, auditErr := service.RunPromptAudit(c.Request.Context(), cfg, userInput)
		if auditErr != nil {
			// 审核链路异常
			if cfg.FailOpen {
				logger.LogWarn(c.Request.Context(), fmt.Sprintf("[prompt_audit] 审核失败放行(fail-open): %s", auditErr.Error()))
				c.Next()
				return
			}
			abortWithOpenAiMessage(c, http.StatusServiceUnavailable, "内容安全审核暂时不可用，请稍后再试")
			return
		}

		if confidence >= cfg.Threshold {
			logger.LogError(c.Request.Context(), fmt.Sprintf("[prompt_audit] 拦截 user=%d token=%s confidence=%.2f reason=%s", meta.userId, meta.tokenName, confidence, reason))
			meta.record(c.Request.Context(), cfg, confidence, reason, true, time.Since(started))
			abortWithOpenAiMessage(c, http.StatusBadRequest, "请求内容未通过安全审核，已被拦截。如为误判请联系管理员。")
			return
		}
		if cfg.RecordAll {
			meta.record(c.Request.Context(), cfg, confidence, reason, false, time.Since(started))
		}
		c.Next()
	}
}

// effectiveGroup 取本次请求实际生效的分组：token 分组优先，为空回落用户分组。
// 口径与 relay/common/relay_info.go 保持一致，避免两处判断不同分组。
func effectiveGroup(c *gin.Context) string {
	group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
	if group == "" {
		group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	}
	return group
}

// promptAuditMeta 命中记录所需的请求上下文快照（在 goroutine 里用，故先取值再脱离 gin.Context）
type promptAuditMeta struct {
	userId    int
	tokenName string
	group     string
	modelName string
	channelId int
	endpoint  string
	ip        string
	prompt    string
}

func newPromptAuditMeta(c *gin.Context, userInput string) *promptAuditMeta {
	return &promptAuditMeta{
		userId:    c.GetInt("id"),
		tokenName: c.GetString("token_name"),
		group:     effectiveGroup(c),
		modelName: c.GetString("original_model"),
		channelId: c.GetInt(string(constant.ContextKeyChannelId)),
		endpoint:  c.Request.URL.Path,
		ip:        c.ClientIP(),
		prompt:    userInput,
	}
}

// record 落库一条命中记录，供管理员在后台复核。
// 记录审计事件是旁路行为：任何失败（含 panic）都只记日志，绝不允许影响用户请求。
func (m *promptAuditMeta) record(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	confidence float64, reason string, blocked bool, latency time.Duration) {

	defer func() {
		if r := recover(); r != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 写入审核记录 panic: %v", r))
		}
	}()
	if model.DB == nil {
		return
	}

	username, err := model.GetUsernameById(m.userId, false)
	if err != nil {
		username = ""
	}
	entry := &model.PromptAuditLog{
		UserId:     m.userId,
		Username:   username,
		TokenName:  m.tokenName,
		Group:      m.group,
		ModelName:  m.modelName,
		ChannelId:  m.channelId,
		Endpoint:   m.endpoint,
		Confidence: confidence,
		Reason:     reason,
		Blocked:    blocked,
		AuditModel: cfg.Model,
		Prompt:     m.prompt,
		LatencyMs:  int(latency.Milliseconds()),
		Ip:         m.ip,
	}
	if err := model.RecordPromptAuditLog(entry); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 写入审核记录失败: %s", err.Error()))
	}
}

// extractUserInput 提取最近一条用户输入文本
func extractUserInput(body []byte) string {
	var peek promptAuditPeek
	if err := json.Unmarshal(body, &peek); err != nil {
		return ""
	}
	// OpenAI / Claude: messages[]，取最后一条 role=user
	if len(peek.Messages) > 0 {
		for i := len(peek.Messages) - 1; i >= 0; i-- {
			if peek.Messages[i].Role == "user" {
				return collectText(peek.Messages[i].Content)
			}
		}
		return ""
	}
	// OpenAI Responses: input 可能是 string 或 数组
	if len(peek.Input) > 0 {
		// 尝试纯字符串
		var s string
		if err := json.Unmarshal(peek.Input, &s); err == nil {
			return s
		}
		// 数组：取最后一个 user 项；无 role 则汇总全部文本
		var items []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
			Text    string          `json:"text"`
			Type    string          `json:"type"`
		}
		if err := json.Unmarshal(peek.Input, &items); err == nil {
			for i := len(items) - 1; i >= 0; i-- {
				if items[i].Role == "user" {
					if t := collectText(items[i].Content); t != "" {
						return t
					}
				}
			}
			// 没有 role=user，汇总所有文本片段
			var sb strings.Builder
			for _, it := range items {
				if it.Text != "" {
					sb.WriteString(it.Text)
					sb.WriteString("\n")
				} else if len(it.Content) > 0 {
					sb.WriteString(collectText(it.Content))
					sb.WriteString("\n")
				}
			}
			return strings.TrimSpace(sb.String())
		}
	}
	// 图片生成 / legacy completions: prompt 可能是 string 或 []string
	if len(peek.Prompt) > 0 {
		var s string
		if err := json.Unmarshal(peek.Prompt, &s); err == nil {
			return s
		}
		var arr []string
		if err := json.Unmarshal(peek.Prompt, &arr); err == nil {
			return strings.TrimSpace(strings.Join(arr, "\n"))
		}
	}
	return ""
}

// collectText 递归提取 content 中的文本（string / []{type,text|input_text} / 嵌套）
func collectText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	// 直接字符串
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	// 数组
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err == nil {
		var sb strings.Builder
		for _, elem := range arr {
			var es string
			if err := json.Unmarshal(elem, &es); err == nil {
				sb.WriteString(es)
				sb.WriteString("\n")
				continue
			}
			var obj struct {
				Type    string          `json:"type"`
				Text    string          `json:"text"`
				Content json.RawMessage `json:"content"`
			}
			if err := json.Unmarshal(elem, &obj); err == nil {
				if obj.Text != "" {
					sb.WriteString(obj.Text)
					sb.WriteString("\n")
				} else if len(obj.Content) > 0 {
					sb.WriteString(collectText(obj.Content))
					sb.WriteString("\n")
				}
			}
		}
		return strings.TrimSpace(sb.String())
	}
	// 单个对象
	var obj struct {
		Text    string          `json:"text"`
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil {
		if obj.Text != "" {
			return obj.Text
		}
		if len(obj.Content) > 0 {
			return collectText(obj.Content)
		}
	}
	return ""
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}
