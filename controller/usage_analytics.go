package controller

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ========== Daily Ranking (all users) ==========

type DailyRankingItem struct {
	Rank              int    `json:"rank"`
	UserId            int    `json:"user_id"`
	Username          string `json:"username"`
	RequestCount      int    `json:"request_count"`
	TotalTokens       int    `json:"total_tokens"`
	TotalQuota        int    `json:"total_quota"`
	SubscriptionQuota int    `json:"subscription_quota"`
	WalletQuota       int    `json:"wallet_quota"`
	IsSelf            bool   `json:"is_self"`
}

// maskUsername hides the middle part of a username for non-admin users.
// "abcdefgh" → "ab****gh", short names get fully masked.
func maskUsername(name string) string {
	runes := []rune(name)
	n := len(runes)
	if n <= 2 {
		return "**"
	}
	if n <= 4 {
		return string(runes[:1]) + "****" + string(runes[n-1:])
	}
	return string(runes[:2]) + "****" + string(runes[n-2:])
}

// parsePeriodRange 按上海时区取「今日 / 本周 / 本月」起点。
// week = 含今天在内的最近 7 天；month = 本月 1 号 0 点。
func parsePeriodRange(raw string) (start, end int64) {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	now := time.Now().In(loc)
	end = now.Unix()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	switch raw {
	case "week":
		start = today.AddDate(0, 0, -6).Unix()
	case "month":
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc).Unix()
	default:
		start = today.Unix()
	}
	return
}

func shanghaiDay(ts int64) string {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	return time.Unix(ts, 0).In(loc).Format("01-02")
}

func shanghaiDateSQL() string {
	if common.UsingPostgreSQL {
		return `to_char(timezone('Asia/Shanghai', to_timestamp(created_at)), 'MM-DD')`
	}
	if common.UsingMySQL {
		return `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(created_at), INTERVAL 8 HOUR), '%m-%d')`
	}
	return `strftime('%m-%d', created_at, 'unixepoch', '+8 hours')`
}

// GetDailyRanking returns period usage ranking visible to all logged-in users.
// GET /api/analytics/daily-ranking?sort=quota&limit=50&range=today|week|month
func GetDailyRanking(c *gin.Context) {
	sortBy := c.DefaultQuery("sort", "quota")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rangeKey := c.DefaultQuery("range", "today")
	startTimestamp, endTimestamp := parsePeriodRange(rangeKey)

	currentUserId := c.GetInt("id")
	currentRole := c.GetInt("role")
	isAdmin := currentRole >= 10

	var results []struct {
		UserId            int    `gorm:"column:user_id"`
		Username          string `gorm:"column:username"`
		RequestCount      int    `gorm:"column:request_count"`
		TotalTokens       int    `gorm:"column:total_tokens"`
		TotalQuota        int    `gorm:"column:total_quota"`
		SubscriptionQuota int    `gorm:"column:subscription_quota"`
		WalletQuota       int    `gorm:"column:wallet_quota"`
	}

	orderCol := "total_quota"
	switch sortBy {
	case "tokens":
		orderCol = "total_tokens"
	case "requests":
		orderCol = "request_count"
	}

	err := model.LOG_DB.Table("logs").
		Select(`user_id, username,
			COUNT(*) as request_count,
			COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens,
			COALESCE(SUM(quota), 0) as total_quota,
			COALESCE(SUM(CASE WHEN other LIKE ? THEN quota ELSE 0 END), 0) as subscription_quota,
			COALESCE(SUM(CASE WHEN other LIKE ? THEN quota ELSE 0 END), 0) as wallet_quota`,
			`%"billing_source":"subscription"%`,
			`%"billing_source":"wallet"%`).
		Where("created_at >= ? AND created_at <= ? AND type = ?", startTimestamp, endTimestamp, model.LogTypeConsume).
		Group("user_id, username").
		Order(orderCol + " DESC").
		Limit(limit).
		Find(&results).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	myRank := 0
	items := make([]DailyRankingItem, len(results))
	var sumSub, sumWallet, sumQuota int
	for i, r := range results {
		username := r.Username
		if !isAdmin && r.UserId != currentUserId {
			username = maskUsername(username)
		}
		isSelf := r.UserId == currentUserId
		if isSelf {
			myRank = i + 1
		}
		items[i] = DailyRankingItem{
			Rank:              i + 1,
			UserId:            r.UserId,
			Username:          username,
			RequestCount:      r.RequestCount,
			TotalTokens:       r.TotalTokens,
			TotalQuota:        r.TotalQuota,
			SubscriptionQuota: r.SubscriptionQuota,
			WalletQuota:       r.WalletQuota,
			IsSelf:            isSelf,
		}
		sumSub += r.SubscriptionQuota
		sumWallet += r.WalletQuota
		sumQuota += r.TotalQuota
	}

	var totalUsers int64
	model.LOG_DB.Table("logs").
		Where("created_at >= ? AND created_at <= ? AND type = ?", startTimestamp, endTimestamp, model.LogTypeConsume).
		Distinct("user_id").
		Count(&totalUsers)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":       items,
			"my_rank":     myRank,
			"total_users": totalUsers,
			"range":       rangeKey,
			"start":       startTimestamp,
			"end":         endTimestamp,
			// 仅排行榜前 N 的合计，控制台全站总额请走 station-overview / log/stat
			"subscription_quota": sumSub,
			"wallet_quota":       sumWallet,
			"total_quota":        sumQuota,
		},
	})
}

