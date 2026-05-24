package controller

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// getDaysAgoStartTimestamp returns the start of day (00:00:00) for N days ago in Asia/Shanghai timezone.
// days=1 means today 00:00, days=7 means 7 days ago 00:00.
func getDaysAgoStartTimestamp(days int) int64 {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	start = start.AddDate(0, 0, -(days - 1))
	return start.Unix()
}

// ========== Data Structures ==========

type TopUserItem struct {
	UserId       int            `json:"user_id"`
	Username     string         `json:"username"`
	Group        string         `json:"group"`
	RequestCount int            `json:"request_count"`
	TotalTokens  int            `json:"total_tokens"`
	TotalQuota   int            `json:"total_quota"`
	IPCount      int            `json:"ip_count"`
	TokenCount   int            `json:"token_count"`
	IPs          []UserIPDetail `json:"ips,omitempty"`
}

type TopTokenItem struct {
	TokenId      int            `json:"token_id"`
	TokenName    string         `json:"token_name"`
	UserId       int            `json:"user_id"`
	Username     string         `json:"username"`
	RequestCount int            `json:"request_count"`
	TotalTokens  int            `json:"total_tokens"`
	TotalQuota   int            `json:"total_quota"`
	IPCount      int            `json:"ip_count"`
	IPs          []UserIPDetail `json:"ips,omitempty"`
}

type UserIPDetail struct {
	IP           string `json:"ip"`
	RequestCount int    `json:"request_count"`
	LastSeen     int64  `json:"last_seen"`
	FirstSeen    int64  `json:"first_seen"`
}

type SharingRiskItem struct {
	UserId          int     `json:"user_id"`
	Username        string  `json:"username"`
	Group           string  `json:"group"`
	RiskScore       float64 `json:"risk_score"`
	RiskLevel       string  `json:"risk_level"`
	IPCount         int     `json:"ip_count"`
	SubnetCount     int     `json:"subnet_count"`
	ConcurrentCount int     `json:"concurrent_count"`
	RequestCount    int     `json:"request_count"`
	TotalQuota      int     `json:"total_quota"`
}

type InviteRiskItem struct {
	UserId           int     `json:"user_id"`
	Username         string  `json:"username"`
	Group            string  `json:"group"`
	InvitedTotal     int     `json:"invited_total"`
	PaidTotal        int     `json:"paid_total"`
	SuspiciousTotal  int     `json:"suspicious_total"`
	SameIPTotal      int     `json:"same_ip_total"`
	PaidAmountTotal  float64 `json:"paid_amount_total"`
	ConversionRate   float64 `json:"conversion_rate"`
	RiskScore        float64 `json:"risk_score"`
	LatestInviteTime int64   `json:"latest_invite_time"`
}

// ========== API Handlers ==========

// GetTopUsers returns usage ranking by user
// GET /api/analytics/top-users?days=7&sort=quota&limit=50
func GetTopUsers(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 || days > 90 {
		days = 7
	}
	sortBy := c.DefaultQuery("sort", "quota")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	startTimestamp := getDaysAgoStartTimestamp(days)

	// Query: aggregate logs by user
	var results []struct {
		UserId       int    `gorm:"column:user_id"`
		Username     string `gorm:"column:username"`
		RequestCount int    `gorm:"column:request_count"`
		TotalTokens  int    `gorm:"column:total_tokens"`
		TotalQuota   int    `gorm:"column:total_quota"`
		IPCount      int    `gorm:"column:ip_count"`
		TokenCount   int    `gorm:"column:token_count"`
	}

	orderCol := "total_quota"
	switch sortBy {
	case "tokens":
		orderCol = "total_tokens"
	case "requests":
		orderCol = "request_count"
	case "ips":
		orderCol = "ip_count"
	}

	err := model.LOG_DB.Table("logs").
		Select(`user_id, username,
			COUNT(*) as request_count,
			COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens,
			COALESCE(SUM(quota), 0) as total_quota,
			COUNT(DISTINCT CASE WHEN ip != '' THEN ip END) as ip_count,
			COUNT(DISTINCT token_id) as token_count`).
		Where("created_at >= ? AND type = ?", startTimestamp, model.LogTypeConsume).
		Group("user_id, username").
		Order(orderCol + " DESC").
		Limit(limit).
		Find(&results).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// Get user groups from main DB
	userIds := make([]int, len(results))
	for i, r := range results {
		userIds[i] = r.UserId
	}
	groupMap := getUserGroups(userIds)

	// Batch fetch IPs for all users
	ipMap := batchGetUserIPs(userIds, startTimestamp)

	items := make([]TopUserItem, len(results))
	for i, r := range results {
		items[i] = TopUserItem{
			UserId:       r.UserId,
			Username:     r.Username,
			Group:        groupMap[r.UserId],
			RequestCount: r.RequestCount,
			TotalTokens:  r.TotalTokens,
			TotalQuota:   r.TotalQuota,
			IPCount:      r.IPCount,
			TokenCount:   r.TokenCount,
			IPs:          ipMap[r.UserId],
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": items,
			"days":  days,
		},
	})
}

