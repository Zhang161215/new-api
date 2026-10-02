package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func testStreamRelay(reason relaycommon.StreamEndReason) *relaycommon.RelayInfo {
	info := &relaycommon.RelayInfo{
		IsStream:        true,
		OriginModelName: "claude-opus-5-5",
		StartTime:       time.Now(),
		StreamStatus:    relaycommon.NewStreamStatus(),
		PriceData: types.PriceData{
			ModelRatio:      1,
			CompletionRatio: 1,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
		},
	}
	info.StreamStatus.SetEndReason(reason, nil)
	return info
}

func TestShouldWaiveFailedStreamBilling(t *testing.T) {
	localPrompt := &dto.Usage{PromptTokens: 10000, CompletionTokens: 0, TotalTokens: 10000}
	localWithOutput := &dto.Usage{PromptTokens: 10000, CompletionTokens: 20, TotalTokens: 10020}
	upstreamPrompt := &dto.Usage{PromptTokens: 8000, CompletionTokens: 0, TotalTokens: 8000}
	upstreamFull := &dto.Usage{PromptTokens: 8000, CompletionTokens: 50, TotalTokens: 8050}

	tests := []struct {
		name          string
		info          *relaycommon.RelayInfo
		usage         *dto.Usage
		localEstimate bool
		wantWaive     bool
		wantReason    string
	}{
		{
			name:      "non-stream",
			info:      &relaycommon.RelayInfo{IsStream: false},
			usage:     localPrompt,
			wantWaive: false,
		},
		{
			name:      "nil stream status",
			info:      &relaycommon.RelayInfo{IsStream: true},
			usage:     localPrompt,
			wantWaive: false,
		},
		{
			name:      "normal eof",
			info:      testStreamRelay(relaycommon.StreamEndReasonEOF),
			usage:     localPrompt,
			wantWaive: false,
		},
		{
			name:      "normal done",
			info:      testStreamRelay(relaycommon.StreamEndReasonDone),
			usage:     localPrompt,
			wantWaive: false,
		},
		{
			name:          "client_gone no output local estimate",
			info:          testStreamRelay(relaycommon.StreamEndReasonClientGone),
			usage:         localPrompt,
			localEstimate: true,
			wantWaive:     true,
			wantReason:    failedStreamWaiverClientGone,
		},
		{
			name:          "client_gone no output even with upstream prompt",
			info:          testStreamRelay(relaycommon.StreamEndReasonClientGone),
			usage:         upstreamPrompt,
			localEstimate: false,
			wantWaive:     true,
			wantReason:    failedStreamWaiverClientGone,
		},
		{
			name:          "client_gone with output keeps charge",
			info:          testStreamRelay(relaycommon.StreamEndReasonClientGone),
			usage:         localWithOutput,
			localEstimate: true,
			wantWaive:     false,
		},
		{
			name:          "scanner_error local estimate no output",
			info:          testStreamRelay(relaycommon.StreamEndReasonScannerErr),
			usage:         localPrompt,
			localEstimate: true,
			wantWaive:     true,
			wantReason:    failedStreamWaiverNoUsage,
		},
		{
			name:          "scanner_error local estimate with partial output still waived",
			info:          testStreamRelay(relaycommon.StreamEndReasonScannerErr),
			usage:         localWithOutput,
			localEstimate: true,
			wantWaive:     true,
			wantReason:    failedStreamWaiverNoUsage,
		},
		{
			name:          "scanner_error real upstream usage billed",
			info:          testStreamRelay(relaycommon.StreamEndReasonScannerErr),
			usage:         upstreamFull,
			localEstimate: false,
			wantWaive:     false,
		},
		{
			name:          "timeout local estimate waived",
			info:          testStreamRelay(relaycommon.StreamEndReasonTimeout),
			usage:         localPrompt,
			localEstimate: true,
			wantWaive:     true,
			wantReason:    failedStreamWaiverNoUsage,
		},
		{
			name:          "panic local estimate waived",
			info:          testStreamRelay(relaycommon.StreamEndReasonPanic),
			usage:         localPrompt,
			localEstimate: true,
			wantWaive:     true,
			wantReason:    failedStreamWaiverNoUsage,
		},
		{
			name:          "nil usage client_gone waived",
			info:          testStreamRelay(relaycommon.StreamEndReasonClientGone),
			usage:         nil,
			localEstimate: true,
			wantWaive:     true,
			wantReason:    failedStreamWaiverClientGone,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, reason := ShouldWaiveFailedStreamBilling(tt.info, tt.usage, tt.localEstimate)
			require.Equal(t, tt.wantWaive, got)
			require.Equal(t, tt.wantReason, reason)
		})
	}
}

func TestFailedStreamWaiverZerosEstimatedQuota(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	info := testStreamRelay(relaycommon.StreamEndReasonClientGone)
	info.SetEstimatePromptTokens(50000)
	usage := &dto.Usage{PromptTokens: 50000, CompletionTokens: 0, TotalTokens: 50000}

	charged := calculateTextQuotaSummary(ctx, info, usage)
	require.Greater(t, charged.Quota, 0)

	waive, _ := ShouldWaiveFailedStreamBilling(info, usage, true)
	require.True(t, waive)
	zeroed := calculateTextQuotaSummary(ctx, info, &dto.Usage{})
	require.Equal(t, 0, zeroed.Quota)
	require.Equal(t, 0, zeroed.TotalTokens)
}
