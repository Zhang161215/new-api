package helper

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

const (
	ReasoningEffortSourceRequest  = "request"
	ReasoningEffortSourceSuffix   = "suffix"
	ReasoningEffortSourceDefault  = "default"
	ReasoningEffortSourceThinking = "thinking"
)

// Longer suffixes first so "-xhigh" is not trimmed as "-high".
var reasoningEffortSuffixes = []string{
	"-minimal", "-xhigh", "-medium", "-high", "-none", "-max", "-low",
}

func ParseReasoningEffortFromModelSuffix(model string) (effort string, origin string) {
	if model == "" {
		return "", model
	}
	for _, suffix := range reasoningEffortSuffixes {
		if strings.HasSuffix(model, suffix) {
			return strings.TrimPrefix(suffix, "-"), strings.TrimSuffix(model, suffix)
		}
	}
	return "", model
}

func stripReasoningEffortSuffix(model string) string {
	_, origin := ParseReasoningEffortFromModelSuffix(model)
	return origin
}

func EffortFromReasoningJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var parsed struct {
		Effort string `json:"effort"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ""
	}
	return strings.TrimSpace(parsed.Effort)
}

func EffortFromChatRequest(req *dto.GeneralOpenAIRequest) string {
	if req == nil {
		return ""
	}
	if s := strings.TrimSpace(req.ReasoningEffort); s != "" {
		return s
	}
	return EffortFromReasoningJSON(req.Reasoning)
}

func DefaultReasoningEffort(model string) string {
	m := strings.ToLower(stripReasoningEffortSuffix(strings.TrimSpace(model)))
	if m == "" {
		return ""
	}
	if strings.HasPrefix(m, "gpt-5.1") {
		return "none"
	}
	if strings.HasPrefix(m, "gpt-5") {
		return "medium"
	}
	if strings.HasPrefix(m, "o1") || strings.HasPrefix(m, "o3") || strings.HasPrefix(m, "o4") {
		return "medium"
	}
	return ""
}

func RememberReasoningEffort(info *relaycommon.RelayInfo, effort, source string, overwrite bool) {
	if info == nil {
		return
	}
	effort = strings.TrimSpace(effort)
	if effort == "" {
		return
	}
	if info.ReasoningEffort != "" && !overwrite {
		return
	}
	info.ReasoningEffort = effort
	if source != "" {
		info.ReasoningEffortSource = source
	}
}

func applyDefaultReasoningEffort(info *relaycommon.RelayInfo, models ...string) {
	if info == nil || info.ReasoningEffort != "" {
		return
	}
	for _, m := range models {
		if def := DefaultReasoningEffort(m); def != "" {
			RememberReasoningEffort(info, def, ReasoningEffortSourceDefault, false)
			return
		}
	}
}

func infoModelNames(info *relaycommon.RelayInfo, requestModel string) []string {
	names := make([]string, 0, 3)
	if info != nil {
		if info.OriginModelName != "" {
			names = append(names, info.OriginModelName)
		}
		if info.ChannelMeta != nil && info.UpstreamModelName != "" {
			names = append(names, info.UpstreamModelName)
		}
	}
	if requestModel != "" {
		names = append(names, requestModel)
	}
	return names
}

func captureSuffixFromModels(info *relaycommon.RelayInfo, models []string) {
	for _, m := range models {
		if effort, _ := ParseReasoningEffortFromModelSuffix(m); effort != "" {
			RememberReasoningEffort(info, effort, ReasoningEffortSourceSuffix, true)
			return
		}
	}
}

func CaptureChatReasoningEffort(info *relaycommon.RelayInfo, req *dto.GeneralOpenAIRequest) {
	if info == nil || req == nil {
		return
	}
	models := infoModelNames(info, req.Model)
	captureSuffixFromModels(info, models)
	if effort := EffortFromChatRequest(req); effort != "" {
		RememberReasoningEffort(info, effort, ReasoningEffortSourceRequest, false)
	}
	applyDefaultReasoningEffort(info, models...)
}

func CaptureResponsesReasoningEffort(info *relaycommon.RelayInfo, req *dto.OpenAIResponsesRequest) {
	if info == nil || req == nil {
		return
	}
	models := infoModelNames(info, req.Model)
	captureSuffixFromModels(info, models)
	if req.Reasoning != nil && strings.TrimSpace(req.Reasoning.Effort) != "" {
		RememberReasoningEffort(info, req.Reasoning.Effort, ReasoningEffortSourceRequest, false)
	}
	applyDefaultReasoningEffort(info, models...)
}

func CaptureClaudeReasoningEffort(info *relaycommon.RelayInfo, req *dto.ClaudeRequest) {
	if info == nil || req == nil {
		return
	}
	models := infoModelNames(info, req.Model)
	captureSuffixFromModels(info, models)
	if effort := req.GetEfforts(); effort != "" {
		RememberReasoningEffort(info, effort, ReasoningEffortSourceRequest, false)
	}
	if req.Thinking != nil {
		switch strings.ToLower(strings.TrimSpace(req.Thinking.Type)) {
		case "enabled", "adaptive":
			RememberReasoningEffort(info, "medium", ReasoningEffortSourceThinking, false)
		case "disabled":
			RememberReasoningEffort(info, "none", ReasoningEffortSourceThinking, false)
		}
	}
	applyDefaultReasoningEffort(info, models...)
}
