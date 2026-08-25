package service

import (
	"strings"

	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

func GetUserUsableGroups(userGroup string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	if userGroup != "" {
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// 处理特殊可用分组
			for specialGroup, desc := range specialSettings {
				if strings.HasPrefix(specialGroup, "-:") {
					// 移除分组
					groupToRemove := strings.TrimPrefix(specialGroup, "-:")
					delete(groupsCopy, groupToRemove)
				} else if strings.HasPrefix(specialGroup, "+:") {
					// 添加分组
					groupToAdd := strings.TrimPrefix(specialGroup, "+:")
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

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	groups := GetUserUsableGroups(userGroup)
	autoGroups := make([]string, 0)
	for _, group := range setting.GetAutoGroups() {
		if _, ok := groups[group]; ok {
			autoGroups = append(autoGroups, group)
		}
	}
	return autoGroups
}

// GetUserGroupRatio 获取用户使用某个分组的倍率（只看账号当前分组，不查订阅）。
func GetUserGroupRatio(userGroup, group string) float64 {
	return GetUserGroupRatioWithCoverage(userGroup, group, false)
}

// GetUserGroupRatioWithCoverage 在叠卡场景下，令牌分组只要被生效订阅覆盖，
// 就套该分组自己的专属倍率，不要求 users.group 与令牌分组相同。
func GetUserGroupRatioWithCoverage(userGroup, group string, coveredByActiveSub bool) float64 {
	if ratio, ok := ratio_setting.ResolveSpecialGroupRatio(userGroup, group, coveredByActiveSub); ok {
		return ratio
	}
	return ratio_setting.GetGroupRatio(group)
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
