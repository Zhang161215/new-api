package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
)

func upstreamErr(status int, code any, typ, msg string) *types.NewAPIError {
	return types.WithOpenAIError(types.OpenAIError{Message: msg, Type: typ, Code: code}, status)
}

func TestClassifyRelayError(t *testing.T) {
	cases := []struct {
		name      string
		err       *types.NewAPIError
		category  string
		retryable bool
	}{
		{"上游余额不足 403", upstreamErr(403, "", "", "insufficient balance"), ErrCategoryUpstreamError, true},
		{"上游余额不足 400", upstreamErr(400, nil, "", "Insufficient account balance, please recharge"), ErrCategoryUpstreamError, true},
		{"上游 new-api 的用户余额不足", upstreamErr(403, "insufficient_user_quota", "new_api_error", "用户额度不足"), ErrCategoryUpstreamError, true},
		{"上游 402", upstreamErr(402, nil, "", "payment required"), ErrCategoryUpstreamError, true},
		{"上游 451 西语拒绝", upstreamErr(451, nil, "", "Lo siento, no puedo ayudar con esa solicitud"), ErrCategoryContentPolicy, false},
		{"上游 400 提示词被拒", upstreamErr(400, nil, "", "提示词被上游拒绝，请修改后重试"), ErrCategoryContentPolicy, false},
		{"OpenAI 安全系统", upstreamErr(400, "content_policy_violation", "invalid_request_error", "Your request was rejected as a result of our safety system."), ErrCategoryContentPolicy, false},
		{"上游 503 繁忙", upstreamErr(503, nil, "", "当前线路都在忙，请稍后再试"), ErrCategoryUpstreamError, true},
		{"上游 520", upstreamErr(520, nil, "", "bad response status code 520"), ErrCategoryUpstreamError, true},
		{"上游 500", upstreamErr(500, "server_error", "", "internal error"), ErrCategoryUpstreamError, true},
		{"上游 504", upstreamErr(504, nil, "", "gateway timeout"), ErrCategoryUpstreamTimeout, true},
		{"上游 524", upstreamErr(524, nil, "", "a timeout occurred"), ErrCategoryUpstreamTimeout, true},
		{"上游 429", upstreamErr(429, "rate_limit_exceeded", "", "Rate limit reached"), ErrCategoryRateLimited, true},
		{"上游 401 渠道 key 失效", upstreamErr(401, "invalid_api_key", "", "Incorrect API key provided"), ErrCategoryUpstreamError, true},
		{"上下文超长", upstreamErr(400, "context_length_exceeded", "invalid_request_error", "This model's maximum context length is 128000 tokens"), ErrCategoryInvalidRequest, false},
		{"参数错误", upstreamErr(400, nil, "", "size must be one of 1024x1024"), ErrCategoryInvalidRequest, false},
		{"用户余额不足", types.NewErrorWithStatusCode(errors.New("用户额度不足"), types.ErrorCodeInsufficientUserQuota, http.StatusForbidden), ErrCategoryInsufficientQuota, false},
		{"令牌额度预扣失败", types.NewErrorWithStatusCode(errors.New("token quota"), types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden), ErrCategoryInsufficientQuota, false},
		{"无可用渠道", types.NewError(errors.New("no channel"), types.ErrorCodeGetChannelFailed), ErrCategoryNoAvailableChannel, true},
		{"敏感词", types.NewErrorWithStatusCode(errors.New("sensitive"), types.ErrorCodeSensitiveWordsDetected, http.StatusBadRequest), ErrCategoryContentPolicy, false},
		{"请求上游失败（超时）", types.NewOpenAIError(errors.New("Post \"https://x\": context deadline exceeded"), types.ErrorCodeDoRequestFailed, http.StatusInternalServerError), ErrCategoryUpstreamTimeout, true},
		{"请求上游失败（断连）", types.NewOpenAIError(errors.New("connection reset by peer"), types.ErrorCodeDoRequestFailed, http.StatusInternalServerError), ErrCategoryUpstreamError, true},
		{"上游空响应", types.NewOpenAIError(errors.New("empty response"), types.ErrorCodeEmptyResponse, http.StatusInternalServerError), ErrCategoryUpstreamError, true},
		{"首字超时", types.NewErrorWithStatusCode(errors.New("too slow"), types.ErrorCodeChannelResponseTimeExceeded, http.StatusGatewayTimeout), ErrCategoryUpstreamTimeout, true},
		{"请求体读不了", types.NewErrorWithStatusCode(errors.New("bad body"), types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest), ErrCategoryInvalidRequest, false},
		{"数据库错误", types.NewErrorWithStatusCode(errors.New("db"), types.ErrorCodeQueryDataError, http.StatusInternalServerError), ErrCategoryServerError, true},
		{"nil", nil, ErrCategoryServerError, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyRelayError(tc.err)
			if got.Category != tc.category || got.Retryable != tc.retryable {
				t.Fatalf("got %+v, want %s/%v", got, tc.category, tc.retryable)
			}
		})
	}
}

