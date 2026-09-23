package perfmetrics

import (
	"context"
	"errors"
	"strings"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

type Outcome string

const (
	OutcomeSuccess Outcome = "success"
	OutcomeFailure Outcome = "failure"
	OutcomeIgnored Outcome = "ignored"
)

// ClassifyRelayOutcome 判断一次已结束的请求算不算健康样本。
// 业务拒绝、客户端取消、用户侧参数/额度错误不进分母；与重试、禁用渠道、计费无关。
// 移植自上游，流式请求结合协议终态（ResponseOutcome）判断：没等到终态就 EOF 的流算截断失败。
func ClassifyRelayOutcome(ctx context.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) Outcome {
	if info == nil || info.PerformanceBusinessRejection {
		return OutcomeIgnored
	}
	if apiErr != nil && errors.Is(apiErr, context.Canceled) {
		return OutcomeIgnored
	}
	stream := info.StreamStatus.OutcomeSnapshot()
	if stream.Response == relaycommon.ResponseOutcomeFailed {
		return classifyFailure(false, stream.ErrorCode, stream.ErrorType, stream.ErrorStatus)
	}
	if apiErr != nil {
		// 只在出错时看客户端是否已离开。成功的非流式响应在 handler 里就写完了，客户端读完即断开，
		// ctx 随之被取消——上游在这里一律判"忽略"，会把成功请求漏掉（本地联调实测非流式成功 0 条入库）。
		// 错误响应由最外层 defer 写出、晚于采样，所以此刻 ctx 已取消只可能是客户端在拿到结果前就走了。
		if errors.Is(apiErr, context.Canceled) || (ctx != nil && ctx.Err() == context.Canceled) {
			return OutcomeIgnored
		}
		root := rootAPIError(apiErr)
		local := root.GetErrorType() == types.ErrorTypeNewAPIError
		return classifyFailure(local, string(root.GetErrorCode()), string(root.ToOpenAIError().Type), root.StatusCode)
	}

	if info.StreamStatus == nil {
		return OutcomeSuccess
	}
	deadlineExceeded := errors.Is(info.StreamStatus.EndError, context.DeadlineExceeded)
	if stream.Response == relaycommon.ResponseOutcomeCancelled || stream.EndReason == relaycommon.StreamEndReasonPingFail {
		return OutcomeIgnored
	}
	if stream.EndReason == relaycommon.StreamEndReasonClientGone && !deadlineExceeded {
		return OutcomeIgnored
	}
	if stream.Response == relaycommon.ResponseOutcomeIncomplete {
		switch stream.IncompleteReason {
		case "max_output_tokens", "max_tokens":
			return OutcomeSuccess
		case "content_filter", "safety", "content_policy_violation":
			return OutcomeIgnored
		default:
			return OutcomeFailure
		}
	}
	if stream.HasErrors || deadlineExceeded {
		return OutcomeFailure
	}
	switch stream.EndReason {
	case relaycommon.StreamEndReasonTimeout, relaycommon.StreamEndReasonScannerErr, relaycommon.StreamEndReasonPanic:
		return OutcomeFailure
	}
	if stream.ExpectsTerminal && stream.Response == relaycommon.ResponseOutcomeUnknown && stream.EndReason != relaycommon.StreamEndReasonDone {
		return OutcomeFailure
	}
	return OutcomeSuccess
}

// rootAPIError 顺着包装找到真正描述问题的那层错误，例如被本地重新包装成 invalid_request 的上游凭据错误。
func rootAPIError(apiErr *types.NewAPIError) *types.NewAPIError {
	for {
		var inner *types.NewAPIError
		if !errors.As(apiErr.Unwrap(), &inner) || inner == apiErr {
			return apiErr
		}
		apiErr = inner
	}
}

func classifyFailure(local bool, code, errorType string, status int) Outcome {
	code, errorType = strings.ToLower(code), strings.ToLower(errorType)
	if local {
		if strings.HasPrefix(code, "violation_fee.") {
			return OutcomeIgnored
		}
		switch types.ErrorCode(code) {
		case types.ErrorCodeInvalidRequest, types.ErrorCodeSensitiveWordsDetected, types.ErrorCodeReadRequestBodyFailed,
			types.ErrorCodeConvertRequestFailed, types.ErrorCodeAccessDenied, types.ErrorCodeBadRequestBody,
			types.ErrorCodeInsufficientUserQuota, types.ErrorCodePreConsumeTokenQuotaFailed, types.ErrorCodePromptBlocked:
			return OutcomeIgnored
		}
		return OutcomeFailure
	}
	// 具体错误码优先于宽泛的协议类型：有些上游把凭据失效也报成 invalid_request_error。
	for _, value := range []string{code, errorType} {
		switch value {
		case "invalid_api_key", "api_key_invalid", "api_key_expired", "api_key_service_blocked", "invalid_authentication",
			"authentication_error", "unauthenticated", "permission_denied", "permission_error", "access_denied",
			"insufficient_quota", "quota_exceeded", "resource_exhausted", "rate_limit_exceeded", "rate_limit_error",
			"overloaded_error", "server_error", "internal_error", "service_unavailable", "model_not_found",
			"insufficient_user_quota", "pre_consume_token_quota_failed":
			return OutcomeFailure
		case "context_length_exceeded", "invalid_request", "invalid_request_error", "invalid_argument",
			"sensitive_words_detected", "prompt_blocked", "content_filter", "content_policy_violation", "safety":
			return OutcomeIgnored
		}
		if strings.HasPrefix(value, "violation_fee.") {
			return OutcomeIgnored
		}
	}
	switch status {
	case 400, 405, 409, 413, 415, 422:
		return OutcomeIgnored
	}
	return OutcomeFailure
}
