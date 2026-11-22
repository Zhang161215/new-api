package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// DeleteHistoryLogs 旧的同步删日志接口（DELETE /api/log/）。
// 上游 7-20 随 classic 前端一起删了，新版前端改走 POST /api/system-task/log-cleanup。
// 本站继续用 classic（设置 → 日志 → 清除历史日志），所以保留。
func DeleteHistoryLogs(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "target timestamp is required",
		})
		return
	}
	count, err := deleteOldLogs(c, targetTimestamp, 100)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
}

func deleteOldLogs(c *gin.Context, targetTimestamp int64, limit int) (int64, error) {
	ctx := c.Request.Context()
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		rowsAffected, err := model.DeleteOldLogBatch(ctx, targetTimestamp, limit)
		if err != nil {
			return total, err
		}
		total += rowsAffected
		if rowsAffected < int64(limit) {
			return total, nil
		}
	}
}
