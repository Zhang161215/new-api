package ratio_setting

import (
	"encoding/json"
	"errors"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	"default": 1,
	"vip":     1,
	"svip":    1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

var defaultGroupGroupRatio = map[string]map[string]float64{
	"vip": {
		"edit_this": 0.9,
	},
}

var groupGroupRatioMap = types.NewRWMap[string, map[string]float64]()

var defaultGroupSpecialUsableGroup = map[string]map[string]string{
	"vip": {
		"append_1":   "vip_special_group_1",
		"-:remove_1": "vip_removed_group_1",
	},
}

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]            `json:"group_ratio"`
	GroupGroupRatio         *types.RWMap[string, map[string]float64] `json:"group_group_ratio"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string]  `json:"group_special_usable_group"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)
	groupGroupRatioMap.AddAll(defaultGroupGroupRatio)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	return groupRatioMap.ReadAll()
}

func ContainsGroupRatio(name string) bool {
	_, ok := groupRatioMap.Get(name)
	return ok
}

func GroupRatio2JSONString() string {
	return groupRatioMap.MarshalJSONString()
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	ratio, ok := groupRatioMap.Get(name)
	if !ok {
		common.SysLog("group ratio not found: " + name)
		return 1
	}
	return ratio
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	gp, ok := groupGroupRatioMap.Get(userGroup)
	if !ok {
		return -1, false
	}
	ratio, ok := gp[usingGroup]
	if !ok {
		return -1, false
	}
	return ratio, true
}

// CoveringSubscriptionGroup 返回覆盖 usingGroup 的那张生效订阅分组。
//
// 先精确匹配 upgrade_group；否则看 GroupGroupRatio[upgradeGroup][usingGroup]
// 是否已配置（管理端给周卡加的别名，例如 Codex_GPT_PRO → Codex_GPT_BPS[不降智]）。
// 多个父分组同时命中时按名字排序取第一个，保证扣费顺序稳定。
func CoveringSubscriptionGroup(usingGroup string, activeGroups map[string]bool) (string, bool) {
	if usingGroup == "" || len(activeGroups) == 0 {
		return "", false
	}
	if activeGroups[usingGroup] {
		return usingGroup, true
	}
	parents := make([]string, 0, 2)
	for g := range activeGroups {
		if g == "" || g == usingGroup {
			continue
		}
		if _, ok := GetGroupGroupRatio(g, usingGroup); ok {
			parents = append(parents, g)
		}
	}
	if len(parents) == 0 {
		return "", false
	}
	sort.Strings(parents)
	return parents[0], true
}

// UsingGroupCoveredByActiveSubs 当前令牌分组是否应由订阅额度支付。
func UsingGroupCoveredByActiveSubs(usingGroup string, activeGroups map[string]bool) bool {
	_, ok := CoveringSubscriptionGroup(usingGroup, activeGroups)
	return ok
}

// ResolveSpecialGroupRatio 决定这次请求该不该套 GroupGroupRatio 里的专属倍率。
//
// 第一优先：配置里有 [userGroup][usingGroup]（用户当前就坐在该分组里）。
// 第二优先：usingGroup 自己配了 [usingGroup][usingGroup]，且调用方确认用户
// 持有覆盖该令牌分组的生效订阅。这是为了叠卡：后买的套餐会覆盖 users.group，
// 但先买的那张订阅仍应按自己的专属倍率扣（线上 1688 Ethan：账号被日卡改成
// Claude_Aws 后，GPT 月卡从 1x 错成 0.3x）。
//
// coveredByActiveSub 必须由调用方按「usingGroup 是否被生效订阅覆盖」传入，
// 本函数不查库。覆盖包含 upgrade_group 精确匹配，以及 GroupGroupRatio 别名。
func ResolveSpecialGroupRatio(userGroup, usingGroup string, coveredByActiveSub bool) (float64, bool) {
	if ratio, ok := GetGroupGroupRatio(userGroup, usingGroup); ok {
		return ratio, true
	}
	if coveredByActiveSub && usingGroup != "" {
		if ratio, ok := GetGroupGroupRatio(usingGroup, usingGroup); ok {
			return ratio, true
		}
	}
	return -1, false
}

func GroupGroupRatio2JSONString() string {
	return groupGroupRatioMap.MarshalJSONString()
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupGroupRatioMap, jsonStr)
}

func CheckGroupRatio(jsonStr string) error {
	checkGroupRatio := make(map[string]float64)
	err := json.Unmarshal([]byte(jsonStr), &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}
