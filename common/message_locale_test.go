package common

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestMessageLocalized(t *testing.T) {
	saved := messageLocales
	t.Cleanup(func() { messageLocales = saved })
	messageLocales = map[string]map[string]string{}
	RegisterMessageLocale("zh-CN", []byte(`{"translation":{"Quota exceeds {{max}}":"额度超过 {{max}}","Plain":"普通"}}`))
	RegisterMessageLocale("zh-TW", []byte(`{"translation":{"Plain":"普通（繁）"}}`))

	msg := NewMessage("Quota exceeds {{max}}", map[string]any{"max": 5})
	assert.Equal(t, "额度超过 5", msg.Localized("zh-CN"))
	assert.Equal(t, "额度超过 5", msg.Localized("zh"))
	assert.Equal(t, "Quota exceeds 5", msg.Localized("en"))
	assert.Equal(t, "Quota exceeds 5", msg.Localized(""))
	assert.Equal(t, "Quota exceeds 5", msg.Localized("zh-TW"), "繁体表里没有时退回英文")
	assert.Equal(t, "普通（繁）", NewMessage("Plain").Localized("zh-Hant-TW"))
	assert.Equal(t, "未翻译 {{x}}", NewMessage("未翻译 {{x}}").Localized("zh-CN"))

	// 本站补充译文与前端 locale 合并，不覆盖掉已有条目
	RegisterMessageTranslations("zh-CN", map[string]string{"Extra": "补充"})
	assert.Equal(t, "补充", NewMessage("Extra").Localized("zh-CN"))
	assert.Equal(t, "普通", NewMessage("Plain").Localized("zh-CN"))

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(string(constant.ContextKeyLanguage), "zh-CN")
	ApiErrorT(c, "Quota exceeds {{max}}", map[string]any{"max": 7})
	assert.JSONEq(t, `{"success":false,"message":"额度超过 7","message_key":"Quota exceeds {{max}}","message_params":{"max":7}}`, w.Body.String())
}
