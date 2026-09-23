package claude

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestClaudeStreamMarksTerminal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	old := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = old })

	start := "data: {\"type\":\"message_start\",\"message\":{\"id\":\"m\",\"model\":\"claude-test\",\"usage\":{\"input_tokens\":3,\"output_tokens\":1}}}\n" +
		"data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n"
	cases := []struct {
		name string
		body string
		want relaycommon.ResponseOutcome
	}{
		{"message stop", start +
			"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n" +
			"data: {\"type\":\"message_stop\"}\n", relaycommon.ResponseOutcomeCompleted},
		{"truncated", start, relaycommon.ResponseOutcomeUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
			resp := &http.Response{Body: io.NopCloser(strings.NewReader(tc.body))}
			info := &relaycommon.RelayInfo{
				IsStream:    true,
				RelayFormat: types.RelayFormatClaude,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-test"},
			}
			_, apiErr := ClaudeStreamHandler(c, resp, info)
			require.Nil(t, apiErr)
			got := info.StreamStatus.OutcomeSnapshot()
			require.True(t, got.ExpectsTerminal)
			require.Equal(t, tc.want, got.Response)
		})
	}
}
