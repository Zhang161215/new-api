package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidatePromptAuditAPIKey(t *testing.T) {
	// 留空是「不修改已存密钥」的正常用法
	assert.NoError(t, ValidatePromptAuditAPIKey(""))
	assert.NoError(t, ValidatePromptAuditAPIKey("   "))

	// 正常密钥
	assert.NoError(t, ValidatePromptAuditAPIKey("sk-8c682f359e364c9cb6b84721b128b274"))
	assert.NoError(t, ValidatePromptAuditAPIKey("sk-or-v1-abcdef0123456789abcdef0123456789"))

	// 线上真实事故值：浏览器自动填充塞进来的账号名，15 字符且含 @
	err := ValidatePromptAuditAPIKey("ylfzjt2026161215@")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "@")

	// 纯账号名（不含 @ 但过短）
	err = ValidatePromptAuditAPIKey("ylfzjt20261612")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "长度")

	// 邮箱形态
	assert.Error(t, ValidatePromptAuditAPIKey("admin@example.com"))

	// 粘贴带了空格或换行
	assert.Error(t, ValidatePromptAuditAPIKey("sk-8c682f359e364c9cb6b84721b128b274 "+"extra"))
	assert.Error(t, ValidatePromptAuditAPIKey("sk-8c682f359e364c9cb6b8\n4721b128b274"))
}

func TestValidatePromptAuditAPIKeyBoundary(t *testing.T) {
	// 恰好 20 字符应通过，19 应拒绝——避免边界上下都误判
	assert.NoError(t, ValidatePromptAuditAPIKey("12345678901234567890"))
	assert.Error(t, ValidatePromptAuditAPIKey("1234567890123456789"))
}

func TestValidatePromptAuditNotifyEmail(t *testing.T) {
	// 留空表示回落站内通知渠道
	assert.NoError(t, ValidatePromptAuditNotifyEmail(""))
	assert.NoError(t, ValidatePromptAuditNotifyEmail("  "))

	assert.NoError(t, ValidatePromptAuditNotifyEmail("you@example.com"))
	assert.NoError(t, ValidatePromptAuditNotifyEmail("a@b.com, c@d.cn"))
	assert.NoError(t, ValidatePromptAuditNotifyEmail("a@b.com;c@d.cn"))
	assert.NoError(t, ValidatePromptAuditNotifyEmail("1052607423@qq.com"))

	// 线上真实事故值：填成了用户名，导致告警邮件发不出去
	err := ValidatePromptAuditNotifyEmail("1052607423")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "1052607423")

	// 缺域名后缀 / 缺 @ / @ 在首尾
	assert.Error(t, ValidatePromptAuditNotifyEmail("you@localhost"))
	assert.Error(t, ValidatePromptAuditNotifyEmail("@example.com"))
	assert.Error(t, ValidatePromptAuditNotifyEmail("you@"))

	// 多个地址里只要有一个非法就整体拒绝，避免部分静默失效
	assert.Error(t, ValidatePromptAuditNotifyEmail("ok@example.com, 1052607423"))
}
