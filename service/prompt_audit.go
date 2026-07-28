package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// PromptAuditGuardHeader 审核模型请求携带的标记头。
// 中间件见到该头即跳过审核，避免 base_url 指回本站时无限自我循环。
const PromptAuditGuardHeader = "X-Newapi-Prompt-Audit"

var promptAuditHTTPClient = &http.Client{}

var promptAuditFenceRe = regexp.MustCompile("(?s)```(?:json)?\\s*(\\{.*?\\})\\s*```")
var promptAuditObjRe = regexp.MustCompile(`(?s)\{.*\}`)

// TruncateRunes 按字符（而非字节）截断，避免截断多字节中文
func TruncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// 已经带有版本段的基址不再补 /v1，例如 .../v1、.../v1beta、.../paas/v4、.../api/v3
var auditVersionSegRe = regexp.MustCompile(`/v\d+[a-z]*/?$`)

// ResolveAuditURL 由基址推导出实际要请求的 chat/completions 地址。
// 管理员常只填站点根地址（如 https://example.com），少了 /v1 会拿到 HTML/404/405，
// 因此这里按约定智能补全，并把结果回显到后台便于排错。
func ResolveAuditURL(baseURL string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		return ""
	}
	if strings.HasSuffix(trimmed, "/chat/completions") {
		return trimmed
	}
	if auditVersionSegRe.MatchString(trimmed) {
		return trimmed + "/chat/completions"
	}
	return trimmed + "/v1/chat/completions"
}

// promptAuditMaxTokens 给推理留足余量，避免裁决 JSON 被截断
const promptAuditMaxTokens = 3000

// 关闭思考的判断已移到 PromptAuditSetting.ShouldDisableThinking，
// 支持 auto/always/never 三态并覆盖 deepseek 之外的推理模型（mimo/qwen/glm/kimi）。
// 原先硬编码只认 deepseek，换到 mimo 后思考没关掉，token 全被推理吃光、裁决 JSON 被截断。

// postAuditRequest 发起一次审核请求，返回 (响应体, HTTP 状态码, 传输错误)
func postAuditRequest(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	url, userInput string, disableThinking bool) ([]byte, int, error) {

	reqBody := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]string{
			{"role": "system", "content": cfg.GetPrompt()},
			{"role": "user", "content": "<user_input>\n" + userInput + "\n</user_input>"},
		},
		"stream":      false,
		"temperature": 0,
		"max_tokens":  promptAuditMaxTokens,
	}
	if disableThinking {
		reqBody["thinking"] = map[string]string{"type": "disabled"}
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(payload))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	req.Header.Set(PromptAuditGuardHeader, "1")

	resp, err := promptAuditHTTPClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	return respBytes, resp.StatusCode, nil
}

// RunPromptAudit 调用审核模型判定一段用户输入，返回 (违规置信度, 理由, 错误)。
// 相同内容直接复用缓存里的判定，不再重复调用审核模型（详见 prompt_audit_cache.go）。
//
// 主节点拿不到判定时会回退备用节点复判（若已配置）。这不只是为了可用性：
// 便宜的审核模型常带平台级内容风控，遇到最恶劣的内容（未成年人性内容等）会直接拒答，
// 若把这种拒答当普通失败走 fail-open，等于专门把最危险的请求放行了。
func RunPromptAudit(ctx context.Context, cfg *operation_setting.PromptAuditSetting, userInput string) (float64, string, error) {
	if cfg.BaseURL == "" || cfg.Model == "" {
		return 0, "", fmt.Errorf("审核节点未配置 base_url 或 model")
	}

	// 缓存指纹基于主节点配置；命中即返回，不关心当初由哪个节点判定
	cacheTTL := cfg.CacheTTL()
	var cacheKey string
	if cacheTTL > 0 {
		cacheKey = promptAuditCacheKey(cfg, userInput)
		if conf, reason, ok := getPromptAuditCache(cacheKey); ok {
			recordPromptAuditCacheStat(true)
			return conf, reason, nil
		}
		recordPromptAuditCacheStat(false)
	}

	conf, reason, err := runPromptAuditOnce(ctx, cfg, userInput, "primary")
	if err != nil && cfg.FallbackReady() {
		primaryErr := err
		recordPromptAuditFallback(PromptAuditFailKindOf(primaryErr))
		conf, reason, err = runPromptAuditOnce(ctx, cfg.FallbackConfig(), userInput, "fallback")
		if err != nil {
			// 两级都失败：带上主节点原因，否则只看到备用节点的错会误判根因
			err = fmt.Errorf("主节点失败(%v)；备用节点亦失败: %w", primaryErr, err)
		} else {
			recordPromptAuditFallbackSuccess()
		}
	}
	if err != nil {
		return 0, "", err
	}
	// 只缓存成功的判定：失败多是超时/限流等瞬时问题，缓存下来会把故障放大到整个 TTL
	if cacheKey != "" {
		setPromptAuditCache(cacheKey, conf, reason, cacheTTL)
	}
	return conf, reason, nil
}

