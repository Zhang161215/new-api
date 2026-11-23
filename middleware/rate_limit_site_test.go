package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// 刷新走自己的 RF 桶：刷满不影响登录/验证用的 CT 桶，反之亦然。
func TestAuthRefreshRateLimitUsesItsOwnBucket(t *testing.T) {
	gin.SetMode(gin.TestMode)
	savedRedis, savedEnable, savedNum := common.RedisEnabled, common.CriticalRateLimitEnable, common.CriticalRateLimitNum
	t.Cleanup(func() {
		common.RedisEnabled, common.CriticalRateLimitEnable, common.CriticalRateLimitNum = savedRedis, savedEnable, savedNum
	})
	common.RedisEnabled = false
	common.CriticalRateLimitEnable = true
	common.CriticalRateLimitNum = 2
	t.Setenv("AUTH_REFRESH_RATE_LIMIT", "5")

	router := gin.New()
	router.POST("/refresh", AuthRefreshRateLimit(), func(c *gin.Context) { c.Status(http.StatusOK) })
	router.POST("/login", CriticalRateLimit(), func(c *gin.Context) { c.Status(http.StatusOK) })
	call := func(path string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.RemoteAddr = "203.0.113.9:1234"
		router.ServeHTTP(w, req)
		return w.Code
	}

	for i := 0; i < 5; i++ {
		assert.Equal(t, http.StatusOK, call("/refresh"), "refresh %d", i+1)
	}
	assert.Equal(t, http.StatusTooManyRequests, call("/refresh"))
	assert.Equal(t, http.StatusOK, call("/login"), "refresh must not use up the critical bucket")
	assert.Equal(t, http.StatusOK, call("/login"))
	assert.Equal(t, http.StatusTooManyRequests, call("/login"))
}