func TestClassifyLocalError(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		code      types.ErrorCode
		msg       string
		category  string
		retryable bool
	}{
		{"令牌无效", 401, "", "无效的令牌", ErrCategoryAuthFailed, false},
		{"分组无权限", 403, "", "该令牌无权访问分组", ErrCategoryPermissionDenied, false},
		{"IP 不允许", 403, types.ErrorCodeAccessDenied, "IP 不在白名单", ErrCategoryPermissionDenied, false},
		{"额度用尽", 403, "", "令牌额度已用尽", ErrCategoryInsufficientQuota, false},
		{"限流", 429, "", "您已达到请求数限制", ErrCategoryRateLimited, true},
		{"无可用渠道", 503, types.ErrorCodeModelNotFound, "当前分组下对于模型无可用渠道", ErrCategoryNoAvailableChannel, true},
		{"审核不可用", 503, "", "内容安全审核暂时不可用，请稍后再试", ErrCategoryServerError, true},
		{"审核拦截", 400, types.ErrorCodeSensitiveWordsDetected, "请求内容未通过安全审核", ErrCategoryContentPolicy, false},
		{"请求体过大", 413, "", "request body too large", ErrCategoryInvalidRequest, false},
		{"缺模型名", 400, "", "未指定模型名称", ErrCategoryInvalidRequest, false},
		{"数据库错误", 500, "", "数据库错误", ErrCategoryServerError, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyLocalError(tc.status, tc.code, tc.msg)
			if got.Category != tc.category || got.Retryable != tc.retryable {
				t.Fatalf("got %+v, want %s/%v", got, tc.category, tc.retryable)
			}
		})
	}
}

// 上游 HTML 错误页：message 不能只剩「openai_error」占位符。
func TestOpenAIErrorBodyFillsEmptyUpstreamMessage(t *testing.T) {
	e := types.WithOpenAIError(types.OpenAIError{}, 520)
	e.SetMessage("bad response status code 520")
	if got := OpenAIErrorBody(e).Message; got != "bad response status code 520" {
		t.Fatalf("message = %q", got)
	}
	if got := ClaudeErrorBody(e).Message; got != "bad response status code 520" {
		t.Fatalf("claude message = %q", got)
	}
	normal := upstreamErr(503, nil, "", "busy")
	if got := OpenAIErrorBody(normal).Message; got != "busy" {
		t.Fatalf("正常 message 被改了: %q", got)
	}
}

// 字段平铺在同一层、原有字段不变。
func TestOpenAIErrorBodyJSON(t *testing.T) {
	e := upstreamErr(451, nil, "", "Lo siento")
	b, err := common.Marshal(OpenAIErrorBody(e))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := common.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"message", "type", "param", "code", "category", "retryable"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("缺字段 %s: %s", k, b)
		}
	}
	if m["category"] != ErrCategoryContentPolicy || m["retryable"] != false {
		t.Fatalf("内容不对: %s", b)
	}
	cb, _ := common.Marshal(ClaudeErrorBody(e))
	var cm map[string]any
	_ = common.Unmarshal(cb, &cm)
	if cm["category"] != ErrCategoryContentPolicy || cm["type"] == nil {
		t.Fatalf("claude 格式不对: %s", cb)
	}
}
