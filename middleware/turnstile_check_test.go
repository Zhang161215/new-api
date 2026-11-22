package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

func TestTurnstileHostnameAllowed(t *testing.T) {
	turnstileHostsOnce = sync.Once{}
	turnstileHosts = nil
	t.Setenv("TURNSTILE_ALLOWED_HOSTNAMES", ".synai996.space, exact.example.com")
	cases := map[string]bool{
		"synai996.space":      true,
		"api.synai996.space":  true,
		"API.Synai996.Space":  true,
		"evilsynai996.space":  false,
		"synai996.space.evil": false,
		"exact.example.com":   true,
		"a.exact.example.com": false,
		"localhost":           false,
		"127.0.0.1":           false,
		"":                    false,
	}
	for h, want := range cases {
		if got := turnstileHostnameAllowed(h); got != want {
			t.Errorf("hostname %q: got %v want %v", h, got, want)
		}
	}
}

func TestTurnstileCheckPerRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	turnstileHostsOnce = sync.Once{}
	turnstileHosts = nil
	t.Setenv("TURNSTILE_ALLOWED_HOSTNAMES", ".synai996.space")

	var mu sync.Mutex
	used := map[string]bool{}
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		tok := r.PostForm.Get("response")
		mu.Lock()
		defer mu.Unlock()
		resp := turnstileCheckResponse{Success: true, Hostname: "api.synai996.space"}
		switch {
		case used[tok]:
			resp = turnstileCheckResponse{Success: false, ErrorCodes: []string{"timeout-or-duplicate"}}
		case tok == "badhost":
			resp.Hostname = "evil.example.com"
		}
		used[tok] = true
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer fake.Close()
	oldURL := turnstileSiteverifyURL
	turnstileSiteverifyURL = fake.URL
	defer func() { turnstileSiteverifyURL = oldURL }()
	oldEnabled := common.TurnstileCheckEnabled
	common.TurnstileCheckEnabled = true
	defer func() { common.TurnstileCheckEnabled = oldEnabled }()

	r := gin.New()
	r.POST("/login", TurnstileCheck(), func(c *gin.Context) { c.JSON(200, gin.H{"success": true, "message": "handler"}) })
	call := func(q string) map[string]any {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/login"+q, nil)
		r.ServeHTTP(w, req)
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	if out := call(""); out["success"] != false {
		t.Fatalf("missing token should be rejected: %v", out)
	}
	if out := call("?turnstile=tok1"); out["message"] != "handler" {
		t.Fatalf("fresh token should pass: %v", out)
	}
	if out := call("?turnstile=tok1"); out["message"] == "handler" {
		t.Fatalf("replayed token must be rejected: %v", out)
	}
	if out := call("?turnstile=badhost"); out["message"] == "handler" {
		t.Fatalf("token from foreign hostname must be rejected: %v", out)
	}
	long := make([]byte, 2049)
	for i := range long {
		long[i] = 'a'
	}
	if out := call("?turnstile=" + string(long)); out["message"] == "handler" {
		t.Fatalf("oversized token must be rejected: %v", out)
	}
	common.TurnstileCheckEnabled = false
	if out := call(""); out["message"] != "handler" {
		t.Fatalf("disabled check should pass through: %v", out)
	}
}
