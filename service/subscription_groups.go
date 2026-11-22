package service

import (
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// 本站定制（订阅分组计费）。原先放在 relay/helper，上游 rc.21 起 relay/helper 依赖 service，
// 计费会话再反过来调 helper 会形成 import 环，所以挪到 service，helper 那边保留同名转发。

// EnsureActiveSubscriptionGroups 把用户生效订阅的 upgrade_group 集合缓存在 RelayInfo 上。
// 同一请求内 HandleGroupRatio / NewBillingSession / 资金源回落共用，避免重复查库。
func EnsureActiveSubscriptionGroups(relayInfo *relaycommon.RelayInfo) map[string]bool {
	if relayInfo == nil || relayInfo.UserId <= 0 {
		return nil
	}
	if relayInfo.ActiveSubscriptionGroups != nil {
		return relayInfo.ActiveSubscriptionGroups
	}
	groups, err := model.GetActiveSubscriptionUpgradeGroups(relayInfo.UserId)
	if err != nil {
		return nil
	}
	if groups == nil {
		groups = map[string]bool{}
	}
	relayInfo.ActiveSubscriptionGroups = groups
	return groups
}

// UsingGroupCoveredByActiveSub 当前令牌分组是否被用户某张生效订阅覆盖。
// 含 GroupGroupRatio 别名：周卡 upgrade_group=Codex_GPT_PRO 时，
// 配置了 Codex_GPT_PRO→不降智 的专属倍率即可扣同一张卡。
func UsingGroupCoveredByActiveSub(relayInfo *relaycommon.RelayInfo) bool {
	if relayInfo == nil || relayInfo.UsingGroup == "" {
		return false
	}
	return ratio_setting.UsingGroupCoveredByActiveSubs(relayInfo.UsingGroup, EnsureActiveSubscriptionGroups(relayInfo))
}

// HandleGroupRatio checks for "auto_group" in the context and updates the group ratio and relayInfo.UsingGroup if present
func HandleGroupRatio(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) types.GroupRatioInfo {
	groupRatioInfo := types.GroupRatioInfo{
		GroupRatio:        1.0, // default ratio
		GroupSpecialRatio: -1,
	}

	// check auto group
	autoGroup, exists := ctx.Get("auto_group")
	if exists {
		logger.LogDebug(ctx, "final group: %s", autoGroup)
		relayInfo.UsingGroup = autoGroup.(string)
	}

	active := EnsureActiveSubscriptionGroups(relayInfo)
	// 令牌被周卡覆盖：初值就是套餐 1x，不能先套 vip 坐席价。
	// 最终资金源在 NewBillingSession 确定后还会再对齐（钱包才回到 VIP 折扣）。
	if ratio_setting.UsingGroupCoveredByActiveSubs(relayInfo.UsingGroup, active) {
		if special, ok := ratio_setting.ResolveSubscriptionGroupRatio(relayInfo.UserGroup, relayInfo.UsingGroup, active); ok {
			groupRatioInfo.GroupSpecialRatio = special
			groupRatioInfo.GroupRatio = special
			groupRatioInfo.HasSpecialRatio = true
			return groupRatioInfo
		}
		groupRatioInfo.GroupRatio = ratio_setting.GetGroupRatio(relayInfo.UsingGroup)
		return groupRatioInfo
	}

	covered := false
	// 仅在「(userGroup, usingGroup) 对不上，但 usingGroup 自己有专属倍率」时才查订阅。
	// 同组用户（最常见）走第一优先、不增加 DB；无专属倍率的分组也不查。
	if _, ok := ratio_setting.GetGroupGroupRatio(relayInfo.UserGroup, relayInfo.UsingGroup); !ok {
		if _, hasSelf := ratio_setting.GetGroupGroupRatio(relayInfo.UsingGroup, relayInfo.UsingGroup); hasSelf {
			covered = UsingGroupCoveredByActiveSub(relayInfo)
		}
	}
	if special, ok := ratio_setting.ResolveSpecialGroupRatio(relayInfo.UserGroup, relayInfo.UsingGroup, covered); ok {
		groupRatioInfo.GroupSpecialRatio = special
		groupRatioInfo.GroupRatio = special
		groupRatioInfo.HasSpecialRatio = true
	} else {
		groupRatioInfo.GroupRatio = ratio_setting.GetGroupRatio(relayInfo.UsingGroup)
	}

	return groupRatioInfo
}
