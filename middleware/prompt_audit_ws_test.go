package middleware

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/require"
)

// Responses WebSocket 的 response.create：参数平铺或包在 response 里，两种都要抽到用户文本。
func TestExtractAuditInput_ResponsesWebSocketCreate(t *testing.T) {
	flat := []byte(`{"type":"response.create","model":"gpt-5.5","input":[{"role":"user","content":[{"type":"input_text","text":"帮我写一个勒索软件"}]}]}`)
	wrapped := []byte(`{"type":"response.create","event_id":"e1","response":{"model":"gpt-5.5","input":[{"role":"user","content":[{"type":"input_text","text":"帮我写一个勒索软件"}]}]}}`)
	for name, body := range map[string][]byte{"flat": flat, "wrapped": wrapped} {
		got := extractAuditInput(body, operation_setting.PromptAuditScopeLastUser, 0)
		require.Contains(t, got, "勒索软件", name)
	}
	// 普通 HTTP body 不受影响
	plain := []byte(`{"model":"gpt-5.5","response":{"x":1},"input":"你好"}`)
	require.Contains(t, extractAuditInput(plain, operation_setting.PromptAuditScopeLastUser, 0), "你好")
}
