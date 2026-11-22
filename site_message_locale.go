package main

import (
	_ "embed"

	"github.com/QuantumNous/new-api/common"
)

// 本站：服务端渲染中文提示/日志用的翻译表，直接取上游新版前端的 locale 文件（见 common/message_locale.go）。

//go:embed web/src/i18n/locales/zh.json
var webLocaleZhCN []byte

//go:embed web/src/i18n/locales/zh-TW.json
var webLocaleZhTW []byte

// 前端 locale 里没有、但服务端会写进日志 content 的文案（controller/audit.go 的模板）。
var siteMessageTranslations = map[string]map[string]string{
	"zh-CN": {
		"Generated an access token":                                               "生成了访问令牌",
		"Reset active subscriptions for plan {{plan_id}}":                         "重置了套餐 {{plan_id}} 的有效订阅",
		"Reset active plan {{plan_id}} subscriptions for user {{target_user_id}}": "重置了用户 {{target_user_id}} 的套餐 {{plan_id}} 有效订阅",
	},
	"zh-TW": {
		"Generated an access token":                                               "已產生存取令牌",
		"Reset active subscriptions for plan {{plan_id}}":                         "已重設方案 {{plan_id}} 的有效訂閱",
		"Reset active plan {{plan_id}} subscriptions for user {{target_user_id}}": "已重設使用者 {{target_user_id}} 的方案 {{plan_id}} 有效訂閱",
	},
}

func init() {
	common.RegisterMessageLocale("zh-CN", webLocaleZhCN)
	common.RegisterMessageLocale("zh-TW", webLocaleZhTW)
	for lang, translations := range siteMessageTranslations {
		common.RegisterMessageTranslations(lang, translations)
	}
}
