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
	"github.com/QuantumNous/new-api/types"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// promptAuditMessage 请求体里的单条消息
type promptAuditMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// promptAuditPeek 用于从原始请求体里轻量提取用户输入，兼容 OpenAI / Claude / Responses 三种格式
type promptAuditPeek struct {
	Messages []promptAuditMessage `json:"messages"`
	Input    json.RawMessage      `json:"input"`  // OpenAI Responses
	Prompt   json.RawMessage      `json:"prompt"` // 图片生成 / legacy completions
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

// promptAuditFailureConfidence 审核未完成时写入的置信度哨兵值。
// 用负数而非 0，才能把「漏审」和「审过且合规」在库里区分开。
const promptAuditFailureConfidence = -1

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

		// 抽查：未抽中的请求直接放行，不读 body、不调审核模型，零额外开销。
		// 放在读 body 之前，抽查比例越低省得越多。
		if !cfg.ShouldSample() {
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

		userInput := extractAuditInput(body, cfg.GetAuditScope(), cfg.EffectiveScopeMessages())
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
					// 影子模式不拦截，但风控拒答值得单独提级：它是强违规信号
					if service.IsPromptAuditModerationRefusal(auditErr) {
						logger.LogError(auditCtx, fmt.Sprintf(
							"[prompt_audit] 影子模式遇上游风控拒答（拦截模式下会被拦）user=%d: %s",
							meta.userId, auditErr.Error()))
					} else {
						logger.LogWarn(auditCtx, fmt.Sprintf("[prompt_audit] 影子审核失败: %s", auditErr.Error()))
					}
					meta.recordFailure(auditCtx, cfg, auditErr, time.Since(started))
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
				if hit {
					meta.notify(auditCtx, cfg, confidence, reason, false, time.Since(started))
					// 影子模式下命中并未真的拦截，按「只统计被拦下的命中」的口径
					// 不计入封号——否则观察模式会悄悄把用户封掉，与其语义相悖
				}
			})
			c.Next()
			return
		}

		started := time.Now()
		confidence, reason, auditErr := service.RunPromptAudit(c.Request.Context(), cfg, userInput)
		if auditErr != nil {
			latency := time.Since(started)
			// 上游平台风控拒答，说明内容大概率极度违规——这种失败绝不能 fail-open，
			// 否则最恶劣的内容（线上实测：未成年人性内容、色情站点搭建）反而专门被放行。
			// 走到这里意味着备用节点也没能给出判定（或未配置备用节点）。
			if service.IsPromptAuditModerationRefusal(auditErr) {
				logger.LogError(c.Request.Context(), fmt.Sprintf(
					"[prompt_audit] 上游风控拒答且无可用判定，按违规拦截 user=%d: %s",
					meta.userId, auditErr.Error()))
				meta.recordFailure(c.Request.Context(), cfg, auditErr, latency)
				// 风控拒答记录的 confidence 是哨兵负值，不满足封号的置信度门槛，
				// 因此不计入自动封号统计——宁可少封，不能凭一个没有裁决的信号封人
				abortWithOpenAiMessage(c, http.StatusBadRequest,
					"请求内容未通过安全审核，已被拦截。如为误判请联系管理员。",
					types.ErrorCodeSensitiveWordsDetected)
				return
			}
			// 其余失败（超时、限流、5xx、输出无法解析）与内容本身无关，按配置处置
			if cfg.FailOpen {
				logger.LogWarn(c.Request.Context(), fmt.Sprintf("[prompt_audit] 审核失败放行(fail-open): %s", auditErr.Error()))
				// fail-open 曾经只打一行日志就放行：请求没被审、库里没有痕迹、也不告警，
				// 事后完全无法统计「到底漏审了多少」。这里补上落库与限频告警。
				meta.recordFailure(c.Request.Context(), cfg, auditErr, latency)
				c.Next()
				return
			}
			meta.recordFailure(c.Request.Context(), cfg, auditErr, latency)
			abortWithOpenAiMessage(c, http.StatusServiceUnavailable, "内容安全审核暂时不可用，请稍后再试")
			return
		}

		if confidence >= cfg.Threshold {
			logger.LogError(c.Request.Context(), fmt.Sprintf("[prompt_audit] 拦截 user=%d token=%s confidence=%.2f reason=%s", meta.userId, meta.tokenName, confidence, reason))
			latency := time.Since(started)
			// 先落库再评估自动封号：窗口计数走数据库，少这一条就会少算一次
			meta.record(c.Request.Context(), cfg, confidence, reason, true, latency)
			// 通知与封号判定都异步：SMTP 可能慢到几秒、封号要查库，不能让拦截响应等它们
			gopool.Go(func() {
				meta.notify(context.Background(), cfg, confidence, reason, true, latency)
			})
			gopool.Go(func() {
				meta.autoBan(context.Background(), cfg, confidence, reason)
			})
			// 错误码与站内敏感词拦截保持一致（types.ErrorCodeSensitiveWordsDetected），
			// 客户端可用同一套逻辑识别「内容被风控拦截」
			abortWithOpenAiMessage(c, http.StatusBadRequest,
				"请求内容未通过安全审核，已被拦截。如为误判请联系管理员。",
				types.ErrorCodeSensitiveWordsDetected)
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

	entry := &model.PromptAuditLog{
		UserId:     m.userId,
		Username:   m.username(),
		TokenName:  m.tokenName,
		Group:      m.group,
		ModelName:  m.modelName,
		ChannelId:  m.channelId,
		Endpoint:   m.endpoint,
		Confidence: confidence,
		Reason:     reason,
		Blocked:    blocked,
		AuditModel: cfg.Model,
		Prompt:     m.promptForStorage(cfg, confidence >= cfg.Threshold),
		LatencyMs:  int(latency.Milliseconds()),
		Ip:         m.ip,
	}
	if err := model.RecordPromptAuditLog(entry); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 写入审核记录失败: %s", err.Error()))
	}
}

