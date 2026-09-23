package common

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

type StreamEndReason string

const (
	StreamEndReasonNone        StreamEndReason = ""
	StreamEndReasonDone        StreamEndReason = "done"
	StreamEndReasonTimeout     StreamEndReason = "timeout"
	StreamEndReasonClientGone  StreamEndReason = "client_gone"
	StreamEndReasonScannerErr  StreamEndReason = "scanner_error"
	StreamEndReasonHandlerStop StreamEndReason = "handler_stop"
	StreamEndReasonEOF         StreamEndReason = "eof"
	StreamEndReasonPanic       StreamEndReason = "panic"
	StreamEndReasonPingFail    StreamEndReason = "ping_fail"
)

// ResponseOutcome 是一次响应在协议层面的结果，与传输层怎么结束无关；由各 adaptor 在解析事件时顺手标记。移植自上游。
type ResponseOutcome string

const (
	ResponseOutcomeUnknown    ResponseOutcome = ""
	ResponseOutcomeCompleted  ResponseOutcome = "completed"
	ResponseOutcomeFailed     ResponseOutcome = "failed"
	ResponseOutcomeIncomplete ResponseOutcome = "incomplete"
	ResponseOutcomeCancelled  ResponseOutcome = "cancelled"
)

const maxStreamErrorEntries = 20

type StreamErrorEntry struct {
	Message   string
	Timestamp time.Time
}

type StreamStatus struct {
	EndReason StreamEndReason
	EndError  error
	endOnce   sync.Once

	mu         sync.Mutex
	Errors     []StreamErrorEntry
	ErrorCount int

	response         ResponseOutcome
	errorCode        string
	errorType        string
	errorStatus      int
	incompleteReason string
	expectsTerminal  bool
}

// StreamOutcome 只保存分类用的事实；上游错误消息可能带凭据或请求内容，不进这里。
type StreamOutcome struct {
	EndReason        StreamEndReason
	HasErrors        bool
	ExpectsTerminal  bool
	Response         ResponseOutcome
	ErrorCode        string
	ErrorType        string
	ErrorStatus      int
	IncompleteReason string
}

func NewStreamStatus() *StreamStatus {
	return &StreamStatus{}
}

func (s *StreamStatus) SetEndReason(reason StreamEndReason, err error) {
	if s == nil {
		return
	}
	s.endOnce.Do(func() {
		s.EndReason = reason
		s.EndError = err
	})
}

func (s *StreamStatus) RecordError(msg string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ErrorCount++
	if len(s.Errors) < maxStreamErrorEntries {
		s.Errors = append(s.Errors, StreamErrorEntry{
			Message:   msg,
			Timestamp: time.Now(),
		})
	}
}

// RequireTerminal 声明该协议总以显式终态事件结束（response.completed / message_stop / finish_reason），
// 没等到终态就 EOF 的流视为被截断。
func (s *StreamStatus) RequireTerminal() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expectsTerminal = true
}

// MarkCompleted / MarkIncomplete / MarkCancelled 只保留第一次终态；MarkFailed 总是覆盖，完成后再报错仍算失败。
func (s *StreamStatus) MarkCompleted() {
	s.markTerminal(ResponseOutcomeCompleted, "")
}

func (s *StreamStatus) MarkIncomplete(reason string) {
	s.markTerminal(ResponseOutcomeIncomplete, reason)
}

func (s *StreamStatus) MarkCancelled() {
	s.markTerminal(ResponseOutcomeCancelled, "")
}

func (s *StreamStatus) markTerminal(outcome ResponseOutcome, incompleteReason string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.response != ResponseOutcomeUnknown {
		return
	}
	s.response = outcome
	s.incompleteReason = incompleteReason
}

// MarkFailed 记录协议层失败；空字段不覆盖之前记下的结构化错误。
func (s *StreamStatus) MarkFailed(code, errorType string, status int) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.response = ResponseOutcomeFailed
	if code != "" {
		s.errorCode = code
	}
	if errorType != "" {
		s.errorType = errorType
	}
	if status != 0 {
		s.errorStatus = status
	}
}

func (s *StreamStatus) OutcomeSnapshot() StreamOutcome {
	if s == nil {
		return StreamOutcome{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return StreamOutcome{
		EndReason:        s.EndReason,
		HasErrors:        s.ErrorCount > 0,
		ExpectsTerminal:  s.expectsTerminal,
		Response:         s.response,
		ErrorCode:        s.errorCode,
		ErrorType:        s.errorType,
		ErrorStatus:      s.errorStatus,
		IncompleteReason: s.incompleteReason,
	}
}

func (s *StreamStatus) HasErrors() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ErrorCount > 0
}

func (s *StreamStatus) TotalErrorCount() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ErrorCount
}

func (s *StreamStatus) IsNormalEnd() bool {
	if s == nil {
		return true
	}
	return s.EndReason == StreamEndReasonDone ||
		s.EndReason == StreamEndReasonEOF ||
		s.EndReason == StreamEndReasonHandlerStop
}

func (s *StreamStatus) Summary() string {
	if s == nil {
		return "StreamStatus<nil>"
	}
	b := &strings.Builder{}
	fmt.Fprintf(b, "reason=%s", s.EndReason)
	if s.EndError != nil {
		fmt.Fprintf(b, " end_error=%q", s.EndError.Error())
	}
	s.mu.Lock()
	if s.ErrorCount > 0 {
		fmt.Fprintf(b, " soft_errors=%d", s.ErrorCount)
	}
	s.mu.Unlock()
	return b.String()
}
