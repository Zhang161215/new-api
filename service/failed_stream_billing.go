package service

import (
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

const (
	failedStreamWaiverClientGone = "客户端中断且无输出，已退预扣"
	failedStreamWaiverNoUsage    = "流失败且无上游用量，已退预扣"
)

// ShouldWaiveFailedStreamBilling 流未成功时是否整笔退预扣、禁止本地估算扣费。
//
// 规则：
//   - 流完整结束（done/eof/handler_stop）：照常扣
//   - 上游给了真实 usage（非本地估算）：照常扣
//   - scanner_error / timeout / panic / ping_fail 且没有上游 usage：退预扣
//   - client_gone 且没有任何输出：不扣
//   - client_gone 但已有补全 token：按已产出用量扣
func ShouldWaiveFailedStreamBilling(relayInfo *relaycommon.RelayInfo, usage *dto.Usage, localEstimate bool) (bool, string) {
	if relayInfo == nil || !relayInfo.IsStream || relayInfo.StreamStatus == nil {
		return false, ""
	}
	ss := relayInfo.StreamStatus
	if ss.IsNormalEnd() && !ss.HasErrors() {
		return false, ""
	}

	hasOutput := usage != nil && usage.CompletionTokens > 0
	hasUpstream := usage != nil && ValidUsage(usage) && !localEstimate

	switch ss.EndReason {
	case relaycommon.StreamEndReasonClientGone:
		if hasOutput {
			return false, ""
		}
		return true, failedStreamWaiverClientGone
	case relaycommon.StreamEndReasonScannerErr, relaycommon.StreamEndReasonTimeout,
		relaycommon.StreamEndReasonPanic, relaycommon.StreamEndReasonPingFail:
		if hasUpstream {
			return false, ""
		}
		return true, failedStreamWaiverNoUsage
	default:
		if ss.IsNormalEnd() {
			return false, ""
		}
		if hasUpstream || hasOutput {
			return false, ""
		}
		return true, failedStreamWaiverNoUsage
	}
}