// notify 命中时给管理员发告警。是否真的发送由配置（开关/阈值/冷却）决定，
// 这里只负责把上下文交出去；同 record 一样属于旁路，失败不影响用户请求。
func (m *promptAuditMeta) notify(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	confidence float64, reason string, blocked bool, latency time.Duration) {

	if cfg == nil || !cfg.ShouldNotify(confidence, blocked) {
		return
	}
	username := m.username()
	service.NotifyPromptAuditHit(ctx, cfg, service.PromptAuditNotifyEvent{
		UserId:     m.userId,
		Username:   username,
		TokenName:  m.tokenName,
		Group:      m.group,
		ModelName:  m.modelName,
		Endpoint:   m.endpoint,
		Ip:         m.ip,
		AuditModel: cfg.Model,
		Confidence: confidence,
		Reason:     reason,
		Blocked:    blocked,
		// 告警邮件同样遵守留存策略：邮箱里的副本也是一种留存
		Prompt:    m.promptForStorage(cfg, confidence >= cfg.Threshold),
		LatencyMs: int(latency.Milliseconds()),
		CreatedAt: time.Now(),
	})
}

// autoBan 评估本次命中是否触发自动封号。必须在命中记录已落库后调用。
// 属旁路行为：任何失败都不影响用户请求（请求此时已被拦截返回）。
func (m *promptAuditMeta) autoBan(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	confidence float64, reason string) {

	defer func() {
		if r := recover(); r != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 自动封号 panic: %v", r))
		}
	}()
	if cfg == nil || !cfg.AutoBanReady() {
		return
	}
	service.PromptAuditAutoBanCheck(ctx, cfg, service.PromptAuditAutoBanEvent{
		UserId:     m.userId,
		Username:   m.username(),
		Group:      m.group,
		Confidence: confidence,
		Reason:     reason,
		ModelName:  m.modelName,
		Ip:         m.ip,
		CreatedAt:  time.Now(),
	})
}

// recordFailure 记录一次审核失败（fail-open 放行或 fail-closed 拒绝）。
// confidence 用 -1 标记「未判定」，与「判定为合规的 0」区分开，
// 否则事后统计会把漏审当成审过且合规。属旁路行为，任何异常都不影响用户请求。
func (m *promptAuditMeta) recordFailure(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	auditErr error, latency time.Duration) {

	defer func() {
		if r := recover(); r != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 记录审核失败 panic: %v", r))
		}
	}()
	if cfg == nil || auditErr == nil {
		return
	}
	service.RecordPromptAuditFailure()

	// 风控拒答是强违规信号，落库时要能与普通失败区分开：
	// 它在拦截模式下实际被拦，事后复核时属于优先要看的一批
	moderation := service.IsPromptAuditModerationRefusal(auditErr)
	reasonPrefix := "审核未完成: "
	blocked := !cfg.FailOpen
	if moderation {
		reasonPrefix = "上游风控拒答（按违规处置）: "
		blocked = true
	}

	if model.DB != nil {
		entry := &model.PromptAuditLog{
			UserId:     m.userId,
			Username:   m.username(),
			TokenName:  m.tokenName,
			Group:      m.group,
			ModelName:  m.modelName,
			ChannelId:  m.channelId,
			Endpoint:   m.endpoint,
			Confidence: promptAuditFailureConfidence,
			Reason:     reasonPrefix + service.TruncateRunes(auditErr.Error(), 300),
			Blocked:    blocked,
			AuditModel: cfg.Model,
			// 未判定按「命中」口径留存原文：漏审的内容恰恰是最需要人工回看的
			Prompt:    m.promptForStorage(cfg, true),
			LatencyMs: int(latency.Milliseconds()),
			Ip:        m.ip,
		}
		if err := model.RecordPromptAuditLog(entry); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[prompt_audit] 写入审核失败记录失败: %s", err.Error()))
		}
	}

	// 失败告警单独限频：审核节点抖动时可能瞬间几百条失败，不能逐条发邮件
	gopool.Go(func() {
		service.NotifyPromptAuditFailure(context.Background(), cfg, service.PromptAuditFailureEvent{
			UserId:    m.userId,
			Username:  m.username(),
			Group:     m.group,
			ModelName: m.modelName,
			Endpoint:  m.endpoint,
			Ip:        m.ip,
			Error:     auditErr.Error(),
			FailOpen:  cfg.FailOpen,
			LatencyMs: int(latency.Milliseconds()),
			CreatedAt: time.Now(),
		})
	})
}

