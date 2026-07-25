package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseAuditVerdict_Plain(t *testing.T) {
	conf, reason, ok := ParseAuditVerdict(`{"confidence": 0.95, "reason": "爆破他人口令"}`)
	require.True(t, ok)
	require.InDelta(t, 0.95, conf, 1e-9)
	require.Equal(t, "爆破他人口令", reason)
}

func TestParseAuditVerdict_CodeFence(t *testing.T) {
	conf, _, ok := ParseAuditVerdict("```json\n{\"confidence\": 0.0, \"reason\": \"\"}\n```")
	require.True(t, ok)
	require.InDelta(t, 0.0, conf, 1e-9)
}

func TestParseAuditVerdict_WithSurroundingProse(t *testing.T) {
	conf, _, ok := ParseAuditVerdict("判定结果如下：\n{\"confidence\": 0.8, \"reason\": \"批量养号\"}\n以上。")
	require.True(t, ok)
	require.InDelta(t, 0.8, conf, 1e-9)
}

func TestParseAuditVerdict_Unparseable(t *testing.T) {
	_, _, ok := ParseAuditVerdict("我不能协助这个请求")
	require.False(t, ok)
}

func TestTruncateRunes_MultiByte(t *testing.T) {
	require.Equal(t, "中文测试", TruncateRunes("中文测试内容", 4))
	require.Equal(t, "短", TruncateRunes("短", 10))
}

func TestResolveAuditURL(t *testing.T) {
	cases := map[string]string{
		// 只填站点根地址：自动补 /v1（管理员最常见的填法）
		"https://api.synai996.space":    "https://api.synai996.space/v1/chat/completions",
		"https://api.deepseek.com":      "https://api.deepseek.com/v1/chat/completions",
		"https://api.deepseek.com/":     "https://api.deepseek.com/v1/chat/completions",
		"http://new-api-deploy-v3:3000": "http://new-api-deploy-v3:3000/v1/chat/completions",
		// 已带版本段：不重复补
		"https://api.openai.com/v1":            "https://api.openai.com/v1/chat/completions",
		"https://api.openai.com/v1/":           "https://api.openai.com/v1/chat/completions",
		"https://open.bigmodel.cn/api/paas/v4": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
		"https://x.com/v1beta":                 "https://x.com/v1beta/chat/completions",
		// 已是完整端点：原样使用
		"https://api.deepseek.com/v1/chat/completions": "https://api.deepseek.com/v1/chat/completions",
		// 空值
		"": "",
	}
	for in, want := range cases {
		require.Equal(t, want, ResolveAuditURL(in), "输入 %q", in)
	}
}