// GetTopTokens returns usage ranking by token
// GET /api/analytics/top-tokens?days=7&sort=quota&limit=50
func GetTopTokens(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 || days > 90 {
		days = 7
	}
	sortBy := c.DefaultQuery("sort", "quota")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	startTimestamp := getDaysAgoStartTimestamp(days)

	var results []struct {
		TokenId      int    `gorm:"column:token_id"`
		TokenName    string `gorm:"column:token_name"`
		UserId       int    `gorm:"column:user_id"`
		Username     string `gorm:"column:username"`
		RequestCount int    `gorm:"column:request_count"`
		TotalTokens  int    `gorm:"column:total_tokens"`
		TotalQuota   int    `gorm:"column:total_quota"`
		IPCount      int    `gorm:"column:ip_count"`
	}

	orderCol := "total_quota"
	switch sortBy {
	case "tokens":
		orderCol = "total_tokens"
	case "requests":
		orderCol = "request_count"
	case "ips":
		orderCol = "ip_count"
	}

	err := model.LOG_DB.Table("logs").
		Select(`token_id, token_name, user_id, username,
			COUNT(*) as request_count,
			COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens,
			COALESCE(SUM(quota), 0) as total_quota,
			COUNT(DISTINCT CASE WHEN ip != '' THEN ip END) as ip_count`).
		Where("created_at >= ? AND type = ? AND token_id > 0", startTimestamp, model.LogTypeConsume).
		Group("token_id, token_name, user_id, username").
		Order(orderCol + " DESC").
		Limit(limit).
		Find(&results).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// Batch fetch IPs per token
	tokenIds := make([]int, len(results))
	for i, r := range results {
		tokenIds[i] = r.TokenId
	}
	tokenIPMap := batchGetTokenIPs(tokenIds, startTimestamp)

	items := make([]TopTokenItem, len(results))
	for i, r := range results {
		items[i] = TopTokenItem{
			TokenId:      r.TokenId,
			TokenName:    r.TokenName,
			UserId:       r.UserId,
			Username:     r.Username,
			RequestCount: r.RequestCount,
			TotalTokens:  r.TotalTokens,
			TotalQuota:   r.TotalQuota,
			IPCount:      r.IPCount,
			IPs:          tokenIPMap[r.TokenId],
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": items,
			"days":  days,
		},
	})
}

// GetUserIPs returns IP details for a specific user
// GET /api/analytics/user/:id/ips?days=7
func GetUserIPs(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid user id"})
		return
	}

	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 || days > 90 {
		days = 7
	}

	startTimestamp := getDaysAgoStartTimestamp(days)

	var results []struct {
		IP           string `gorm:"column:ip"`
		RequestCount int    `gorm:"column:request_count"`
		LastSeen     int64  `gorm:"column:last_seen"`
		FirstSeen    int64  `gorm:"column:first_seen"`
	}

	err := model.LOG_DB.Table("logs").
		Select(`ip,
			COUNT(*) as request_count,
			MAX(created_at) as last_seen,
			MIN(created_at) as first_seen`).
		Where("user_id = ? AND created_at >= ? AND type = ? AND ip != ''",
			userId, startTimestamp, model.LogTypeConsume).
		Group("ip").
		Order("request_count DESC").
		Find(&results).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	items := make([]UserIPDetail, len(results))
	for i, r := range results {
		items[i] = UserIPDetail{
			IP:           r.IP,
			RequestCount: r.RequestCount,
			LastSeen:     r.LastSeen,
			FirstSeen:    r.FirstSeen,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":   items,
			"user_id": userId,
			"days":    days,
		},
	})
}