// GetStationOverview 中转站数据控制台：消耗拆分、模型分布、充值/订阅收入、渠道概况。
// GET /api/analytics/station-overview?range=today|week|month
func GetStationOverview(c *gin.Context) {
	rangeKey := c.DefaultQuery("range", "today")
	start, end := parsePeriodRange(rangeKey)

	stat, err := model.SumUsedQuota(model.LogTypeConsume, start, end, "", "", "", 0, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}

	var requestCount int64
	model.LOG_DB.Table("logs").
		Where("created_at >= ? AND created_at <= ? AND type = ?", start, end, model.LogTypeConsume).
		Count(&requestCount)
	var activeUsers int64
	model.LOG_DB.Table("logs").
		Where("created_at >= ? AND created_at <= ? AND type = ?", start, end, model.LogTypeConsume).
		Distinct("user_id").
		Count(&activeUsers)

	type modelRow struct {
		ModelName string `gorm:"column:model_name" json:"name"`
		Quota     int    `gorm:"column:quota" json:"quota"`
		Count     int    `gorm:"column:count" json:"count"`
	}
	var models []modelRow
	model.DB.Table("quota_data").
		Select("model_name, COALESCE(SUM(quota),0) as quota, COALESCE(SUM(count),0) as count").
		Where("created_at >= ? AND created_at <= ?", start, end).
		Group("model_name").
		Order("quota DESC").
		Limit(12).
		Find(&models)

	// 订阅成功时也会写入 top_ups（upsertSubscriptionTopUpTx），只读这一张表，避免和 subscription_orders 重复加。
	type moneyRow struct {
		Money        float64
		CompleteTime int64
		Amount       int64
		TradeNo      string
	}
	var paid []moneyRow
	model.DB.Model(&model.TopUp{}).
		Select("money, complete_time, amount, trade_no").
		Where("status = ? AND complete_time >= ? AND complete_time <= ?", common.TopUpStatusSuccess, start, end).
		Find(&paid)

	type dayBucket struct {
		Date         string  `json:"date"`
		Topup        float64 `json:"topup"`
		Subscription float64 `json:"subscription"`
	}
	byDay := map[string]*dayBucket{}
	var topupSum, subSum float64
	var topupN, subN int
	for _, row := range paid {
		trade := strings.ToUpper(row.TradeNo)
		isSub := row.Amount == 0 && strings.HasPrefix(trade, "SUB")
		day := shanghaiDay(row.CompleteTime)
		b := byDay[day]
		if b == nil {
			b = &dayBucket{Date: day}
			byDay[day] = b
		}
		if isSub {
			b.Subscription += row.Money
			subSum += row.Money
			subN++
		} else {
			b.Topup += row.Money
			topupSum += row.Money
			topupN++
		}
	}
	daily := make([]dayBucket, 0, len(byDay))
	for _, b := range byDay {
		daily = append(daily, *b)
	}
	sort.Slice(daily, func(i, j int) bool { return daily[i].Date < daily[j].Date })

	type consumeDayRow struct {
		Date              string `gorm:"column:date"`
		Quota             int    `gorm:"column:quota"`
		SubscriptionQuota int    `gorm:"column:subscription_quota"`
		WalletQuota       int    `gorm:"column:wallet_quota"`
	}
	dateSQL := shanghaiDateSQL()
	var consumeRows []consumeDayRow
	model.LOG_DB.Table("logs").
		Select(dateSQL+` as date,
			COALESCE(SUM(quota),0) as quota,
			COALESCE(SUM(CASE WHEN other LIKE ? THEN quota ELSE 0 END),0) as subscription_quota,
			COALESCE(SUM(CASE WHEN other LIKE ? THEN quota ELSE 0 END),0) as wallet_quota`,
			`%"billing_source":"subscription"%`,
			`%"billing_source":"wallet"%`).
		Where("created_at >= ? AND created_at <= ? AND type = ?", start, end, model.LogTypeConsume).
		Group(dateSQL).
		Order(dateSQL).
		Find(&consumeRows)
	consumeDaily := make([]gin.H, 0, len(consumeRows))
	for _, row := range consumeRows {
		consumeDaily = append(consumeDaily, gin.H{
			"date":               row.Date,
			"quota":              row.Quota,
			"subscription_quota": row.SubscriptionQuota,
			"wallet_quota":       row.WalletQuota,
		})
	}

	var usersEnabled, tokensEnabled, channelsEnabled, channelsDisabled, activeSubs int64
	model.DB.Model(&model.User{}).Where("status = ?", common.UserStatusEnabled).Count(&usersEnabled)
	model.DB.Model(&model.Token{}).Where("status = ?", common.TokenStatusEnabled).Count(&tokensEnabled)
	model.DB.Model(&model.Channel{}).Where("status = ?", common.ChannelStatusEnabled).Count(&channelsEnabled)
	model.DB.Model(&model.Channel{}).Where("status <> ?", common.ChannelStatusEnabled).Count(&channelsDisabled)
	model.DB.Model(&model.UserSubscription{}).
		Where("status = ? AND end_time > ?", "active", time.Now().Unix()).
		Count(&activeSubs)

	unmarked := stat.Quota - stat.SubscriptionQuota - stat.WalletQuota
	if unmarked < 0 {
		unmarked = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"range": rangeKey,
			"start": start,
			"end":   end,
			"consume": gin.H{
				"quota":              stat.Quota,
				"subscription_quota": stat.SubscriptionQuota,
				"wallet_quota":       stat.WalletQuota,
				"unmarked_quota":     unmarked,
				"requests":           requestCount,
				"tokens":             0,
				"users":              activeUsers,
				"rpm":                stat.Rpm,
				"tpm":                stat.Tpm,
			},
			"models":        models,
			"consume_daily": consumeDaily,
			"revenue": gin.H{
				"topup_amount":        topupSum,
				"subscription_amount": subSum,
				"topup_count":         topupN,
				"subscription_count":  subN,
				"daily":               daily,
			},
			"station": gin.H{
				"users_enabled":        usersEnabled,
				"tokens_enabled":       tokensEnabled,
				"channels_enabled":     channelsEnabled,
				"channels_disabled":    channelsDisabled,
				"active_subscriptions": activeSubs,
			},
		},
	})
}
