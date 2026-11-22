package common

import (
	"strings"
	"sync/atomic"
)

// 本站保留 classic 前端（上游 7-20 31d70fca3 删除了它）。
// 两份前端都 embed，按 theme.frontend 选项在运行时切换，默认 classic。

var themeValue atomic.Value // stores string; safe for concurrent read/write

func init() {
	themeValue.Store("classic")
}

func GetTheme() string {
	return themeValue.Load().(string)
}

// SetTheme updates the frontend theme atomically.
// Only "default" and "classic" are accepted; other values are silently ignored.
func SetTheme(t string) {
	if t == "default" || t == "classic" {
		themeValue.Store(t)
	}
}

// ThemeAwarePath 把上游新版前端的路由改写成 classic 对应的页面。
// 上游代码里的支付回跳、充值提醒链接都写的是新版路由（/wallet、/usage-logs、/profile），
// classic 主题下改写成 /console/topup、/console/log、/console/personal；default 主题原样返回。
func ThemeAwarePath(suffix string) string {
	if GetTheme() != "classic" {
		return suffix
	}
	for _, m := range [...]struct{ from, to string }{
		{"/wallet", "/console/topup"},
		{"/usage-logs", "/console/log"},
		{"/profile", "/console/personal"},
	} {
		if suffix == m.from || strings.HasPrefix(suffix, m.from+"?") || strings.HasPrefix(suffix, m.from+"/") {
			return m.to + suffix[len(m.from):]
		}
	}
	return suffix
}