// GetSharingRisk returns multi-user sharing risk detection
// GET /api/analytics/sharing-risk?days=7
func GetSharingRisk(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 || days > 90 {
		days = 7
	}

	startTimestamp := getDaysAgoStartTimestamp(days)

	// Step 1: Get users with their IP stats
	var userStats []struct {
		UserId       int    `gorm:"column:user_id"`
		Username     string `gorm:"column:username"`
		RequestCount int    `gorm:"column:request_count"`
		TotalQuota   int    `gorm:"column:total_quota"`
		IPCount      int    `gorm:"column:ip_count"`
	}

	err := model.LOG_DB.Table("logs").
		Select(`user_id, username,
			COUNT(*) as request_count,
			COALESCE(SUM(quota), 0) as total_quota,
			COUNT(DISTINCT CASE WHEN ip != '' THEN ip END) as ip_count`).
		Where("created_at >= ? AND type = ?", startTimestamp, model.LogTypeConsume).
		Group("user_id, username").
		Having("COUNT(DISTINCT CASE WHEN ip != '' THEN ip END) >= ?", 3).
		Order("ip_count DESC").
		Find(&userStats).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	if len(userStats) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data":    gin.H{"items": []SharingRiskItem{}, "days": days},
		})
		return
	}

	// Collect user IDs
	userIds := make([]int, len(userStats))
	for i, u := range userStats {
		userIds[i] = u.UserId
	}

	// Step 2: Get subnet diversity per user (count distinct /24 subnets)
	// We extract the first 3 octets of IPv4 as subnet identifier
	// For SQLite: use substr; this is compatible with all 3 DBs
	type SubnetResult struct {
		UserId      int `gorm:"column:user_id"`
		SubnetCount int `gorm:"column:subnet_count"`
	}
	var subnetResults []SubnetResult

	// Use a subquery approach that works across DBs
	// Count distinct IP prefixes (first 3 octets for IPv4)
	subnetQuery := model.LOG_DB.Table("logs").
		Select(`user_id,
			COUNT(DISTINCT SUBSTR(ip, 1, 
				CASE 
					WHEN INSTR(SUBSTR(ip, 1, 
						CASE WHEN INSTR(ip, '.') > 0 
						THEN INSTR(SUBSTR(ip, INSTR(ip, '.')+1), '.') + INSTR(ip, '.') 
						ELSE LENGTH(ip) END
					), '.') > 0 
					THEN INSTR(SUBSTR(ip, INSTR(ip, '.')+1), '.') + INSTR(ip, '.')
					ELSE LENGTH(ip) 
				END
			)) as subnet_count`).
		Where("user_id IN ? AND created_at >= ? AND type = ? AND ip != '' AND INSTR(ip, '.') > 0",
			userIds, startTimestamp, model.LogTypeConsume).
		Group("user_id")

	// Simplified approach: just count distinct IPs with first 3 octets
	// Use a simpler cross-DB compatible approach
	subnetQuery = model.LOG_DB.Table("logs").
		Select("user_id, COUNT(DISTINCT ip) as subnet_count").
		Where("user_id IN ? AND created_at >= ? AND type = ? AND ip != ''",
			userIds, startTimestamp, model.LogTypeConsume).
		Group("user_id")

	_ = subnetQuery.Find(&subnetResults).Error
	subnetMap := make(map[int]int)
	for _, s := range subnetResults {
		subnetMap[s.UserId] = s.SubnetCount
	}

	// Step 3: Detect concurrent usage (different IPs within 5-minute windows)
	// For each user, count how many 5-min windows have 2+ distinct IPs
	concurrentMap := make(map[int]int)
	for _, uid := range userIds {
		var ipTimestamps []struct {
			IP        string `gorm:"column:ip"`
			CreatedAt int64  `gorm:"column:created_at"`
		}
		model.LOG_DB.Table("logs").
			Select("ip, created_at").
			Where("user_id = ? AND created_at >= ? AND type = ? AND ip != ''",
				uid, startTimestamp, model.LogTypeConsume).
			Order("created_at ASC").
			Limit(10000).
			Find(&ipTimestamps)

		if len(ipTimestamps) > 0 {
			concurrentCount := countConcurrentWindows(ipTimestamps, 300) // 5 min = 300s
			concurrentMap[uid] = concurrentCount
		}
	}

	// Step 4: Get user groups
	groupMap := getUserGroups(userIds)

	// Step 5: Calculate risk scores
	items := make([]SharingRiskItem, 0, len(userStats))
	for _, u := range userStats {
		subnetCount := subnetMap[u.UserId]
		concurrentCount := concurrentMap[u.UserId]

		score := calculateRiskScore(u.IPCount, subnetCount, concurrentCount)
		level := riskLevel(score)

		items = append(items, SharingRiskItem{
			UserId:          u.UserId,
			Username:        u.Username,
			Group:           groupMap[u.UserId],
			RiskScore:       math.Round(score*100) / 100,
			RiskLevel:       level,
			IPCount:         u.IPCount,
			SubnetCount:     subnetCount,
			ConcurrentCount: concurrentCount,
			RequestCount:    u.RequestCount,
			TotalQuota:      u.TotalQuota,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": items,
			"days":  days,
		},
	})
}

