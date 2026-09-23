package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// 模型广场可用率依赖 handler 标记协议终态：流在终态事件前 EOF 必须能被识别为截断。
func newTerminalTestContext(t *testing.T, path string, body string) (*gin.Context, *http.Response, *relaycommon.RelayInfo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	old := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = old })
	service.InitTokenEncoders()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, path, nil)
	resp := &http.Response{Body: io.NopCloser(strings.NewReader(body))}
	info := &relaycommon.RelayInfo{
		IsStream:    true,
		RelayFormat: types.RelayFormatOpenAI,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
	}
	return c, resp, info
}

func TestResponsesStreamMarksTerminal(t *testing.T) {
	cases := []struct {
		name string
		body string
		want relaycommon.ResponseOutcome
	}{
		{"completed", "data: {\"type\":\"response.created\",\"response\":{\"status\":\"in_progress\"}}\n" +
			"data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n" +
			"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":1,\"total_tokens\":4}}}\n",
			relaycommon.ResponseOutcomeCompleted},
		{"truncated", "data: {\"type\":\"response.created\",\"response\":{\"status\":\"in_progress\"}}\n" +
			"data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n",
			relaycommon.ResponseOutcomeUnknown},
		{"failed", "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"code\":\"server_error\",\"message\":\"x\"}}}\n",
			relaycommon.ResponseOutcomeFailed},
		{"incomplete", "data: {\"type\":\"response.incomplete\",\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n",
			relaycommon.ResponseOutcomeIncomplete},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, resp, info := newTerminalTestContext(t, "/v1/responses", tc.body)
			_, apiErr := OaiResponsesStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			got := info.StreamStatus.OutcomeSnapshot()
			require.True(t, got.ExpectsTerminal)
			require.Equal(t, tc.want, got.Response)
			if tc.name == "incomplete" {
				require.Equal(t, "max_output_tokens", got.IncompleteReason)
			}
			if tc.name == "failed" {
				require.Equal(t, "server_error", got.ErrorCode)
			}
		})
	}
}

func TestChatStreamMarksTerminal(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		want       relaycommon.ResponseOutcome
		wantReason relaycommon.StreamEndReason
		rejection  bool
	}{
		{"finish reason without done", "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n" +
			"data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n",
			relaycommon.ResponseOutcomeCompleted, relaycommon.StreamEndReasonEOF, false},
		{"done marker", "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n" +
			"data: [DONE]\n",
			relaycommon.ResponseOutcomeUnknown, relaycommon.StreamEndReasonDone, false},
		{"truncated", "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n",
			relaycommon.ResponseOutcomeUnknown, relaycommon.StreamEndReasonEOF, false},
		{"content filter", "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"content_filter\"}]}\n",
			relaycommon.ResponseOutcomeCompleted, relaycommon.StreamEndReasonEOF, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, resp, info := newTerminalTestContext(t, "/v1/chat/completions", tc.body)
			_, apiErr := OaiStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			got := info.StreamStatus.OutcomeSnapshot()
			require.True(t, got.ExpectsTerminal)
			require.Equal(t, tc.want, got.Response)
			require.Equal(t, tc.wantReason, got.EndReason)
			require.Equal(t, tc.rejection, info.PerformanceBusinessRejection)
		})
	}
}
