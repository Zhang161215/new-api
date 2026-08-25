package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type LegalSettings struct {
	UserAgreement string `json:"user_agreement"`
	PrivacyPolicy string `json:"privacy_policy"`
	// SubscriptionAgreement 是购买订阅套餐前必须勾选的服务协议。
	// 留空时前端使用内置默认文案，管理员填了就以填的为准。
	SubscriptionAgreement string `json:"subscription_agreement"`
}

var defaultLegalSettings = LegalSettings{
	UserAgreement:         "",
	PrivacyPolicy:         "",
	SubscriptionAgreement: "",
}

func init() {
	config.GlobalConfig.Register("legal", &defaultLegalSettings)
}

func GetLegalSettings() *LegalSettings {
	return &defaultLegalSettings
}
