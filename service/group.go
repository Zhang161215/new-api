package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

func GetUserUsableGroups(userGroup string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	if userGroup != "" {
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// 处理特殊可用分组
			for specialGroup, desc := range specialSettings {
				if after, ok := strings.CutPrefix(specialGroup, "-:"); ok {
					// 移除分组
					groupToRemove := after
					delete(groupsCopy, groupToRemove)
				} else if after, ok := strings.CutPrefix(specialGroup, "+:"); ok {
					// 添加分组
					groupToAdd := after
					groupsCopy[groupToAdd] = desc
				} else {
					// 直接添加分组
					groupsCopy[specialGroup] = desc
				}
			}
		}
		// 如果userGroup不在UserUsableGroups中，返回UserUsableGroups + userGroup
		if _, ok := groupsCopy[userGroup]; !ok {
			groupsCopy[userGroup] = "用户分组"
		}
	}
	return groupsCopy
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

func IsUserSelectableGroup(userGroup, groupName string) bool {
	if groupName == "" || groupName == "auto" {
		return false
	}
	return GroupInUserUsableGroups(userGroup, groupName) && ratio_setting.ContainsGroupRatio(groupName)
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	autoGroups := make([]string, 0)
	seen := make(map[string]struct{})
	for _, group := range setting.GetAutoGroups() {
		if !IsUserSelectableGroup(userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		autoGroups = append(autoGroups, group)
	}
	return autoGroups
}

// FilterUserTokenAutoGroups applies current permissions before the current
// per-token limit. It intentionally does not fall back to the global Auto list.
func FilterUserTokenAutoGroups(userGroup string, groups []string) []string {
	maxCount := setting.GetMaxTokenAutoGroups()
	filtered := make([]string, 0, min(len(groups), maxCount))
	seen := make(map[string]struct{})
	for _, group := range groups {
		if !IsUserSelectableGroup(userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		filtered = append(filtered, group)
		if len(filtered) == maxCount {
			break
		}
	}
	return filtered
}

// GetRequestAutoGroups resolves the ordered Auto groups for the current token.
// The absence of the context value means that the token inherits the complete
// global Auto list; a present (even empty) value is an explicit token snapshot.
func GetRequestAutoGroups(c *gin.Context, userGroup string) []string {
	value, ok := common.GetContextKey(c, constant.ContextKeyTokenAutoGroups)
	if !ok {
		return GetUserAutoGroup(userGroup)
	}
	groups, ok := value.([]string)
	if !ok {
		return []string{}
	}
	return FilterUserTokenAutoGroups(userGroup, groups)
}

// GetGroupsEnabledModels 按 groups 顺序获取各分组启用的模型并去重
func GetGroupsEnabledModels(groups []string) []string {
	seen := make(map[string]struct{})
	models := make([]string, 0)
	for _, group := range groups {
		for _, modelName := range model.GetGroupEnabledModels(group) {
			if _, ok := seen[modelName]; !ok {
				seen[modelName] = struct{}{}
				models = append(models, modelName)
			}
		}
	}
	return models
}

// GetUserGroupRatio 获取用户使用某个分组的倍率（只看账号当前分组，不查订阅）。
func GetUserGroupRatio(userGroup, group string) float64 {
	return GetUserGroupRatioWithCoverage(userGroup, group, false)
}

// GetUserGroupRatioWithCoverage 兼容旧调用。covered=true 时按「该组自己有订阅」处理。
func GetUserGroupRatioWithCoverage(userGroup, group string, coveredByActiveSub bool) float64 {
	var active map[string]bool
	if coveredByActiveSub {
		active = map[string]bool{group: true}
	}
	return GetUserGroupRatioWithActiveSubs(userGroup, group, active)
}

// GetUserGroupRatioWithActiveSubs 展示用：有覆盖该令牌的周卡时给套餐 1x，
// 否则给钱包倍率（含 VIP 折扣）。订阅从不展示 VIP 坐席价。
func GetUserGroupRatioWithActiveSubs(userGroup, group string, activeGroups map[string]bool) float64 {
	if ratio_setting.UsingGroupCoveredByActiveSubs(group, activeGroups) {
		ratio, _ := ratio_setting.ResolveSubscriptionGroupRatio(userGroup, group, activeGroups)
		return ratio
	}
	ratio, _ := ratio_setting.ResolveWalletGroupRatio(userGroup, group, activeGroups)
	return ratio
}

// IsSpeciallyGrantedGroup checks whether targetGroup was added to userGroup's
// GroupSpecialUsableGroup list (with "+" prefix or direct add).
func IsSpeciallyGrantedGroup(userGroup, targetGroup string) bool {
	specialSettings, ok := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
	if !ok {
		return false
	}
	for key := range specialSettings {
		if strings.HasPrefix(key, "+:") {
			if strings.TrimPrefix(key, "+:") == targetGroup {
				return true
			}
		} else if !strings.HasPrefix(key, "-:") {
			// Direct add (no prefix)
			if key == targetGroup {
				return true
			}
		}
	}
	return false
}
