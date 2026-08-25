package helper

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestParseReasoningEffortFromModelSuffix(t *testing.T) {
	t.Parallel()
	cases := []struct {
		model  string
		effort string
		origin string
	}{
		{"gpt-5.6-sol", "", "gpt-5.6-sol"},
		{"gpt-5.6-sol-high", "high", "gpt-5.6-sol"},
		{"gpt-5-xhigh", "xhigh", "gpt-5"},
		{"o3-mini-low", "low", "o3-mini"},
		{"gpt-5-minimal", "minimal", "gpt-5"},
		{"gpt-5.6-sol-max", "max", "gpt-5.6-sol"},
	}
	for _, tc := range cases {
		effort, origin := ParseReasoningEffortFromModelSuffix(tc.model)
		if effort != tc.effort || origin != tc.origin {
			t.Fatalf("%s: got (%q, %q), want (%q, %q)", tc.model, effort, origin, tc.effort, tc.origin)
		}
	}
}

func TestDefaultReasoningEffort(t *testing.T) {
	t.Parallel()
	if got := DefaultReasoningEffort("gpt-5.6-sol"); got != "medium" {
		t.Fatalf("gpt-5.6-sol default = %q", got)
	}
	if got := DefaultReasoningEffort("gpt-5.1"); got != "none" {
		t.Fatalf("gpt-5.1 default = %q", got)
	}
	if got := DefaultReasoningEffort("gpt-4o"); got != "" {
		t.Fatalf("gpt-4o should not default, got %q", got)
	}
	if got := DefaultReasoningEffort("o3-mini"); got != "medium" {
		t.Fatalf("o3-mini default = %q", got)
	}
}

func TestCaptureChatReasoningEffortFromNestedJSON(t *testing.T) {
	t.Parallel()
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol"}
	req := &dto.GeneralOpenAIRequest{
		Model:     "gpt-5.6-sol",
		Reasoning: json.RawMessage(`{"effort":"high","summary":"detailed"}`),
	}
	CaptureChatReasoningEffort(info, req)
	if info.ReasoningEffort != "high" {
		t.Fatalf("effort = %q", info.ReasoningEffort)
	}
	if info.ReasoningEffortSource != ReasoningEffortSourceRequest {
		t.Fatalf("source = %q", info.ReasoningEffortSource)
	}
}

func TestCaptureChatReasoningEffortDefaultWhenOmitted(t *testing.T) {
	t.Parallel()
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol"}
	req := &dto.GeneralOpenAIRequest{Model: "gpt-5.6-sol"}
	CaptureChatReasoningEffort(info, req)
	if info.ReasoningEffort != "medium" {
		t.Fatalf("effort = %q", info.ReasoningEffort)
	}
	if info.ReasoningEffortSource != ReasoningEffortSourceDefault {
		t.Fatalf("source = %q", info.ReasoningEffortSource)
	}
}

func TestCaptureChatReasoningEffortSuffixWins(t *testing.T) {
	t.Parallel()
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol-xhigh"}
	req := &dto.GeneralOpenAIRequest{
		Model:           "gpt-5.6-sol-xhigh",
		ReasoningEffort: "low",
	}
	CaptureChatReasoningEffort(info, req)
	if info.ReasoningEffort != "xhigh" {
		t.Fatalf("effort = %q", info.ReasoningEffort)
	}
	if info.ReasoningEffortSource != ReasoningEffortSourceSuffix {
		t.Fatalf("source = %q", info.ReasoningEffortSource)
	}
}

func TestCaptureResponsesReasoningEffort(t *testing.T) {
	t.Parallel()
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-terra"}
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.6-terra",
		Reasoning: &dto.Reasoning{
			Effort: "max",
		},
	}
	CaptureResponsesReasoningEffort(info, req)
	if info.ReasoningEffort != "max" {
		t.Fatalf("effort = %q", info.ReasoningEffort)
	}
}

func TestCaptureClaudeReasoningEffortFromOutputConfig(t *testing.T) {
	t.Parallel()
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol"}
	req := &dto.ClaudeRequest{
		Model:        "gpt-5.6-sol",
		OutputConfig: json.RawMessage(`{"effort":"low"}`),
	}
	CaptureClaudeReasoningEffort(info, req)
	if info.ReasoningEffort != "low" {
		t.Fatalf("effort = %q", info.ReasoningEffort)
	}
	if info.ReasoningEffortSource != ReasoningEffortSourceRequest {
		t.Fatalf("source = %q", info.ReasoningEffortSource)
	}
}

func TestCaptureClaudeReasoningEffortGPTDefault(t *testing.T) {
	t.Parallel()
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol"}
	req := &dto.ClaudeRequest{Model: "gpt-5.6-sol"}
	CaptureClaudeReasoningEffort(info, req)
	if info.ReasoningEffort != "medium" || info.ReasoningEffortSource != ReasoningEffortSourceDefault {
		t.Fatalf("got %q/%q", info.ReasoningEffort, info.ReasoningEffortSource)
	}
}

func TestEffortFromChatRequestPrefersTopLevel(t *testing.T) {
	t.Parallel()
	req := &dto.GeneralOpenAIRequest{
		ReasoningEffort: "low",
		Reasoning:       json.RawMessage(`{"effort":"high"}`),
	}
	if got := EffortFromChatRequest(req); got != "low" {
		t.Fatalf("got %q", got)
	}
}
