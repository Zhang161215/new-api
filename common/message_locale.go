package common

import (
	"fmt"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
)

// 本站：上游 rc.43 起后台提示和日志内容只给英文 + message_key，由新版前端按 web/src/i18n/locales 翻译。
// classic 前端直接显示 message 字段、日志直接显示 content 列，不认 message_key / content_parts，
// 所以服务端用同一份翻译表把 Message 渲染成读者的语言：
//   - 接口提示（ApiError/ApiSuccessT）按请求语言（I18n 中间件：用户设置 > Accept-Language > DEFAULT_LANGUAGE）；
//   - 日志 content 列按 LogContentLanguage（默认 zh-CN，和 rc.43 之前写死中文的效果一致）。
// message_key / message_params / content_parts 照常返回，新版前端不受影响。翻译表在 main 包 embed 后注册。

// LogContentLanguage 是日志 content 列的渲染语言，LOG_CONTENT_LANGUAGE 可改；设为 en 即恢复上游行为。
var LogContentLanguage = func() string {
	if lang := strings.TrimSpace(os.Getenv("LOG_CONTENT_LANGUAGE")); lang != "" {
		return lang
	}
	return "zh-CN"
}()

// messageLocales 只在 init 阶段写入，之后只读。
var messageLocales = map[string]map[string]string{}

// RegisterMessageLocale 注册一份前端 locale 文件（{"translation": {英文原文: 译文}}），与已注册的条目合并。
func RegisterMessageLocale(lang string, raw []byte) {
	var file struct {
		Translation map[string]string `json:"translation"`
	}
	if err := Unmarshal(raw, &file); err != nil {
		SysError(fmt.Sprintf("failed to load message locale %s: %v", lang, err))
		return
	}
	RegisterMessageTranslations(lang, file.Translation)
}

// RegisterMessageTranslations 合并一批译文；前端 locale 缺的服务端文案用它补，后注册的覆盖先注册的。
func RegisterMessageTranslations(lang string, translations map[string]string) {
	if messageLocales[lang] == nil {
		messageLocales[lang] = map[string]string{}
	}
	for key, value := range translations {
		messageLocales[lang][key] = value
	}
}

func messageLocaleFor(lang string) map[string]string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	switch {
	case lang == "":
		return nil
	case strings.HasPrefix(lang, "zh-tw"), strings.HasPrefix(lang, "zh-hk"), strings.HasPrefix(lang, "zh-mo"), strings.HasPrefix(lang, "zh-hant"):
		return messageLocales["zh-TW"]
	case strings.HasPrefix(lang, "zh"):
		return messageLocales["zh-CN"]
	}
	return nil
}

// Localized 按 lang 渲染消息；没有对应译文时退回英文原文（与 Error() 相同）。
func (m *Message) Localized(lang string) string {
	if m == nil {
		return ""
	}
	template, ok := messageLocaleFor(lang)[m.Key]
	if !ok || template == "" {
		return m.Error()
	}
	return (&Message{Key: template, Params: m.Params}).Error()
}

// RequestLanguage 是这次请求读者的语言：I18n 中间件的检测结果，没有则用 DEFAULT_LANGUAGE。
func RequestLanguage(c *gin.Context) string {
	if c != nil {
		if lang := c.GetString(string(constant.ContextKeyLanguage)); lang != "" {
			return lang
		}
	}
	return DefaultLanguage
}