// runPromptAuditOnce 向单个审核节点发起一次判定。
// 失败一律包成 *PromptAuditError，让上层能按失败类型决定是回退还是 fail-open。
func runPromptAuditOnce(ctx context.Context, cfg *operation_setting.PromptAuditSetting,
	userInput string, node string) (float64, string, error) {

	failf := func(kind PromptAuditFailKind, format string, args ...any) error {
		return newPromptAuditError(kind, node, cfg.Model, fmt.Errorf(format, args...))
	}

	timeout := time.Duration(cfg.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 4 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	url := ResolveAuditURL(cfg.BaseURL)

	// 推理型模型（deepseek / mimo / qwen 等）会先消耗一段推理 token 再产出内容，
	// 预算给太小会把 JSON 裁决截断（实测推理波动在 127~230 token），故给足余量。
	// 同时显式关闭思考：分类任务不需要推理，实测输出 token 从 212 降到 31。
	noThink := cfg.ShouldDisableThinking(cfg.Model)
	respBytes, status, err := postAuditRequest(reqCtx, cfg, url, userInput, noThink)
	if err != nil {
		return 0, "", failf(PromptAuditFailTransport, "%v", err)
	}
	// 若因不支持 thinking 参数被拒（部分网关），去掉该参数重试一次。
	// 注意要排除风控拒答：那种情况去掉参数重试同样会被拒，白等一轮。
	if status >= 400 && status < 500 && noThink && !looksLikeModerationRefusal(string(respBytes)) {
		respBytes, status, err = postAuditRequest(reqCtx, cfg, url, userInput, false)
		if err != nil {
			return 0, "", failf(PromptAuditFailTransport, "%v", err)
		}
	}
	if status != http.StatusOK {
		body := TruncateRunes(string(respBytes), 200)
		if looksLikeModerationRefusal(string(respBytes)) {
			return 0, "", failf(PromptAuditFailModeration,
				"审核节点风控拒答 HTTP %d: %s", status, body)
		}
		return 0, "", failf(PromptAuditFailTransport, "审核节点返回 HTTP %d: %s", status, body)
	}

	// 兼容标准 OpenAI（顶层 choices）与部分网关的 {"data":{"choices":...}} 信封
	type chatCompletion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	var completion struct {
		chatCompletion
		Data chatCompletion `json:"data"`
	}
	if err := json.Unmarshal(respBytes, &completion); err != nil {
		// 有些网关风控拒答时直接返回纯文本而非 JSON
		if looksLikeModerationRefusal(string(respBytes)) {
			return 0, "", failf(PromptAuditFailModeration, "审核节点风控拒答: %s",
				TruncateRunes(string(respBytes), 200))
		}
		return 0, "", failf(PromptAuditFailUnparsable, "审核响应解析失败: %v", err)
	}
	choices := completion.Choices
	if len(choices) == 0 {
		choices = completion.Data.Choices
	}
	if len(choices) == 0 {
		if looksLikeModerationRefusal(string(respBytes)) {
			return 0, "", failf(PromptAuditFailModeration, "审核节点风控拒答: %s",
				TruncateRunes(string(respBytes), 200))
		}
		return 0, "", failf(PromptAuditFailUnparsable, "审核响应为空")
	}
	content := choices[0].Message.Content
	conf, reason, ok := ParseAuditVerdict(content)
	if !ok {
		trimmed := strings.TrimSpace(content)
		// 平台风控拒答多数是 HTTP 200 + content 里一句自然语言，
		// 例如 mimo 的 "The request was rejected because it was considered high risk"。
		// 必须与「模型判定后给不出 JSON」区分开：前者要回退复判，后者只是格式问题。
		if looksLikeModerationRefusal(trimmed) {
			return 0, "", failf(PromptAuditFailModeration, "审核节点风控拒答: %s",
				TruncateRunes(trimmed, 200))
		}
		// 内容为空或残缺 JSON，几乎都是推理吃光 token 预算导致裁决被截断
		if trimmed == "" || !strings.Contains(trimmed, "}") {
			return 0, "", failf(PromptAuditFailUnparsable,
				"审核输出被截断（疑似模型推理占满 token 预算），已收到内容: %q。建议换非推理模型或调低送审字符数",
				TruncateRunes(trimmed, 120))
		}
		return 0, "", failf(PromptAuditFailUnparsable,
			"审核输出无法解析为 JSON 裁决: %s", TruncateRunes(content, 200))
	}
	return conf, reason, nil
}

// ParseAuditVerdict 从模型输出里解析 {"confidence":x,"reason":y}，容忍 ```json 围栏与前后赘述
func ParseAuditVerdict(content string) (float64, string, bool) {
	content = strings.TrimSpace(content)
	candidates := []string{content}
	if m := promptAuditFenceRe.FindStringSubmatch(content); len(m) == 2 {
		candidates = append([]string{m[1]}, candidates...)
	}
	if m := promptAuditObjRe.FindString(content); m != "" {
		candidates = append(candidates, m)
	}
	for _, cand := range candidates {
		// 必须显式带 confidence 字段才算有效裁决。
		// 用指针而非 float64：json.Unmarshal 对缺失字段不报错，会留下零值，
		// 于是审核模型被待审内容劫持、输出了任务结果（如物料分类的
		// {"id":5688,"name":"...","reason":"匹配类目"}）时，会被误当成
		// 「confidence=0，判定合规」静默放行——线上正是这样漏审的。
		var v struct {
			Confidence *float64 `json:"confidence"`
			Reason      string   `json:"reason"`
		}
		if err := json.Unmarshal([]byte(cand), &v); err == nil && v.Confidence != nil {
			return *v.Confidence, v.Reason, true
		}
	}
	return 0, "", false
}
