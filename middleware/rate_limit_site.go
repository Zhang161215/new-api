package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// AuthRefreshRateLimit 是 POST /api/user/auth/refresh 的限流（本站）。
//
// 上游把刷新接口挂在 CriticalRateLimit 上，和登录、2FA/安全验证共用 "CT" 桶（默认每 IP 20 次/20 分钟）。
// 后台 access token 只放内存，classic 每次整页加载/新开标签页都要刷新一次，正常用户刷新几次页面就会 429
// 被踢回登录页；同一出口 IP（公司/学校 NAT）的用户还会互相挤占登录次数。刷新要带 HttpOnly 的
// refresh cookie（随机令牌，无法暴力猜），这里单独一个 "RF" 桶、放宽次数，登录/验证仍是严格的 CT 桶。
//
// AUTH_REFRESH_RATE_LIMIT 改次数（默认 300），窗口沿用 CRITICAL_RATE_LIMIT_DURATION；
// CRITICAL_RATE_LIMIT_ENABLE=false 时一并关闭。
func AuthRefreshRateLimit() func(c *gin.Context) {
	if !common.CriticalRateLimitEnable {
		return defNext
	}
	return rateLimitFactory(common.GetEnvOrDefault("AUTH_REFRESH_RATE_LIMIT", 300), common.CriticalRateLimitDuration, "RF")
}
