package service

import (
	"fmt"
	"html"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

func UnbindAccountOAuth(identity AuthIdentity, providerID int) error {
	enabled := model.AccountLoginMethods{
		Password: common.PasswordLoginEnabled,
		Passkey:  system_setting.PasskeySettingsSnapshot().Enabled,
		WeChat:   common.WeChatAuthEnabled,
	}
	for _, provider := range oauth.GetAllProviders() {
		if !provider.IsEnabled() {
			continue
		}
		if custom, ok := provider.(*oauth.GenericOAuthProvider); ok {
			enabled.CustomProviderIDs = append(enabled.CustomProviderIDs, custom.GetProviderId())
		} else {
			enabled.OAuthColumns = append(enabled.OAuthColumns, provider.ProviderUserIDColumn())
		}
	}
	return model.UnbindUserOAuthForSession(identity, providerID, enabled)
}

// 本站：上游 rc.36 的安全通知邮件是写死的英文，本站用户以中文为主（注册/找回密码邮件也是中文），
// 这里翻成中文。调用方传的事件名保持上游英文原样（少改 controller，后面合并少冲突），在这里映射。
var accountSecurityEventZH = map[string]string{
	"Password updated":                             "登录密码已修改",
	"Email address changed":                        "账户邮箱已更换为新地址",
	"Email address confirmed":                      "此邮箱已绑定到您的账户",
	"WeChat account linked":                        "已绑定微信账号",
	"Login account unlinked":                       "已解绑一个第三方登录账号",
	"A change of your email address was requested": "有人申请更换您的账户邮箱",
}

func accountSecurityEventText(event string) string {
	if zh, ok := accountSecurityEventZH[event]; ok {
		return zh
	}
	if provider, ok := strings.CutPrefix(event, "Login account linked: "); ok {
		return "已绑定第三方登录账号：" + provider
	}
	return event
}

// NotifyAccountSecurityChange never includes credentials or tokens. The caller
// records delivery failure independently from the already-committed change.
func NotifyAccountSecurityChange(email, event string) error {
	if email == "" {
		return nil
	}
	subject := fmt.Sprintf("%s账户安全提醒", common.SystemName)
	content := fmt.Sprintf("<p>您好，您的%s账户安全设置发生了变更：%s。</p>"+
		"<p>如果不是本人操作，请立即登录并在「个人设置 → 安全设置」中修改密码、退出其他设备的登录，并联系管理员。</p>",
		common.SystemName, html.EscapeString(accountSecurityEventText(event)))
	return common.SendEmail(subject, email, content)
}
