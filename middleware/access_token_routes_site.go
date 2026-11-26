package middleware

import "fmt"

// 本站定制路由的访问令牌规则（上游 rc.43 起作用域访问令牌只能调用声明过的路由，未声明一律 403）。
// 单独放一个文件，避免和上游的 accessTokenRouteRules 大表冲突。
// 只影响作用域访问令牌；浏览器会话不受影响，旧版访问令牌（过渡期内）对非 session 规则照常放行。
var siteAccessTokenRouteRules = map[string]accessTokenRouteRule{
	// 抽奖（用户）
	"GET /api/lottery":                   accessTokenAnyRule,
	"GET /api/lottery/history":           accessTokenScopeRule("wallet:read"),
	"GET /api/lottery/tickets":           accessTokenScopeRule("wallet:read"),
	"POST /api/lottery/draw":             accessTokenScopeRule("wallet:write"),
	"POST /api/lottery/draws/:id/redeem": accessTokenScopeRule("wallet:write"),
	"POST /api/lottery/notice/ack":       accessTokenScopeRule("wallet:write"),

	// 抽奖（管理）
	"GET /api/lottery/admin/overview":          accessTokenScopeRule("billing:read"),
	"GET /api/lottery/admin/codes":             accessTokenScopeRule("billing:read"),
	"GET /api/lottery/admin/users":             accessTokenScopeRule("billing:read"),
	"GET /api/lottery/admin/wallets":           accessTokenScopeRule("billing:read"),
	"GET /api/lottery/admin/draws":             accessTokenScopeRule("billing:read"),
	"GET /api/lottery/admin/tickets":           accessTokenScopeRule("billing:read"),
	"GET /api/lottery/admin/gifts":             accessTokenScopeRule("billing:read"),
	"PUT /api/lottery/admin/config":            accessTokenScopeRule("billing:write"),
	"POST /api/lottery/admin/prizes":           accessTokenScopeRule("billing:write"),
	"PUT /api/lottery/admin/prizes/:id":        accessTokenScopeRule("billing:write"),
	"DELETE /api/lottery/admin/prizes/:id":     accessTokenScopeRule("billing:write"),
	"POST /api/lottery/admin/prizes/:id/stock": accessTokenScopeRule("billing:write"),
	"DELETE /api/lottery/admin/codes/:id":      accessTokenScopeRule("billing:write"),
	"POST /api/lottery/admin/grant-tickets":    accessTokenScopeRule("billing:write"),
	"POST /api/lottery/admin/gifts/grant":      accessTokenScopeRule("billing:write"),

	// 邀请返利
	"GET /api/user/affiliate/summary":         accessTokenScopeRule("wallet:read"),
	"GET /api/user/affiliate/history":         accessTokenScopeRule("wallet:read"),
	"GET /api/user/affiliate/config":          accessTokenScopeRule("wallet:read"),
	"GET /api/user/:id/invites":               accessTokenScopeRule("user:read"),
	"GET /api/affiliate-rebates":              accessTokenScopeRule("billing:read"),
	"POST /api/affiliate-rebates/:id/release": accessTokenScopeRule("billing:write"),
	"POST /api/affiliate-rebates/:id/revoke":  accessTokenScopeRule("billing:write"),

	// 收据、线下充值
	"GET /api/user/topup/receipt/:trade_no": accessTokenScopeRule("wallet:read"),
	"POST /api/user/topup/receipt/merge":    accessTokenScopeRule("wallet:read"),
	"POST /api/user/topup/offline":          accessTokenScopeRule("billing:write"),
	"POST /api/user/receipt/manual":         accessTokenScopeRule("billing:write"),

	// 订阅管理补充接口
	"DELETE /api/subscription/admin/plans/:id":                        accessTokenScopeRule("billing:write"),
	"PUT /api/subscription/admin/user_subscriptions/:id/end_time":     accessTokenScopeRule("billing:write"),
	"POST /api/subscription/admin/user_subscriptions/:id/reset_quota": accessTokenScopeRule("billing:write"),

	// 运营分析
	"GET /api/analytics/station-overview": accessTokenScopeRule("log:read"),
	"GET /api/analytics/ops-costs":        accessTokenScopeRule("log:read"),
	"POST /api/analytics/ops-costs":       accessTokenScopeRule("billing:write"),
	"PUT /api/analytics/ops-costs":        accessTokenScopeRule("billing:write"),
	"DELETE /api/analytics/ops-costs/:id": accessTokenScopeRule("billing:write"),
	"GET /api/analytics/daily-ranking":    accessTokenAnyRule,

	// 提示词安全审核（root）
	"GET /api/prompt_audit/config":       accessTokenScopeRule("option:read"),
	"GET /api/prompt_audit/logs":         accessTokenScopeRule("option:read"),
	"GET /api/prompt_audit/stat":         accessTokenScopeRule("option:read"),
	"DELETE /api/prompt_audit/logs":      accessTokenScopeRule("option:write"),
	"POST /api/prompt_audit/test":        accessTokenScopeRule("option:write"),
	"POST /api/prompt_audit/test_notify": accessTokenScopeRule("option:write"),

	// classic 仍在用、上游已删的接口
	"POST /api/option/migrate_console_setting": accessTokenScopeRule("option:write"),
	"DELETE /api/log/":                         accessTokenScopeRule("ops:write"),
	"GET /api/pricing/status":                  accessTokenAnyRule,
}

func init() {
	for key, rule := range siteAccessTokenRouteRules {
		if _, ok := accessTokenRouteRules[key]; ok {
			panic(fmt.Sprintf("access token route %s is declared twice (site rules)", key))
		}
		accessTokenRouteRules[key] = rule
	}
}
