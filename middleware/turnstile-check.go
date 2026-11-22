package middleware

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

type turnstileCheckResponse struct {
	Success    bool     `json:"success"`
	Hostname   string   `json:"hostname"`
	ErrorCodes []string `json:"error-codes"`
}

const turnstileMaxTokenLen = 2048

var (
	turnstileSiteverifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
	turnstileHTTPClient    = &http.Client{Timeout: 10 * time.Second}

	turnstileHostsOnce sync.Once
	turnstileHosts     []string
)

// TURNSTILE_ALLOWED_HOSTNAMES：逗号分隔。以 "." 开头表示该域名本身及其所有子域名，否则精确匹配。
func turnstileAllowedHostnames() []string {
	turnstileHostsOnce.Do(func() {
		raw := common.GetEnvOrDefaultString("TURNSTILE_ALLOWED_HOSTNAMES", ".synai996.space")
		for _, h := range strings.Split(raw, ",") {
			h = strings.ToLower(strings.TrimSpace(h))
			if h != "" {
				turnstileHosts = append(turnstileHosts, h)
			}
		}
	})
	return turnstileHosts
}

func turnstileHostnameAllowed(hostname string) bool {
	hostname = strings.ToLower(strings.TrimSpace(hostname))
	if hostname == "" || hostname == "localhost" || hostname == "127.0.0.1" {
		return false
	}
	for _, allowed := range turnstileAllowedHostnames() {
		if strings.HasPrefix(allowed, ".") {
			if hostname == allowed[1:] || strings.HasSuffix(hostname, allowed) {
				return true
			}
		} else if hostname == allowed {
			return true
		}
	}
	return false
}

func verifyTurnstileToken(token string) error {
	if len(turnstileAllowedHostnames()) == 0 {
		return fmt.Errorf("hostname 白名单为空")
	}
	resp, err := turnstileHTTPClient.PostForm(turnstileSiteverifyURL, url.Values{
		"secret":   {common.TurnstileSecretKey},
		"response": {token},
	})
	if err != nil {
		return fmt.Errorf("siteverify 请求失败: %w", err)
	}
	defer resp.Body.Close()
	var res turnstileCheckResponse
	if err := common.DecodeJson(resp.Body, &res); err != nil {
		return fmt.Errorf("siteverify 响应解析失败: %w", err)
	}
	if !res.Success {
		return fmt.Errorf("siteverify 未通过: %v", res.ErrorCodes)
	}
	if !turnstileHostnameAllowed(res.Hostname) {
		return fmt.Errorf("hostname 不在白名单: %q", res.Hostname)
	}
	return nil
}

// TurnstileCheck 每个请求都要带一个新的 token（token 只能用一次）。
// 以前校验通过后会在会话里记一个标记、之后整段会话都放行，攻击者解一次验证码就能拿着 cookie 无限撞库，所以去掉了。
func TurnstileCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.TurnstileCheckEnabled {
			c.Next()
			return
		}
		token := c.Query("turnstile")
		if token == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "Turnstile token 为空",
			})
			c.Abort()
			return
		}
		if len(token) > turnstileMaxTokenLen {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "Turnstile 校验失败，请刷新重试！",
			})
			c.Abort()
			return
		}
		if err := verifyTurnstileToken(token); err != nil {
			common.SysLog("Turnstile 校验失败: " + err.Error())
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "Turnstile 校验失败，请刷新重试！",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
