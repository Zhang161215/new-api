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
//   - 上游给了真实 usage（非本地估算）：照常扣
//   - 本地估算且没有任何补全：不扣。Claude/Kiro 常以 eof 结束且没有 message_start usage，
//     旧逻辑把 eof 当成功单，会按虚高 prompt（可到数百万）结算
//   - scanner_error / timeout / panic / ping_fail 且没有上游 usage：退预扣
//   - client_gone 且没有任何输出：不扣
//   - client_gone 但已有补全 token：按已产出用量扣
func ShouldWaiveFailedStreamBilling(relayInfo *relaycommon.RelayInfo, usage *dto.Usage, localEstimate bool) (bool, string) {
	if relayInfo == nil || !relayInfo.IsStream || relayInfo.StreamStatus == nil {
		return false, ""
	}
	ss := relayInfo.StreamStatus

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
	}

	if localEstimate && !hasOutput {
		return true, failedStreamWaiverNoUsage
	}
	if ss.IsNormalEnd() && !ss.HasErrors() {
		return false, ""
	}
	if hasUpstream || hasOutput {
		return false, ""
	}
	return true, failedStreamWaiverNoUsage
}