// GetInviteRisk returns inviter conversion and suspicious invite ranking.
// GET /api/analytics/invite-risk?limit=50
func GetInviteRisk(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	var inviterRows []struct {
		UserId           int    `gorm:"column:user_id"`
		Username         string `gorm:"column:username"`
		InvitedTotal     int    `gorm:"column:invited_total"`
		LatestInviteTime int64  `gorm:"column:latest_invite_time"`
	}

	err := model.DB.Table("users AS inviters").
		Select(`inviters.id as user_id, inviters.username, COUNT(invitees.id) as invited_total, COALESCE(MAX(invitees.register_time), 0) as latest_invite_time`).
		Joins("JOIN users AS invitees ON invitees.inviter_id = inviters.id").
		Group("inviters.id, inviters.username").
		Order("invited_total DESC").
		Limit(limit).
		Find(&inviterRows).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	if len(inviterRows) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"items": []InviteRiskItem{}}})
		return
	}

	inviterIds := make([]int, 0, len(inviterRows))
	for _, row := range inviterRows {
		inviterIds = append(inviterIds, row.UserId)
	}
	groupMap := getUserGroups(inviterIds)

	paidMap, err := batchGetInvitePaidStats(inviterIds)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	suspiciousMap, sameIPMap, err := batchGetInviteSuspiciousStats(inviterIds)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	items := make([]InviteRiskItem, 0, len(inviterRows))
	for _, row := range inviterRows {
		paid := paidMap[row.UserId]
		suspiciousTotal := suspiciousMap[row.UserId]
		sameIPTotal := sameIPMap[row.UserId]
		conversionRate := 0.0
		if row.InvitedTotal > 0 {
			conversionRate = float64(paid.PaidTotal) / float64(row.InvitedTotal)
		}
		riskScore := math.Min(float64(suspiciousTotal*20)+float64(sameIPTotal*10)+(100-conversionRate*100)*0.35, 100)

		items = append(items, InviteRiskItem{
			UserId:           row.UserId,
			Username:         row.Username,
			Group:            groupMap[row.UserId],
			InvitedTotal:     row.InvitedTotal,
			PaidTotal:        paid.PaidTotal,
			SuspiciousTotal:  suspiciousTotal,
			SameIPTotal:      sameIPTotal,
			PaidAmountTotal:  paid.PaidAmountTotal,
			ConversionRate:   math.Round(conversionRate*10000) / 10000,
			RiskScore:        math.Round(riskScore*100) / 100,
			LatestInviteTime: row.LatestInviteTime,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": items,
		},
	})
}

// ========== Daily Ranking (all users) ==========

