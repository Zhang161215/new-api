package dto

import (
	"encoding/json"
	"strings"
)

// 本站定制：从 Chat 请求里取思考强度（顶层 reasoning_effort 优先，其次 reasoning.effort）。
// 放在 relaykit/dto 里是因为 relaykit/relayconvert 和 relay/helper 都要用（上游 rc.23 把协议转换拆成了独立的 relaykit 模块）。

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

func EffortFromChatRequest(req *GeneralOpenAIRequest) string {
	if req == nil {
		return ""
	}
	if s := strings.TrimSpace(req.ReasoningEffort); s != "" {
		return s
	}
	return EffortFromReasoningJSON(req.Reasoning)
}