// promptForStorage 按留存策略返回可落库/外发的提示词内容。
// 不保留原文时给出占位说明而非留空，否则管理员分不清「本来就没提示词」
// 和「按策略隐去了」，仍保留字数便于判断请求规模。
func (m *promptAuditMeta) promptForStorage(cfg *operation_setting.PromptAuditSetting, hit bool) string {
	if cfg.ShouldStorePrompt(hit) {
		return m.prompt
	}
	return fmt.Sprintf("（按提示词留存策略未保存原文，原长 %d 字）", len([]rune(m.prompt)))
}

// username 取用户名用于展示，查不到就留空（DB 未就绪时也不能 panic）
func (m *promptAuditMeta) username() string {
	if model.DB == nil {
		return ""
	}
	name, err := model.GetUsernameById(m.userId, false)
	if err != nil {
		return ""
	}
	return name
}

// extractUserInput 按默认范围（仅最后一条 user 消息）提取送审文本
func extractUserInput(body []byte) string {
	return extractAuditInput(body, operation_setting.PromptAuditScopeLastUser, 0)
}

// extractAuditInput 按配置的范围提取送审文本。
//
// last_user 只取最后一条 user 消息——线上实测这常常只是「继续」两个字，
// 真实意图在更早轮次或 system 里，既漏审也容易被绕过；
// recent/full 会把 system 与更早的消息一并纳入，代价是送审文本变长。
func extractAuditInput(body []byte, scope string, recentN int) string {
	var peek promptAuditPeek
	if err := json.Unmarshal(body, &peek); err != nil {
		return ""
	}
	// OpenAI / Claude: messages[]
	if len(peek.Messages) > 0 {
		if scope == operation_setting.PromptAuditScopeLastUser {
			for i := len(peek.Messages) - 1; i >= 0; i-- {
				if peek.Messages[i].Role == "user" {
					return collectText(peek.Messages[i].Content)
				}
			}
			return ""
		}
		return collectMessages(peek.Messages, scope, recentN)
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

// collectMessages 汇总多条消息的文本。
// system 一律纳入（agent 的真实任务描述常写在这里）；recent 模式再补上最近 recentN 条消息，
// full 模式则纳入全部 user 消息。assistant 的回复不审——那是模型自己的输出，不是用户意图。
func collectMessages(messages []promptAuditMessage, scope string, recentN int) string {
	if recentN <= 0 {
		recentN = 4
	}
	// 先标记要纳入的下标，再按原始顺序拼接，保证上下文顺序可读
	picked := make([]bool, len(messages))
	for i, m := range messages {
		switch m.Role {
		case "system", "developer":
			picked[i] = true
		case "user":
			if scope == operation_setting.PromptAuditScopeFull {
				picked[i] = true
			}
		}
	}
	if scope == operation_setting.PromptAuditScopeRecent {
		for i := len(messages) - 1; i >= 0 && recentN > 0; i-- {
			if messages[i].Role == "assistant" {
				continue
			}
			if !picked[i] {
				picked[i] = true
			}
			recentN--
		}
	}

	var sb strings.Builder
	for i, m := range messages {
		if !picked[i] {
			continue
		}
		text := collectText(m.Content)
		if strings.TrimSpace(text) == "" {
			continue
		}
		// 标注角色，让审核模型能区分「系统设定」与「用户这次说的话」
		sb.WriteString("[")
		sb.WriteString(m.Role)
		sb.WriteString("] ")
		sb.WriteString(text)
		sb.WriteString("\n\n")
	}
	return strings.TrimSpace(sb.String())
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
