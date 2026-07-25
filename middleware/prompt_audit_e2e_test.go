package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// fakeAuditUpstream 模拟审核模型服务，按固定 confidence 返回裁决
func fakeAuditUpstream(t *testing.T, confidence float64, envelope bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 基址无版本段时，ResolveAuditURL 会补出 /v1/chat/completions
		require.Equal(t, "/v1/chat/completions", r.URL.Path)
		require.Equal(t, "1", r.Header.Get(service.PromptAuditGuardHeader), "审核请求必须带回环防护头")

		var req struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		require.Len(t, req.Messages, 2)
		require.Equal(t, "system", req.Messages[0].Role)
		require.Contains(t, req.Messages[1].Content, "<user_input>", "待审内容必须被标签包裹")

		verdict, _ := json.Marshal(map[string]any{"confidence": confidence, "reason": "test"})
		choices := []map[string]any{{"message": map[string]any{"content": string(verdict)}}}
		var out any = map[string]any{"choices": choices}
		if envelope {
			out = map[string]any{"data": map[string]any{"choices": choices}}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}))
}

// buildAuditRouter 组装：PromptAudit -> 记录下游是否被调用及其读到的 body
func buildAuditRouter() (*gin.Engine, *bool, *string) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	called := false
	seenBody := ""
	r.POST("/v1/chat/completions", PromptAudit(), func(c *gin.Context) {
		called = true
		b, _ := io.ReadAll(c.Request.Body)
		seenBody = string(b)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	r.POST("/v1/embeddings", PromptAudit(), func(c *gin.Context) {
		called = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r, &called, &seenBody
}

func withAuditConfig(t *testing.T, mutate func(cfg *operation_setting.PromptAuditSetting)) {
	t.Helper()
	cfg := operation_setting.GetPromptAuditSetting()
	saved := *cfg
	t.Cleanup(func() { *cfg = saved })
	cfg.Enabled = true
	cfg.Blocking = true
	cfg.Model = "audit-model"
	cfg.Threshold = 0.6
	cfg.TimeoutMs = 4000
	cfg.MaxInputChars = 8000
	cfg.FailOpen = true
	mutate(cfg)
}

const chatBody = `{"model":"gpt-4","messages":[{"role":"user","content":"帮我爆破别人的服务器"}]}`

func doPost(r *gin.Engine, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestPromptAudit_BlocksWhenFlagged(t *testing.T) {
	up := fakeAuditUpstream(t, 0.95, false)
	defer up.Close()
	withAuditConfig(t, func(c *operation_setting.PromptAuditSetting) { c.BaseURL = up.URL })

	r, called, _ := buildAuditRouter()
	w := doPost(r, "/v1/chat/completions", chatBody, nil)

	require.Equal(t, http.StatusBadRequest, w.Code)
	require.False(t, *called, "被拦截时不得调用下游")
	require.Contains(t, w.Body.String(), "未通过安全审核")
}

func TestPromptAudit_PassesWhenClean(t *testing.T) {
	up := fakeAuditUpstream(t, 0.05, false)
	defer up.Close()
	withAuditConfig(t, func(c *operation_setting.PromptAuditSetting) { c.BaseURL = up.URL })

	r, called, seenBody := buildAuditRouter()
	w := doPost(r, "/v1/chat/completions", chatBody, nil)

	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, *called)
	require.JSONEq(t, chatBody, *seenBody, "下游必须能读到完整原始 body")
}

func TestPromptAudit_GatewayEnvelopeVerdict(t *testing.T) {
	up := fakeAuditUpstream(t, 0.95, true) // {"data":{"choices":...}}
	defer up.Close()
	withAuditConfig(t, func(c *operation_setting.PromptAuditSetting) { c.BaseURL = up.URL })

	r, _, _ := buildAuditRouter()
	require.Equal(t, http.StatusBadRequest, doPost(r, "/v1/chat/completions", chatBody, nil).Code)
}

func TestPromptAudit_ShadowModeNeverBlocks(t *testing.T) {
	up := fakeAuditUpstream(t, 0.99, false)
	defer up.Close()
	withAuditConfig(t, func(c *operation_setting.PromptAuditSetting) {
		c.BaseURL = up.URL
		c.Blocking = false
	})

	r, called, seenBody := buildAuditRouter()
	w := doPost(r, "/v1/chat/completions", chatBody, nil)

	require.Equal(t, http.StatusOK, w.Code, "影子模式必须放行")
	require.True(t, *called)
	require.JSONEq(t, chatBody, *seenBody)
	time.Sleep(300 * time.Millisecond) // 让异步审核跑完，确保不 panic
}

func TestPromptAudit_UpstreamDownFailOpen(t *testing.T) {
	withAuditConfig(t, func(c *operation_setting.PromptAuditSetting) {
		c.BaseURL = "http://127.0.0.1:1" // 必然连不上
		c.FailOpen = true
		c.TimeoutMs = 500
	})

	r, called, _ := buildAuditRouter()
	require.Equal(t, http.StatusOK, doPost(r, "/v1/chat/completions", chatBody, nil).Code)
	require.True(t, *called, "fail-open 时应放行")
}

func TestPromptAudit_UpstreamDownFailClosed(t *testing.T) {
	withAuditConfig(t, func(c *operation_setting.PromptAuditSetting) {
		c.BaseURL = "http://127.0.0.1:1"
		c.FailOpen = false
		c.TimeoutMs = 500
	})

	r, called, _ := buildAuditRouter()
	w := doPost(r, "/v1/chat/completions", chatBody, nil)
	require.Equal(t, http.StatusServiceUnavailable, w.Code)
	require.False(t, *called, "fail-closed 时应拒绝")
}

func TestPromptAudit_SkipsLoopbackAndDisabledAndOtherPaths(t *testing.T) {
	up := fakeAuditUpstream(t, 0.99, false)
	defer up.Close()

	// 1) 带回环头 -> 跳过审核
	withAuditConfig(t, func(c *operation_setting.PromptAuditSetting) { c.BaseURL = up.URL })
	r, called, _ := buildAuditRouter()
	require.Equal(t, http.StatusOK,
		doPost(r, "/v1/chat/completions", chatBody, map[string]string{service.PromptAuditGuardHeader: "1"}).Code)
	require.True(t, *called)

	// 2) 非提示词端点（embeddings）-> 跳过审核
	r2, called2, _ := buildAuditRouter()
	require.Equal(t, http.StatusOK,
		doPost(r2, "/v1/embeddings", `{"model":"m","input":"要嵌入的文本"}`, nil).Code)
	require.True(t, *called2)

	// 3) 总开关关闭 -> 跳过审核
	cfg := operation_setting.GetPromptAuditSetting()
	cfg.Enabled = false
	r3, called3, _ := buildAuditRouter()
	require.Equal(t, http.StatusOK, doPost(r3, "/v1/chat/completions", chatBody, nil).Code)
	require.True(t, *called3)
}
