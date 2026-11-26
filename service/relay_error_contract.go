package service

// 本站：对外错误契约。
// 所有 OpenAI / Claude 格式的错误在原有字段（message / type / param / code）之外再带两个固定字段：
//   - category：固定枚举，见下面的 ErrCategory*；
//   - retryable：客户端是否应该重试（换个时间或换个请求再发）。
// 上游报错五花八门（多国语言的审核拒绝、上游余额不足、线路繁忙、520……），客户端只看这两个字段就能决定
// 重试 / 改提示词 / 充值，不用去匹配报错文字。字段只增不改，原有 SDK 会忽略多出来的字段。

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/relaykit/types"
)

const (
	ErrCategoryInvalidRequest     = "invalid_request"      // 请求参数有误（含超出上下文、不支持的参数）
	ErrCategoryContentPolicy      = "content_policy"       // 提示词 / 内容被审核拒绝，需改内容
	ErrCategoryAuthFailed         = "auth_failed"          // 令牌无效
	ErrCategoryPermissionDenied   = "permission_denied"    // 令牌无权使用该模型 / 分组，用户被封禁等
	ErrCategoryInsufficientQuota  = "insufficient_quota"   // 账户或令牌余额不足，需充值
	ErrCategoryRateLimited        = "rate_limited"         // 触发限流
	ErrCategoryNoAvailableChannel = "no_available_channel" // 当前没有可用渠道
	ErrCategoryUpstreamError      = "upstream_error"       // 上游出错（含上游余额不足、繁忙、5xx、520）
	ErrCategoryUpstreamTimeout    = "upstream_timeout"     // 上游超时
	ErrCategoryNetworkError       = "network_error"        // 网络传输问题（如请求体上传超时）
	ErrCategoryServerError        = "server_error"         // 本站内部错误
)

// ErrorContract 嵌进错误对象里一起序列化。
type ErrorContract struct {
	Category  string `json:"category"`
	Retryable bool   `json:"retryable"`
}

func contractOf(category string) ErrorContract {
	switch category {
	case ErrCategoryRateLimited, ErrCategoryNoAvailableChannel, ErrCategoryUpstreamError,
		ErrCategoryUpstreamTimeout, ErrCategoryNetworkError, ErrCategoryServerError:
		return ErrorContract{Category: category, Retryable: true}
	}
	return ErrorContract{Category: category, Retryable: false}
}

// 上游审核拒绝的常见说法（统一转小写后匹配）。多国语言的拒绝一般带 451，靠状态码识别。
var contentPolicyKeywords = []string{
	"content_policy", "content policy", "content management policy", "safety system", "safety_violation",
	"guardrail", "violat", "moderation", "unsafe content", "prompt_blocked", "blocked by",
	"提示词被上游拒绝", "违反", "内容政策", "内容安全", "审核未通过", "违规", "敏感",
}

func looksLikeContentPolicy(message string) bool {
	lower := strings.ToLower(message)
	for _, k := range contentPolicyKeywords {
		if strings.Contains(lower, k) {
			return true
		}
	}
	return false
}

// 上游（我们的渠道）余额 / 额度不足。用户自己的余额不足是本站错误码，前面已经分走了。
var upstreamBillingKeywords = []string{
	"insufficient balance", "insufficient account balance", "insufficient_quota", "insufficient quota",
	"exceeded your current quota", "billing", "credit balance", "余额不足", "额度不足", "欠费",
}

func looksLikeUpstreamBilling(message string) bool {
	lower := strings.ToLower(message)
	for _, k := range upstreamBillingKeywords {
		if strings.Contains(lower, k) {
			return true
		}
	}
	return false
}

func looksLikeTimeout(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "timeout") || strings.Contains(lower, "timed out") ||
		strings.Contains(lower, "deadline exceeded") || strings.Contains(lower, "超时")
}

// 本站自己产生的错误码（不是上游透传的）。
func categoryByLocalCode(code types.ErrorCode) (string, bool) {
	switch code {
	case types.ErrorCodeInsufficientUserQuota, types.ErrorCodePreConsumeTokenQuotaFailed:
		return ErrCategoryInsufficientQuota, true
	case types.ErrorCodeAccessDenied:
		return ErrCategoryPermissionDenied, true
	case types.ErrorCodeSensitiveWordsDetected, types.ErrorCodePromptBlocked,
		types.ErrorCodeRequestRejected, types.ErrorCodeResponseRejected:
		return ErrCategoryContentPolicy, true
	case types.ErrorCodeInvalidRequest, types.ErrorCodeReadRequestBodyFailed, types.ErrorCodeConvertRequestFailed,
		types.ErrorCodeBadRequestBody, types.ErrorCodeInvalidApiType, types.ErrorCodeModelPriceError:
		return ErrCategoryInvalidRequest, true
	case types.ErrorCodeGetChannelFailed, types.ErrorCodeModelNotFound, types.ErrorCodeChannelNoAvailableKey:
		return ErrCategoryNoAvailableChannel, true
	case types.ErrorCodeChannelResponseTimeExceeded:
		return ErrCategoryUpstreamTimeout, true
	case types.ErrorCodeQueryDataError, types.ErrorCodeUpdateDataError, types.ErrorCodeJsonMarshalFailed,
		types.ErrorCodeGenRelayInfoFailed, types.ErrorCodeCountTokenFailed, types.ErrorCodeRequestPluginFailed:
		return ErrCategoryServerError, true
	}
	if IsViolationFeeCode(code) {
		return ErrCategoryContentPolicy, true
	}
	return "", false
}

