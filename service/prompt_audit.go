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

// disableThinkingFor 仅对 deepseek 系模型关闭思考（该参数为 DeepSeek 专有）
func disableThinkingFor(model string) bool {
	return strings.Contains(strings.ToLower(model), "deepseek")
}

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

// RunPromptAudit 调用审核模型判定一段用户输入，返回 (违规置信度, 理由, 错误)
func RunPromptAudit(ctx context.Context, cfg *operation_setting.PromptAuditSetting, userInput string) (float64, string, error) {
	if cfg.BaseURL == "" || cfg.Model == "" {
		return 0, "", fmt.Errorf("审核节点未配置 base_url 或 model")
	}
	timeout := time.Duration(cfg.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 4 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	url := ResolveAuditURL(cfg.BaseURL)

	// 推理型模型（如 deepseek-v4-flash）会先消耗一段推理 token 再产出内容，
	// 预算给太小会把 JSON 裁决截断（实测推理波动在 127~230 token），故给足余量。
	// 同时对 deepseek 系模型显式关闭思考：分类任务不需要推理，实测输出 token 从 212 降到 31。
	respBytes, status, err := postAuditRequest(reqCtx, cfg, url, userInput, disableThinkingFor(cfg.Model))
	if err != nil {
		return 0, "", err
	}
	// 若因不支持 thinking 参数被拒（非 deepseek 网关），去掉该参数重试一次
	if status >= 400 && status < 500 && disableThinkingFor(cfg.Model) {
		respBytes, status, err = postAuditRequest(reqCtx, cfg, url, userInput, false)
		if err != nil {
			return 0, "", err
		}
	}
	if status != http.StatusOK {
		return 0, "", fmt.Errorf("审核节点返回 HTTP %d: %s", status, TruncateRunes(string(respBytes), 200))
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
		return 0, "", fmt.Errorf("审核响应解析失败: %w", err)
	}
	choices := completion.Choices
	if len(choices) == 0 {
		choices = completion.Data.Choices
	}
	if len(choices) == 0 {
		return 0, "", fmt.Errorf("审核响应为空")
	}
	content := choices[0].Message.Content
	conf, reason, ok := ParseAuditVerdict(content)
	if !ok {
		// 内容为空或残缺的 JSON，几乎都是推理吃光了 token 预算导致裁决被截断，
		// 明确点出原因，避免又要翻容器日志才能定位
		trimmed := strings.TrimSpace(content)
		if trimmed == "" || !strings.Contains(trimmed, "}") {
			return 0, "", fmt.Errorf("审核输出被截断（疑似模型推理占满 token 预算），已收到内容: %q。建议换非推理模型或调低送审字符数", TruncateRunes(trimmed, 120))
		}
		return 0, "", fmt.Errorf("审核输出无法解析为 JSON 裁决: %s", TruncateRunes(content, 200))
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
		var v struct {
			Confidence float64 `json:"confidence"`
			Reason     string  `json:"reason"`
		}
		if err := json.Unmarshal([]byte(cand), &v); err == nil {
			return v.Confidence, v.Reason, true
		}
	}
	return 0, "", false
}
