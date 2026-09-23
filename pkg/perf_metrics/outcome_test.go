package perfmetrics

import (
	"context"
	"errors"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

func canceledCtx() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

func streamInfo(reason relaycommon.StreamEndReason, endErr error, softErrors int) *relaycommon.RelayInfo {
	st := relaycommon.NewStreamStatus()
	st.SetEndReason(reason, endErr)
	for i := 0; i < softErrors; i++ {
		st.RecordError("chunk error")
	}
	return &relaycommon.RelayInfo{IsStream: true, StreamStatus: st}
}

// terminalInfo 模拟声明了协议终态的流：mark 为 nil 表示直到结束都没收到终态事件。
func terminalInfo(reason relaycommon.StreamEndReason, mark func(*relaycommon.StreamStatus)) *relaycommon.RelayInfo {
	info := streamInfo(reason, nil, 0)
	if mark != nil {
		mark(info.StreamStatus)
	}
	info.StreamStatus.RequireTerminal()
	return info
}

func upstreamErr(status int, errType string, code any) *types.NewAPIError {
	return types.WithOpenAIError(types.OpenAIError{Message: "x", Type: errType, Code: code}, status)
}

func TestClassifyRelayOutcome(t *testing.T) {
	cases := []struct {
		name string
		ctx  context.Context
		info *relaycommon.RelayInfo
		err  *types.NewAPIError
		want Outcome
	}{
		{"non-stream success", context.Background(), &relaycommon.RelayInfo{}, nil, OutcomeSuccess},
		// 响应已写完、客户端读完就断开：仍然是成功
		{"success then client closed", canceledCtx(), &relaycommon.RelayInfo{}, nil, OutcomeSuccess},
		{"error after client left", canceledCtx(), &relaycommon.RelayInfo{}, upstreamErr(500, "server_error", nil), OutcomeIgnored},
		{"wrapped context canceled", context.Background(), &relaycommon.RelayInfo{},
			types.NewError(context.Canceled, types.ErrorCodeDoRequestFailed), OutcomeIgnored},
		{"upstream 500", context.Background(), &relaycommon.RelayInfo{}, upstreamErr(500, "server_error", nil), OutcomeFailure},
		{"upstream 502 no type", context.Background(), &relaycommon.RelayInfo{}, upstreamErr(502, "", nil), OutcomeFailure},
		{"upstream 429", context.Background(), &relaycommon.RelayInfo{}, upstreamErr(429, "rate_limit_error", "rate_limit_exceeded"), OutcomeFailure},
		{"upstream 400 invalid request", context.Background(), &relaycommon.RelayInfo{}, upstreamErr(400, "invalid_request_error", "invalid_request"), OutcomeIgnored},
		{"upstream invalid key reported as invalid_request_error", context.Background(), &relaycommon.RelayInfo{},
			upstreamErr(401, "invalid_request_error", "invalid_api_key"), OutcomeFailure},
		{"local insufficient quota", context.Background(), &relaycommon.RelayInfo{},
			types.NewError(errors.New("quota"), types.ErrorCodeInsufficientUserQuota), OutcomeIgnored},
		{"local no channel", context.Background(), &relaycommon.RelayInfo{},
			types.NewError(errors.New("no channel"), types.ErrorCodeGetChannelFailed), OutcomeFailure},
		{"business rejection", context.Background(), &relaycommon.RelayInfo{PerformanceBusinessRejection: true}, nil, OutcomeIgnored},
		{"stream done", context.Background(), streamInfo(relaycommon.StreamEndReasonDone, nil, 0), nil, OutcomeSuccess},
		{"stream client gone", context.Background(), streamInfo(relaycommon.StreamEndReasonClientGone, context.Canceled, 0), nil, OutcomeIgnored},
		{"stream client gone by deadline", context.Background(), streamInfo(relaycommon.StreamEndReasonClientGone, context.DeadlineExceeded, 0), nil, OutcomeFailure},
		{"stream timeout", context.Background(), streamInfo(relaycommon.StreamEndReasonTimeout, nil, 0), nil, OutcomeFailure},
		{"stream soft errors", context.Background(), streamInfo(relaycommon.StreamEndReasonDone, nil, 2), nil, OutcomeFailure},
		{"stream ping fail", context.Background(), streamInfo(relaycommon.StreamEndReasonPingFail, errors.New("ping"), 0), nil, OutcomeIgnored},
		// 线上实测：Responses 流 20~35s 后直接 EOF、没有 response.completed，Codex 报 stream disconnected
		{"eof without terminal", context.Background(), terminalInfo(relaycommon.StreamEndReasonEOF, nil), nil, OutcomeFailure},
		{"eof after completed", context.Background(), terminalInfo(relaycommon.StreamEndReasonEOF, (*relaycommon.StreamStatus).MarkCompleted), nil, OutcomeSuccess},
		{"done marker without terminal", context.Background(), terminalInfo(relaycommon.StreamEndReasonDone, nil), nil, OutcomeSuccess},
		{"client gone before terminal", context.Background(), func() *relaycommon.RelayInfo {
			info := terminalInfo(relaycommon.StreamEndReasonEOF, nil)
			info.StreamStatus = relaycommon.NewStreamStatus()
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, context.Canceled)
			info.StreamStatus.RequireTerminal()
			return info
		}(), nil, OutcomeIgnored},
		{"response failed event", context.Background(), terminalInfo(relaycommon.StreamEndReasonEOF, func(s *relaycommon.StreamStatus) {
			s.MarkCompleted()
			s.MarkFailed("server_error", "", 0)
		}), nil, OutcomeFailure},
		{"response failed context length", context.Background(), terminalInfo(relaycommon.StreamEndReasonEOF, func(s *relaycommon.StreamStatus) {
			s.MarkFailed("context_length_exceeded", "", 0)
		}), nil, OutcomeIgnored},
		{"incomplete max tokens", context.Background(), terminalInfo(relaycommon.StreamEndReasonEOF, func(s *relaycommon.StreamStatus) {
			s.MarkIncomplete("max_output_tokens")
		}), nil, OutcomeSuccess},
		{"incomplete unknown reason", context.Background(), terminalInfo(relaycommon.StreamEndReasonEOF, func(s *relaycommon.StreamStatus) {
			s.MarkIncomplete("")
		}), nil, OutcomeFailure},
		{"cancelled", context.Background(), terminalInfo(relaycommon.StreamEndReasonEOF, (*relaycommon.StreamStatus).MarkCancelled), nil, OutcomeIgnored},
		// 没声明终态的旧 handler 维持原判定
		{"legacy stream eof", context.Background(), streamInfo(relaycommon.StreamEndReasonEOF, nil, 0), nil, OutcomeSuccess},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyRelayOutcome(tc.ctx, tc.info, tc.err); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestBuildModelStatusWindowAndGroups(t *testing.T) {
	now := int64(1790154000 + 1800) // 某小时的中间
	start := bucketStart(now) - int64(statusBucketCount-1)*bucketSeconds
	groups := map[string]map[int64]counters{
		"default": {
			start:                     {requestCount: 10, successCount: 9, totalLatencyMs: 20000, ttftSumMs: 5000, ttftCount: 5, outputTokens: 800, generationMs: 10000},
			bucketStart(now):          {requestCount: 10, successCount: 10, totalLatencyMs: 10000},
			start - bucketSeconds:     {requestCount: 99, successCount: 0}, // 窗口外，不计
			bucketStart(now) + 3600*2: {requestCount: 5, successCount: 0},  // 未来桶（时钟漂移），不计
		},
		"vip": {bucketStart(now): {requestCount: 4, successCount: 2}},
	}

	st, ok := buildModelStatus(start, groups, map[string]struct{}{"default": {}})
	if !ok || !st.HasData {
		t.Fatal("expected data")
	}
	if st.Availability != 95 {
		t.Fatalf("availability = %v, want 95 (vip must be filtered, out-of-window buckets dropped)", st.Availability)
	}
	if st.Buckets[0] != 90 || st.Buckets[statusBucketCount-1] != 100 || st.Buckets[5] != statusNoData {
		t.Fatalf("buckets = %v", st.Buckets)
	}
	if st.Latency != 1.5 || st.Ttft != 1 || st.Throughput != 80 {
		t.Fatalf("latency=%v ttft=%v tps=%v", st.Latency, st.Ttft, st.Throughput)
	}
	if len(st.Groups) != 1 || st.Groups[0].Group != "default" {
		t.Fatalf("groups = %+v", st.Groups)
	}
	if _, ok := buildModelStatus(start, groups, map[string]struct{}{"nope": {}}); ok {
		t.Fatal("model with no allowed group must be hidden")
	}
}
