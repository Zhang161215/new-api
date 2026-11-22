package router

import (
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// 上游 rc.27 把 POST /v1/responses 挪到了插件协议路由，这里钉住它仍经过前置提示词审核，
// 防止以后合并上游时又被冲掉（Responses 是 Codex 的主要流量）。
func TestResponsesCreateRouteRunsPromptAudit(t *testing.T) {
	handlers, err := taskPluginProtocolHandlers("openai_responses", "create")
	require.NoError(t, err)
	names := make([]string, 0, len(handlers))
	auditAt, distributeAt := -1, -1
	for i, h := range handlers {
		name := runtime.FuncForPC(reflect.ValueOf(h).Pointer()).Name()
		names = append(names, name)
		if strings.Contains(name, ".PromptAudit.") {
			auditAt = i
		}
		if strings.Contains(name, ".Distribute.") {
			distributeAt = i
		}
	}
	require.NotEqual(t, -1, auditAt, "POST /v1/responses 必须经过 PromptAudit，实际链：%v", names)
	require.Greater(t, auditAt, distributeAt, "PromptAudit 要在 Distribute 之后（需要渠道/分组信息）")
}
