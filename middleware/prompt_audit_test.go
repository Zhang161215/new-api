package middleware

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractUserInput_OpenAIChat(t *testing.T) {
	body := []byte(`{"model":"gpt-4","messages":[
		{"role":"system","content":"you are helpful"},
		{"role":"user","content":"第一轮问题"},
		{"role":"assistant","content":"回答"},
		{"role":"user","content":"最后一轮问题"}
	]}`)
	require.Equal(t, "最后一轮问题", extractUserInput(body))
}

func TestExtractUserInput_OpenAIMultimodal(t *testing.T) {
	body := []byte(`{"messages":[{"role":"user","content":[
		{"type":"text","text":"这张图是什么"},
		{"type":"image_url","image_url":{"url":"https://x/y.png"}}
	]}]}`)
	require.Equal(t, "这张图是什么", extractUserInput(body))
}

func TestExtractUserInput_Claude(t *testing.T) {
	body := []byte(`{"model":"claude-haiku-4-5","system":"sys","messages":[
		{"role":"user","content":[{"type":"text","text":"帮我写代码"}]}
	]}`)
	require.Equal(t, "帮我写代码", extractUserInput(body))
}

func TestExtractUserInput_ResponsesString(t *testing.T) {
	body := []byte(`{"model":"gpt-5.6","input":"直接字符串输入"}`)
	require.Equal(t, "直接字符串输入", extractUserInput(body))
}

func TestExtractUserInput_ResponsesArray(t *testing.T) {
	body := []byte(`{"model":"gpt-5.6","input":[
		{"role":"user","content":[{"type":"input_text","text":"旧问题"}]},
		{"role":"assistant","content":[{"type":"output_text","text":"旧回答"}]},
		{"role":"user","content":[{"type":"input_text","text":"新问题"}]}
	]}`)
	require.Equal(t, "新问题", extractUserInput(body))
}

func TestExtractUserInput_NoUserText(t *testing.T) {
	require.Equal(t, "", extractUserInput([]byte(`{"model":"x","messages":[{"role":"system","content":"s"}]}`)))
	require.Equal(t, "", extractUserInput([]byte(`{"input":"","model":"x"}`)))
	require.Equal(t, "", extractUserInput([]byte(`not json`)))
}

func TestExtractUserInput_ImagePrompt(t *testing.T) {
	require.Equal(t, "一只猫娘在敲代码",
		extractUserInput([]byte(`{"model":"gpt-image-1","prompt":"一只猫娘在敲代码","n":1}`)))
	require.Equal(t, "第一句\n第二句",
		extractUserInput([]byte(`{"prompt":["第一句","第二句"]}`)))
}

func TestPromptAuditPathMatches(t *testing.T) {
	for _, p := range []string{
		"/v1/chat/completions", "/v1/completions", "/v1/messages",
		"/v1/responses", "/v1/responses/compact",
		"/v1/images/generations", "/v1/images/edits",
	} {
		require.True(t, promptAuditPathMatches(p), p)
	}
	for _, p := range []string{
		"/v1/embeddings", "/v1/audio/speech", "/v1/audio/transcriptions",
		"/v1/rerank", "/v1/models", "/v1/moderations",
	} {
		require.False(t, promptAuditPathMatches(p), p)
	}
}