// ClassifyRelayError 给转发链路上的最终错误分类（上游透传的错误按状态码 + 报错文字判断）。
func ClassifyRelayError(e *types.NewAPIError) ErrorContract {
	if e == nil {
		return contractOf(ErrCategoryServerError)
	}
	code := e.GetErrorCode()
	if category, ok := categoryByLocalCode(code); ok {
		// 余额不足 / 无权限只认本站自己产生的（new_api_error）。上游如果也是 new-api，
		// 它返回的 insufficient_user_quota 指的是我们在上游的账户，属于上游出错，不是让用户充值。
		if (category == ErrCategoryInsufficientQuota || category == ErrCategoryPermissionDenied) &&
			e.GetErrorType() != types.ErrorTypeNewAPIError {
			return contractOf(ErrCategoryUpstreamError)
		}
		return contractOf(category)
	}
	status := e.StatusCode
	// 上游透传的错误把它自己的 code / type 也算进去（如 content_policy_violation）。
	message := e.Error()
	if e.GetErrorType() == types.ErrorTypeOpenAIError {
		if oai, ok := e.RelayError.(types.OpenAIError); ok {
			message = fmt.Sprintf("%v %s %s %s", oai.Code, oai.Type, oai.Message, message)
		}
	}
	switch {
	case status == http.StatusUnavailableForLegalReasons:
		return contractOf(ErrCategoryContentPolicy)
	case status >= 400 && status < 500 && status != http.StatusTooManyRequests && looksLikeContentPolicy(message):
		return contractOf(ErrCategoryContentPolicy)
	case status == http.StatusTooManyRequests:
		return contractOf(ErrCategoryRateLimited)
	case status == http.StatusRequestTimeout || status == http.StatusGatewayTimeout || status == 524:
		return contractOf(ErrCategoryUpstreamTimeout)
	case code == types.ErrorCodeDoRequestFailed && looksLikeTimeout(message):
		return contractOf(ErrCategoryUpstreamTimeout)
	case status >= 400 && status < 500 && looksLikeUpstreamBilling(message):
		return contractOf(ErrCategoryUpstreamError)
	case status == http.StatusUnauthorized || status == http.StatusPaymentRequired ||
		status == http.StatusForbidden || status == http.StatusNotFound:
		// 走到这里的 401/402/403/404 是上游给我们渠道的（渠道 key 失效、上游余额不足、上游没有这个模型），
		// 不是用户自己的问题，换个渠道或稍后重试可能就好。
		return contractOf(ErrCategoryUpstreamError)
	case status >= 400 && status < 500:
		return contractOf(ErrCategoryInvalidRequest)
	case status >= 500 || status == 0:
		return contractOf(ErrCategoryUpstreamError)
	}
	return contractOf(ErrCategoryServerError)
}

// ClassifyLocalError 给中间件（鉴权、分发、限流）直接返回的错误分类。
func ClassifyLocalError(status int, code types.ErrorCode, message string) ErrorContract {
	if category, ok := categoryByLocalCode(code); ok {
		return contractOf(category)
	}
	lower := strings.ToLower(message)
	switch {
	case status == http.StatusUnauthorized:
		return contractOf(ErrCategoryAuthFailed)
	case status == http.StatusForbidden && (strings.Contains(message, "额度") || strings.Contains(message, "余额") ||
		strings.Contains(lower, "quota") || strings.Contains(lower, "balance")):
		return contractOf(ErrCategoryInsufficientQuota)
	case status == http.StatusForbidden:
		return contractOf(ErrCategoryPermissionDenied)
	case status == http.StatusTooManyRequests:
		return contractOf(ErrCategoryRateLimited)
	case status == http.StatusServiceUnavailable && (strings.Contains(lower, "no available channel") ||
		strings.Contains(message, "无可用渠道") || strings.Contains(message, "没有可用")):
		return contractOf(ErrCategoryNoAvailableChannel)
	case status >= 500:
		return contractOf(ErrCategoryServerError)
	case status >= 400:
		return contractOf(ErrCategoryInvalidRequest)
	}
	return contractOf(ErrCategoryServerError)
}

// OpenAIErrorWithContract / ClaudeErrorWithContract：原错误对象 + 契约字段（嵌入后 JSON 平铺在同一层）。
type OpenAIErrorWithContract struct {
	types.OpenAIError
	ErrorContract
}

type ClaudeErrorWithContract struct {
	types.ClaudeError
	ErrorContract
}

// OpenAIErrorBody 代替 e.ToOpenAIError(...) 写给客户端。
func OpenAIErrorBody(e *types.NewAPIError, upstreamURLs ...string) OpenAIErrorWithContract {
	body := e.ToOpenAIError(upstreamURLs...)
	body.Message = fillPlaceholderMessage(e, body.Message, upstreamURLs...)
	return OpenAIErrorWithContract{OpenAIError: body, ErrorContract: ClassifyRelayError(e)}
}

// ClaudeErrorBody 代替 e.ToClaudeError(...) 写给客户端。
func ClaudeErrorBody(e *types.NewAPIError, upstreamURLs ...string) ClaudeErrorWithContract {
	body := e.ToClaudeError(upstreamURLs...)
	body.Message = fillPlaceholderMessage(e, body.Message, upstreamURLs...)
	return ClaudeErrorWithContract{ClaudeError: body, ErrorContract: ClassifyRelayError(e)}
}

// 上游返回 HTML 错误页（如 520）时，透传的错误对象里 message 是空的，ToOpenAIError 只能填一个
// 「openai_error」占位符；真正的原因（bad response status code 520）在 e.Err 里，补回去。
func fillPlaceholderMessage(e *types.NewAPIError, message string, upstreamURLs ...string) string {
	if message != string(e.GetErrorType()) {
		return message
	}
	if detail := e.MaskSensitiveError(upstreamURLs...); detail != "" {
		return detail
	}
	return message
}
