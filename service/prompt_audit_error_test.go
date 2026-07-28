package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLooksLikeModerationRefusal(t *testing.T) {
	// 线上实测：小米 mimo 对未成年人性内容、色情站点搭建的拒答原文
	assert.True(t, looksLikeModerationRefusal(
		"The request was rejected because it was considered high risk"))
	// 大小写不敏感
	assert.True(t, looksLikeModerationRefusal("REQUEST WAS REJECTED BECAUSE of policy"))
	// 常见中文网关措辞
	assert.True(t, looksLikeModerationRefusal("很抱歉，您的请求命中敏感词"))
	assert.True(t, looksLikeModerationRefusal(`{"error":{"message":"内容审核不通过"}}`))
	// OpenAI / Azure 系
	assert.True(t, looksLikeModerationRefusal(`{"error":{"code":"content_filter"}}`))
	assert.True(t, looksLikeModerationRefusal("blocked by our content management policy"))

	// 正常裁决不能被误判成拒答，否则每条合规请求都会触发回退
	assert.False(t, looksLikeModerationRefusal(`{"confidence": 0.00, "reason": ""}`))
	assert.False(t, looksLikeModerationRefusal(`{"confidence": 0.95, "reason": "色情角色扮演"}`))
	assert.False(t, looksLikeModerationRefusal(""))
	assert.False(t, looksLikeModerationRefusal("   "))
	// 传输层错误不是风控拒答
	assert.False(t, looksLikeModerationRefusal(`{"error":{"message":"Too many requests"}}`))
	assert.False(t, looksLikeModerationRefusal("context deadline exceeded"))
}

func TestLooksLikeModerationRefusalDoesNotMatchVerdictText(t *testing.T) {
	// 关键回归：模型判定「内容违规」时给出的 reason 里会出现"违规内容"字样，
	// 但那是合法裁决（已带 confidence），不该被当成拒答。
	// 这里检查的是完整响应体，裁决 JSON 中的 reason 不应触发误判。
	verdict := `{"choices":[{"message":{"content":"{\"confidence\":0.95,\"reason\":\"色情角色扮演请求\"}"}}]}`
	assert.False(t, looksLikeModerationRefusal(verdict))
}

func TestPromptAuditErrorKindAndUnwrap(t *testing.T) {
	base := errors.New("boom")
	e := newPromptAuditError(PromptAuditFailModeration, "primary", "mimo-v2.5", base)

	assert.Equal(t, PromptAuditFailModeration, e.Kind)
	assert.Contains(t, e.Error(), "primary")
	assert.Contains(t, e.Error(), "mimo-v2.5")
	assert.Contains(t, e.Error(), "moderation_refusal")
	assert.True(t, errors.Is(e, base), "应能 unwrap 到原始错误")
}

func TestPromptAuditFailKindOf(t *testing.T) {
	assert.Equal(t, PromptAuditFailModeration,
		PromptAuditFailKindOf(newPromptAuditError(PromptAuditFailModeration, "p", "m", errors.New("x"))))
	assert.Equal(t, PromptAuditFailUnparsable,
		PromptAuditFailKindOf(newPromptAuditError(PromptAuditFailUnparsable, "p", "m", errors.New("x"))))
	// 非本包错误按传输层处理（最保守：允许 fail-open 由配置决定）
	assert.Equal(t, PromptAuditFailTransport, PromptAuditFailKindOf(errors.New("plain")))
	assert.Equal(t, PromptAuditFailTransport, PromptAuditFailKindOf(nil))
}

func TestIsPromptAuditModerationRefusalThroughWrapping(t *testing.T) {
	inner := newPromptAuditError(PromptAuditFailModeration, "fallback", "m", errors.New("high risk"))
	// RunPromptAudit 在两级都失败时会用 %w 再包一层，分类必须仍能识别出来，
	// 否则风控拒答会退化成普通失败被 fail-open 放行
	wrapped := fmt.Errorf("主节点失败(x)；备用节点亦失败: %w", inner)
	assert.True(t, IsPromptAuditModerationRefusal(wrapped))

	transport := newPromptAuditError(PromptAuditFailTransport, "fallback", "m", errors.New("timeout"))
	assert.False(t, IsPromptAuditModerationRefusal(fmt.Errorf("wrap: %w", transport)))
}

func TestPromptAuditFallbackStats(t *testing.T) {
	ResetPromptAuditFallbackStats()
	total, mod, ok := GetPromptAuditFallbackStats()
	assert.Equal(t, int64(0), total)
	assert.Equal(t, int64(0), mod)
	assert.Equal(t, int64(0), ok)

	recordPromptAuditFallback(PromptAuditFailTransport)
	recordPromptAuditFallback(PromptAuditFailModeration)
	recordPromptAuditFallback(PromptAuditFailModeration)
	recordPromptAuditFallbackSuccess()

	total, mod, ok = GetPromptAuditFallbackStats()
	assert.Equal(t, int64(3), total)
	assert.Equal(t, int64(2), mod, "风控拒答触发的回退要单独计数")
	assert.Equal(t, int64(1), ok)
	ResetPromptAuditFallbackStats()
}

func TestPromptAuditFailKindString(t *testing.T) {
	assert.Equal(t, "moderation_refusal", PromptAuditFailModeration.String())
	assert.Equal(t, "unparsable", PromptAuditFailUnparsable.String())
	assert.Equal(t, "transport", PromptAuditFailTransport.String())
}

func TestParseAuditVerdictRequiresConfidenceField(t *testing.T) {
	// 正常裁决
	conf, reason, ok := ParseAuditVerdict(`{"confidence": 0.95, "reason": "色情内容"}`)
	assert.True(t, ok)
	assert.Equal(t, 0.95, conf)
	assert.Equal(t, "色情内容", reason)

	// 合规裁决：confidence 显式为 0 必须被接受
	conf, _, ok = ParseAuditVerdict(`{"confidence": 0.00, "reason": ""}`)
	assert.True(t, ok, "显式的 confidence=0 是合法裁决")
	assert.Equal(t, 0.0, conf)

	// 带 ```json 围栏
	conf, _, ok = ParseAuditVerdict("```json\n{\"confidence\": 0.9, \"reason\": \"x\"}\n```")
	assert.True(t, ok)
	assert.Equal(t, 0.9, conf)

	// 关键回归：审核模型被待审内容劫持，输出了任务结果而非裁决。
	// 这类 JSON 能被解析但没有 confidence，早期版本会取零值当成「合规」静默放行，
	// 这是线上大量请求实际未被审核的根因，必须判定为解析失败。
	for _, hijacked := range []string{
		`{"id": 5688, "name": "常熟开关/塑壳断路器", "reason": "匹配类目"}`,
		`{"dedup": false}`,
		`{"reason": "内容为正常开发任务"}`,
		`{}`,
	} {
		_, _, ok = ParseAuditVerdict(hijacked)
		assert.False(t, ok, "缺少 confidence 字段不能算有效裁决: %s", hijacked)
	}

	// Go 的 json 字段匹配大小写不敏感，模型偶尔首字母大写也应接受
	conf, _, ok = ParseAuditVerdict(`{"Confidence": 0.9, "Reason": "x"}`)
	assert.True(t, ok, "大小写变体应正常解析")
	assert.Equal(t, 0.9, conf)

	// 截断与非 JSON
	_, _, ok = ParseAuditVerdict(`{"confidence": 0.9`)
	assert.False(t, ok)
	_, _, ok = ParseAuditVerdict("")
	assert.False(t, ok)
	_, _, ok = ParseAuditVerdict("The request was rejected because it was considered high risk")
	assert.False(t, ok)
}