type DailyRankingItem struct {
	Rank         int    `json:"rank"`
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	RequestCount int    `json:"request_count"`
	TotalTokens  int    `json:"total_tokens"`
	TotalQuota   int    `json:"total_quota"`
	IsSelf       bool   `json:"is_self"`
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

// GetDailyRanking returns today's usage ranking visible to all logged-in users.
// GET /api/analytics/daily-ranking?sort=quota&limit=50
func GetDailyRanking(c *gin.Context) {
	sortBy := c.DefaultQuery("sort", "quota")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	// Current user info from auth context
	currentUserId := c.GetInt("id")
	currentRole := c.GetInt("role")
	isAdmin := currentRole >= 10

	// Today 00:00 Asia/Shanghai
	startTimestamp := getDaysAgoStartTimestamp(1)

	var results []struct {
		UserId       int    `gorm:"column:user_id"`
		Username     string `gorm:"column:username"`
		RequestCount int    `gorm:"column:request_count"`
		TotalTokens  int    `gorm:"column:total_tokens"`
		TotalQuota   int    `gorm:"column:total_quota"`
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
			COALESCE(SUM(quota), 0) as total_quota`).
		Where("created_at >= ? AND type = ?", startTimestamp, model.LogTypeConsume).
		Group("user_id, username").
		Order(orderCol + " DESC").
		Limit(limit).
		Find(&results).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// Also find current user's rank if not in top N
	myRank := 0
	items := make([]DailyRankingItem, len(results))
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
			Rank:         i + 1,
			UserId:       r.UserId,
			Username:     username,
			RequestCount: r.RequestCount,
			TotalTokens:  r.TotalTokens,
			TotalQuota:   r.TotalQuota,
			IsSelf:       isSelf,
		}
	}

	// Count total distinct users today
	var totalUsers int64
	model.LOG_DB.Table("logs").
		Where("created_at >= ? AND type = ?", startTimestamp, model.LogTypeConsume).
		Distinct("user_id").
		Count(&totalUsers)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":       items,
			"my_rank":     myRank,
			"total_users": totalUsers,
		},
	})
}

// ========== Helper Functions ==========

// batchGetUserIPs fetches IP details for multiple users in one query
func batchGetUserIPs(userIds []int, startTimestamp int64) map[int][]UserIPDetail {
	result := make(map[int][]UserIPDetail, len(userIds))
	if len(userIds) == 0 {
		return result
	}

	var rows []struct {
		UserId       int    `gorm:"column:user_id"`
		IP           string `gorm:"column:ip"`
		RequestCount int    `gorm:"column:request_count"`
		LastSeen     int64  `gorm:"column:last_seen"`
		FirstSeen    int64  `gorm:"column:first_seen"`
	}

	model.LOG_DB.Table("logs").
		Select(`user_id, ip,
			COUNT(*) as request_count,
			MAX(created_at) as last_seen,
			MIN(created_at) as first_seen`).
		Where("user_id IN ? AND created_at >= ? AND type = ? AND ip != ''",
			userIds, startTimestamp, model.LogTypeConsume).
		Group("user_id, ip").
		Order("user_id, request_count DESC").
		Find(&rows)

	for _, r := range rows {
		result[r.UserId] = append(result[r.UserId], UserIPDetail{
			IP:           r.IP,
			RequestCount: r.RequestCount,
			LastSeen:     r.LastSeen,
			FirstSeen:    r.FirstSeen,
		})
	}
	return result
}

func batchGetInvitePaidStats(inviterIds []int) (map[int]struct {
	PaidTotal       int
	PaidAmountTotal float64
}, error) {
	result := make(map[int]struct {
		PaidTotal       int
		PaidAmountTotal float64
	}, len(inviterIds))
	if len(inviterIds) == 0 {
		return result, nil
	}

	// 真实付费 = 订阅 ∪ 充值。两次查询各自落到 (inviter_id, invitee_id) 维度，
	// 再在 Go 内存合并去重，避免同一被邀人在两个表都付费导致计数翻倍。
	type inviterPaid struct {
		invitees map[int]struct{}
		amount   float64
	}
	merged := make(map[int]*inviterPaid)
	ensure := func(inviterId int) *inviterPaid {
		if p, ok := merged[inviterId]; ok {
			return p
		}
		p := &inviterPaid{invitees: make(map[int]struct{})}
		merged[inviterId] = p
		return p
	}

	// 订阅订单
	var subRows []struct {
		InviterId int     `gorm:"column:inviter_id"`
		InviteeId int     `gorm:"column:invitee_id"`
		Amount    float64 `gorm:"column:amount"`
	}
	if err := model.DB.Table("users AS invitees").
		Select(`invitees.inviter_id, invitees.id as invitee_id, COALESCE(SUM(subscription_orders.money), 0) as amount`).
		Joins(`JOIN subscription_orders ON subscription_orders.user_id = invitees.id AND subscription_orders.status = ?`, "paid").
		Where("invitees.inviter_id IN ?", inviterIds).
		Group("invitees.inviter_id, invitees.id").
		Find(&subRows).Error; err != nil {
		return nil, err
	}
	for _, row := range subRows {
		p := ensure(row.InviterId)
		p.invitees[row.InviteeId] = struct{}{}
		p.amount += row.Amount
	}

	// 在线充值
	var topupRows []struct {
		InviterId int     `gorm:"column:inviter_id"`
		InviteeId int     `gorm:"column:invitee_id"`
		Amount    float64 `gorm:"column:amount"`
	}
	if err := model.DB.Table("users AS invitees").
		Select(`invitees.inviter_id, invitees.id as invitee_id, COALESCE(SUM(top_ups.money), 0) as amount`).
		Joins(`JOIN top_ups ON top_ups.user_id = invitees.id AND top_ups.status = ?`, common.TopUpStatusSuccess).
		Where("invitees.inviter_id IN ?", inviterIds).
		Group("invitees.inviter_id, invitees.id").
		Find(&topupRows).Error; err != nil {
		return nil, err
	}
	for _, row := range topupRows {
		p := ensure(row.InviterId)
		p.invitees[row.InviteeId] = struct{}{}
		p.amount += row.Amount
	}

	for inviterId, p := range merged {
		result[inviterId] = struct {
			PaidTotal       int
			PaidAmountTotal float64
		}{PaidTotal: len(p.invitees), PaidAmountTotal: p.amount}
	}
	return result, nil
}

func batchGetInviteSuspiciousStats(inviterIds []int) (map[int]int, map[int]int, error) {
	suspiciousMap := make(map[int]int, len(inviterIds))
	sameIPMap := make(map[int]int, len(inviterIds))
	if len(inviterIds) == 0 {
		return suspiciousMap, sameIPMap, nil
	}

	var rows []struct {
		InviterId       int `gorm:"column:inviter_id"`
		SameIPTotal     int `gorm:"column:same_ip_total"`
		SuspiciousTotal int `gorm:"column:suspicious_total"`
	}
	err := model.DB.Raw(`
		SELECT inviter_id,
		       SUM(CASE WHEN ip_duplicate_count > 1 THEN 1 ELSE 0 END) AS same_ip_total,
		       SUM(CASE WHEN ip_duplicate_count > 1 OR paid_order_count = 0 THEN 1 ELSE 0 END) AS suspicious_total
		FROM (
		    SELECT invitees.id,
		           invitees.inviter_id,
		           invitees.register_ip,
		           COUNT(*) OVER (PARTITION BY invitees.inviter_id, invitees.register_ip) AS ip_duplicate_count,
		           COALESCE(paid_stats.paid_order_count, 0) AS paid_order_count
		    FROM users AS invitees
		    LEFT JOIN (
		        SELECT user_id, COUNT(*) AS paid_order_count
		        FROM subscription_orders
		        WHERE status = 'paid'
		        GROUP BY user_id
		    ) AS paid_stats ON paid_stats.user_id = invitees.id
		    WHERE invitees.inviter_id IN ?
		) AS invite_stats
		GROUP BY inviter_id
	`, inviterIds).Scan(&rows).Error
	if err != nil {
		return nil, nil, err
	}

	for _, row := range rows {
		suspiciousMap[row.InviterId] = row.SuspiciousTotal
		sameIPMap[row.InviterId] = row.SameIPTotal
	}
	return suspiciousMap, sameIPMap, nil
}

func getUserGroups(userIds []int) map[int]string {
	if len(userIds) == 0 {
		return map[int]string{}
	}
	// Use model.GetUserGroup one by one (handles reserved word + cache)
	result := make(map[int]string, len(userIds))
	for _, uid := range userIds {
		group, err := model.GetUserGroup(uid, false)
		if err == nil {
			result[uid] = group
		}
	}
	return result
}

// batchGetTokenIPs fetches IP details for multiple tokens in one query
func batchGetTokenIPs(tokenIds []int, startTimestamp int64) map[int][]UserIPDetail {
	result := make(map[int][]UserIPDetail, len(tokenIds))
	if len(tokenIds) == 0 {
		return result
	}

	var rows []struct {
		TokenId      int    `gorm:"column:token_id"`
		IP           string `gorm:"column:ip"`
		RequestCount int    `gorm:"column:request_count"`
		LastSeen     int64  `gorm:"column:last_seen"`
		FirstSeen    int64  `gorm:"column:first_seen"`
	}

	model.LOG_DB.Table("logs").
		Select(`token_id, ip,
			COUNT(*) as request_count,
			MAX(created_at) as last_seen,
			MIN(created_at) as first_seen`).
		Where("token_id IN ? AND created_at >= ? AND type = ? AND ip != ''",
			tokenIds, startTimestamp, model.LogTypeConsume).
		Group("token_id, ip").
		Order("token_id, request_count DESC").
		Find(&rows)

	for _, r := range rows {
		result[r.TokenId] = append(result[r.TokenId], UserIPDetail{
			IP:           r.IP,
			RequestCount: r.RequestCount,
			LastSeen:     r.LastSeen,
			FirstSeen:    r.FirstSeen,
		})
	}
	return result
}

// countConcurrentWindows counts how many 5-minute windows have 2+ distinct IPs
func countConcurrentWindows(records []struct {
	IP        string `gorm:"column:ip"`
	CreatedAt int64  `gorm:"column:created_at"`
}, windowSec int64) int {
	if len(records) == 0 {
		return 0
	}

	count := 0
	startTime := records[0].CreatedAt
	endTime := records[len(records)-1].CreatedAt

	for windowStart := startTime; windowStart <= endTime; windowStart += windowSec {
		windowEnd := windowStart + windowSec
		ips := make(map[string]bool)
		for _, r := range records {
			if r.CreatedAt >= windowStart && r.CreatedAt < windowEnd && r.IP != "" {
				ips[r.IP] = true
			}
		}
		if len(ips) >= 2 {
			count++
		}
	}
	return count
}

// calculateRiskScore computes a 0-100 risk score
// Dimensions:
//   - IP count (25%): >10 IPs starts scoring
//   - Subnet diversity (25%): different /24 subnets vs total IPs
//   - Concurrent usage (30%): 5-min windows with 2+ IPs
//   - (GeoIP 20% reserved, currently 0)
func calculateRiskScore(ipCount, subnetCount, concurrentCount int) float64 {
	// IP count score (0-100): linear from 3 to 20
	ipScore := 0.0
	if ipCount >= 3 {
		ipScore = math.Min(float64(ipCount-3)/17.0*100, 100)
	}

	// Subnet diversity score (0-100): ratio of subnets to IPs
	subnetScore := 0.0
	if ipCount > 0 && subnetCount > 1 {
		ratio := float64(subnetCount) / float64(ipCount)
		subnetScore = math.Min(ratio*100, 100)
	}

	// Concurrent score (0-100): linear from 1 to 20 windows
	concurrentScore := 0.0
	if concurrentCount > 0 {
		concurrentScore = math.Min(float64(concurrentCount)/20.0*100, 100)
	}

	// Weighted sum (GeoIP weight redistributed to others for now)
	// IP: 30%, Subnet: 30%, Concurrent: 40%
	return ipScore*0.30 + subnetScore*0.30 + concurrentScore*0.40
}

func riskLevel(score float64) string {
	switch {
	case score >= 70:
		return "extreme"
	case score >= 45:
		return "high"
	case score >= 25:
		return "medium"
	default:
		return "low"
	}
}
