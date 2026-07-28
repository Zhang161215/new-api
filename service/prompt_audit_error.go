package service

import (
	"errors"
	"fmt"
	"strings"
)

// 审核失败的分类。三类失败的处置完全不同，混在一起会导致最危险的内容被放行。
type PromptAuditFailKind int

const (
	// PromptAuditFailTransport 传输层失败：超时、429、5xx、连接重置。
	// 与内容无关，回退备用节点；备用也失败才按 FailOpen 处置。
	PromptAuditFailTransport PromptAuditFailKind = iota
	// PromptAuditFailModeration 审核节点自身的平台风控拒答。
	// 线上实测 mimo 对未成年人性内容、色情站点搭建直接返回
	// "The request was rejected because it was considered high risk"。
	// 这类响应恰恰说明内容极可能违规——绝不能 fail-open，必须回退复判。
	PromptAuditFailModeration
	// PromptAuditFailUnparsable 输出拿到了但解析不出裁决：
	// 被待审内容劫持去执行其中的任务、或推理占满预算导致 JSON 截断。
	PromptAuditFailUnparsable
)

func (k PromptAuditFailKind) String() string {
	switch k {
	case PromptAuditFailModeration:
		return "moderation_refusal"
	case PromptAuditFailUnparsable:
		return "unparsable"
	default:
		return "transport"
	}
}

// PromptAuditError 带分类的审核失败
type PromptAuditError struct {
	Kind  PromptAuditFailKind
	Node  string // 出错的节点标识（primary / fallback）
	Model string
	Err   error
}

func (e *PromptAuditError) Error() string {
	return fmt.Sprintf("[%s/%s %s] %v", e.Node, e.Model, e.Kind, e.Err)
}

func (e *PromptAuditError) Unwrap() error { return e.Err }

// newPromptAuditError 包一层分类信息
func newPromptAuditError(kind PromptAuditFailKind, node, model string, err error) *PromptAuditError {
	return &PromptAuditError{Kind: kind, Node: node, Model: model, Err: err}
}

// PromptAuditFailKindOf 取出失败分类，非本包错误按传输层处理
func PromptAuditFailKindOf(err error) PromptAuditFailKind {
	var e *PromptAuditError
	if errors.As(err, &e) {
		return e.Kind
	}
	return PromptAuditFailTransport
}

// IsPromptAuditModerationRefusal 是否为上游平台风控拒答
func IsPromptAuditModerationRefusal(err error) bool {
	return PromptAuditFailKindOf(err) == PromptAuditFailModeration
}

// promptAuditModerationMarkers 上游风控拒答的特征串。
// 这些是各家网关在自身安全策略拒绝处理请求时的固定措辞，
// 与「模型判定内容违规」是两件事：前者没有给出裁决，后者给了。
var promptAuditModerationMarkers = []string{
	// 小米 mimo（线上实测）
	"considered high risk",
	"request was rejected because",
	// 常见中文网关
	"内容安全",
	"内容审核不通过",
	"命中敏感",
	"包含敏感信息",
	"风险内容",
	"违规内容",
	// OpenAI / Azure 系
	"content_filter",
	"content management policy",
	"responsible ai",
	"content_policy_violation",
	// 通用
	"flagged by",
	"safety system",
	"prohibited content",
}

// looksLikeModerationRefusal 判断一段上游响应文本是否为平台风控拒答。
//
// 注意范围要收紧：待审内容本身常包含「违规」「内容安全」这类词（例如管理员送审的
// 是一份内容审核规则），而这里检查的是**上游返回的响应体**，不是待审内容，
// 所以不会互相污染。
func looksLikeModerationRefusal(body string) bool {
	if strings.TrimSpace(body) == "" {
		return false
	}
	lower := strings.ToLower(body)
	for _, m := range promptAuditModerationMarkers {
		if strings.Contains(lower, strings.ToLower(m)) {
			return true
		}
	}
	return false
}
