package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func GetGroups(c *gin.Context) {
	groupNames := make([]string, 0)
	for groupName := range ratio_setting.GetGroupRatioCopy() {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]interface{})
	userGroup := ""
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	userUsableGroups := service.GetUserUsableGroups(userGroup)
	allGroupRatios := ratio_setting.GetGroupRatioCopy()
	for groupName := range allGroupRatios {
		desc := setting.GetUsableGroupDescription(groupName)
		if usableDesc, ok := userUsableGroups[groupName]; ok {
			desc = usableDesc
		}
		if desc == "" {
			desc = groupName
		}
		usableGroups[groupName] = map[string]interface{}{
			"ratio":    service.GetUserGroupRatio(userGroup, groupName),
			"desc":     desc,
			"disabled": !service.GroupInUserUsableGroups(userGroup, groupName),
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		usableGroups["auto"] = map[string]interface{}{
			"ratio":    "自动",
			"desc":     setting.GetUsableGroupDescription("auto"),
			"disabled": false,
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}
