package controller

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetCheckinStatus 获取用户签到状态和历史记录
func GetCheckinStatus(c *gin.Context) {
	setting := operation_setting.GetCheckinSetting()
	if !setting.Enabled {
		common.ApiErrorMsg(c, "签到功能未启用")
		return
	}
	userId := c.GetInt("id")
	// 获取月份参数，默认为当前月份
	month := c.DefaultQuery("month", time.Now().Format("2006-01"))

	stats, err := model.GetUserCheckinStats(userId, month)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 检查用户是否满足最低充值金额要求
	topupEligible := true
	var userTopUpAmount float64
	if setting.MinTopUpAmount > 0 {
		userTopUpAmount, _ = model.GetUserTotalTopUpAmount(userId)
		if userTopUpAmount < setting.MinTopUpAmount {
			topupEligible = false
		}
	}

	// 双倍日信息下发给前端渲染日历角标与「今日双倍」提示。
	// today_is_double 由后端算而非前端自己比对星期，保证提示与实际发放同源
	// （两边各判一次迟早会走偏）。
	doubleWeekdays := setting.DoubleWeekdays
	if doubleWeekdays == nil || setting.DoubleMultiplier <= 1 {
		// nil 会序列化成 null 让前端多一层判空；倍数无效时对外统一呈现为
		// 「未开启翻倍」，前端不必再判一遍
		doubleWeekdays = []int{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"enabled":           setting.Enabled,
			"min_quota":         setting.MinQuota,
			"max_quota":         setting.MaxQuota,
			"min_topup_amount":  setting.MinTopUpAmount,
			"topup_eligible":    topupEligible,
			"user_topup_total":  userTopUpAmount,
			"stats":             stats,
			"double_weekdays":   doubleWeekdays,
			"double_multiplier": setting.DoubleMultiplier,
			"today_is_double":   operation_setting.CheckinMultiplierFor(time.Now()) > 1,
		},
	})
}

// DoCheckin 执行用户签到
func DoCheckin(c *gin.Context) {
	setting := operation_setting.GetCheckinSetting()
	if !setting.Enabled {
		common.ApiErrorMsg(c, "签到功能未启用")
		return
	}

	userId := c.GetInt("id")

	// 校验最低充值金额
	if setting.MinTopUpAmount > 0 {
		userTopUpAmount, err := model.GetUserTotalTopUpAmount(userId)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "查询充值记录失败",
			})
			return
		}
		if userTopUpAmount < setting.MinTopUpAmount {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("累计充值满 %.2f 元后可使用签到功能，当前累计充值 %.2f 元", setting.MinTopUpAmount, userTopUpAmount),
			})
			return
		}
	}

	checkin, err := model.UserCheckin(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("用户签到，获得额度 %s", logger.LogQuota(checkin.QuotaAwarded)))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "签到成功",
		"data": gin.H{
			"quota_awarded": checkin.QuotaAwarded,
			"checkin_date":  checkin.CheckinDate},
	})
}
