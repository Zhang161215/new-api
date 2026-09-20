package controller

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func lotteryUserID(c *gin.Context) int {
	raw, exists := c.Get("id")
	if !exists || raw == nil {
		return 0
	}
	switch v := raw.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(v))
		return n
	}
	if id := c.GetInt("id"); id > 0 {
		return id
	}
	return 0
}

func lotteryRole(c *gin.Context) int {
	raw, exists := c.Get("role")
	if !exists || raw == nil {
		return 0
	}
	switch v := raw.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	}
	return 0
}

func lotteryUsername(c *gin.Context) string {
	if name, ok := c.Get("username"); ok {
		if s, ok := name.(string); ok {
			return s
		}
	}
	return ""
}

func parseDayBound(raw string, end bool) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	t, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return 0
	}
	if end {
		t = t.Add(24*time.Hour - time.Second)
	}
	return t.Unix()
}

func lotteryPrizeDTO(p model.LotteryPrize, forAdmin bool) gin.H {
	item := gin.H{
		"id":              p.Code,
		"db_id":           p.Id,
		"code":            p.Code,
		"label":           p.Label,
		"short":           p.Short,
		"hint":            p.Hint,
		"weight":          p.Weight,
		"quota":           p.QuotaAmount,
		"quota_amount":    p.QuotaAmount,
		"extraTicket":     p.ExtraTicket,
		"extra_ticket":    p.ExtraTicket,
		"enabled":         p.Enabled,
		"sort_order":      p.SortOrder,
		"tier":            p.Tier,
		"fill":            p.Fill,
		"ink":             p.Ink,
		"redemption_name": p.RedemptionName,
		"redemptionName":  p.RedemptionName,
		"stock":           p.Stock,
	}
	if !forAdmin {
		delete(item, "redemption_name")
		delete(item, "redemptionName")
		delete(item, "stock")
		delete(item, "weight")
		delete(item, "db_id")
	}
	return item
}

func lotteryDrawDTO(d model.LotteryDraw, includeCode bool) gin.H {
	item := gin.H{
		"id":            d.PrizeCode,
		"draw_id":       d.Id,
		"drawId":        d.Id,
		"user_id":       d.UserId,
		"username":      d.Username,
		"prize_code":    d.PrizeCode,
		"prizeId":       d.PrizeCode,
		"label":         d.PrizeLabel,
		"prize_label":   d.PrizeLabel,
		"quota":         d.QuotaAwarded,
		"quota_awarded": d.QuotaAwarded,
		"win":           d.IsWin,
		"is_win":        d.IsWin,
		"extraTicket":   d.ExtraTicket,
		"extra_ticket":  d.ExtraTicket,
		"at":            d.CreatedAt * 1000,
	}
	if includeCode {
		key := strings.TrimSpace(d.RedemptionKey)
		if key != "" {
			item["redemption_key"] = key
			item["redemptionKey"] = key
			item["redemption_name"] = d.RedemptionName
		}
	}
	return item
}

func lotteryLogDTO(row model.LotteryTicketLog) gin.H {
	return gin.H{
		"id":            row.Id,
		"delta":         row.Delta,
		"reason":        row.Reason,
		"refType":       row.RefType,
		"ref_type":      row.RefType,
		"refId":         row.RefId,
		"ref_id":        row.RefId,
		"balanceAfter":  row.BalanceAfter,
		"balance_after": row.BalanceAfter,
		"at":            row.CreatedAt * 1000,
	}
}

func userFacingPrizes(prizes []model.LotteryPrize) []gin.H {
	out := make([]gin.H, 0, len(prizes))
	for _, p := range prizes {
		if !p.Enabled {
			continue
		}
		out = append(out, lotteryPrizeDTO(p, false))
	}
	return out
}

func GetLottery(c *gin.Context) {
	cfg, err := model.GetLotteryConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	prizes, err := model.ListLotteryPrizes(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	feed, _ := model.ListPublicLotteryFeed(30)
	publicFeed := make([]gin.H, 0, len(feed))
	for _, row := range feed {
		publicFeed = append(publicFeed, gin.H{
			"who":   model.MaskLotteryName(row.Username),
			"label": row.PrizeLabel,
			"quota": row.QuotaAwarded,
			"at":    row.CreatedAt * 1000,
		})
	}

	soldOut := model.LotteryWarehouseEmpty(prizes)
	data := gin.H{
		// enabled 给控制台顶栏图标用：关掉转盘后图标仍在，才能再点进去开启。
		"enabled":             true,
		"draw_enabled":        cfg.Enabled,
		"drawEnabled":         cfg.Enabled,
		"sold_out":            soldOut,
		"soldOut":             soldOut,
		"tickets_per_payment": cfg.TicketsPerPayment,
		"ticketsPerPayment":   cfg.TicketsPerPayment,
		"logged_in":           false,
		"tickets":             0,
		"payments":            0,
		"today_draws":         0,
		"todayDraws":          0,
		"total_quota":         0,
		"totalQuota":          0,
		"prizes":              userFacingPrizes(prizes),
		"history":             []gin.H{},
		"ticket_log":          []gin.H{},
		"public_feed":         publicFeed,
		"publicFeed":          publicFeed,
	}

	userId := lotteryUserID(c)
	if userId > 0 {
		data["logged_in"] = true
		if user, err := model.GetUserById(userId, false); err == nil && user != nil {
			if user.Status != common.UserStatusDisabled && user.Role >= common.RoleAdminUser {
				data["is_admin"] = true
				data["isAdmin"] = true
			}
		}
		if name, err := model.GetUsernameById(userId, false); err == nil {
			data["username"] = name
		}
		if wallet, err := model.GetLotteryWallet(userId); err == nil {
			data["tickets"] = wallet.Tickets
			data["total_quota"] = wallet.TotalWonQuota
			data["totalQuota"] = wallet.TotalWonQuota
		}
		if n, err := model.CountLotteryPaymentGrants(userId); err == nil {
			data["payments"] = n
		}
		if n, err := model.CountUserLotteryDrawsSince(userId, modelStartOfToday()); err == nil {
			data["today_draws"] = n
			data["todayDraws"] = n
		}
		if draws, _, err := model.ListLotteryDraws(model.LotteryListFilter{UserId: userId, Page: 1, Size: 8}); err == nil {
			history := make([]gin.H, 0, len(draws))
			for _, row := range draws {
				history = append(history, lotteryDrawDTO(row, true))
			}
			data["history"] = history
		}
		if logs, _, err := model.ListLotteryTicketLogs(model.LotteryListFilter{UserId: userId, Page: 1, Size: 8}); err == nil {
			items := make([]gin.H, 0, len(logs))
			for _, row := range logs {
				items = append(items, lotteryLogDTO(row))
			}
			data["ticket_log"] = items
			data["ticketLog"] = items
		}
		if notice, err := model.LatestUnseenLotteryGiftNotice(userId); err == nil && notice != nil {
			item := lotteryLogDTO(*notice)
			data["gift_notice"] = item
			data["giftNotice"] = item
		}
	}

	common.ApiSuccess(c, data)
}

func modelStartOfToday() int64 {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
}

func DrawLottery(c *gin.Context) {
	userId := lotteryUserID(c)
	if userId <= 0 {
		common.ApiErrorMsg(c, "请先登录")
		return
	}
	result, err := model.DrawLottery(userId, lotteryUsername(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"prizeId":        result.Prize.Code,
		"prize_code":     result.Prize.Code,
		"label":          result.Prize.Label,
		"tickets":        result.Wallet.Tickets,
		"awardedQuota":   result.Draw.QuotaAwarded,
		"quota_awarded":  result.Draw.QuotaAwarded,
		"extraTicket":    result.Draw.ExtraTicket,
		"win":            result.Draw.IsWin,
		"redemption_key": strings.TrimSpace(result.Draw.RedemptionKey),
		"redemptionKey":  strings.TrimSpace(result.Draw.RedemptionKey),
		"draw":           lotteryDrawDTO(*result.Draw, true),
	})
}

func GetLotteryHistory(c *gin.Context) {
	userId := lotteryUserID(c)
	if userId <= 0 {
		common.ApiErrorMsg(c, "请先登录")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	rows, total, err := model.ListLotteryDraws(model.LotteryListFilter{
		UserId: userId,
		Filter: c.DefaultQuery("filter", "all"),
		Prize:  c.Query("prize"),
		From:   parseDayBound(c.Query("from"), false),
		To:     parseDayBound(c.Query("to"), true),
		Page:   page,
		Size:   size,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, lotteryDrawDTO(row, true))
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

func GetLotteryTicketLog(c *gin.Context) {
	userId := lotteryUserID(c)
	if userId <= 0 {
		common.ApiErrorMsg(c, "请先登录")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	rows, total, err := model.ListLotteryTicketLogs(model.LotteryListFilter{
		UserId: userId,
		Filter: c.DefaultQuery("filter", "all"),
		From:   parseDayBound(c.Query("from"), false),
		To:     parseDayBound(c.Query("to"), true),
		Page:   page,
		Size:   size,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, lotteryLogDTO(row))
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

func GetLotteryAdminOverview(c *gin.Context) {
	overview, err := model.GetLotteryOverview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	cfg, err := model.GetLotteryConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	prizes, err := model.ListLotteryPrizes(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(prizes))
	for _, p := range prizes {
		used, _ := model.CountLotteryPrizeUsed(p.RedemptionName)
		row := lotteryPrizeDTO(p, true)
		row["used"] = used
		items = append(items, row)
	}
	common.ApiSuccess(c, gin.H{
		"overview": overview,
		"config":   cfg,
		"prizes":   items,
	})
}

func UpdateLotteryAdminConfig(c *gin.Context) {
	var req struct {
		Enabled           *bool `json:"enabled"`
		TicketsPerPayment *int  `json:"tickets_per_payment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	cfg, err := model.GetLotteryConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	enabled := cfg.Enabled
	per := cfg.TicketsPerPayment
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.TicketsPerPayment != nil {
		per = *req.TicketsPerPayment
	}
	cfg, err = model.SaveLotteryConfig(enabled, per)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cfg)
}

type lotteryPrizePayload struct {
	Code            string  `json:"code"`
	Label           string  `json:"label"`
	Short           string  `json:"short"`
	Hint            string  `json:"hint"`
	Weight          int     `json:"weight"`
	Quota           float64 `json:"quota"`
	QuotaAmount     float64 `json:"quota_amount"`
	ExtraTicket     bool    `json:"extra_ticket"`
	ExtraTicketAlt  bool    `json:"extraTicket"`
	Enabled         *bool   `json:"enabled"`
	SortOrder       int     `json:"sort_order"`
	RedemptionName  string  `json:"redemption_name"`
	RedemptionName2 string  `json:"redemptionName"`
	Fill            string  `json:"fill"`
	Ink             string  `json:"ink"`
	Tier            string  `json:"tier"`
}

func (p lotteryPrizePayload) toPrize(base *model.LotteryPrize) model.LotteryPrize {
	out := model.LotteryPrize{}
	if base != nil {
		out = *base
	}
	if p.Code != "" {
		out.Code = p.Code
	}
	if p.Label != "" {
		out.Label = p.Label
	}
	out.Short = p.Short
	out.Hint = p.Hint
	out.Weight = p.Weight
	quota := p.QuotaAmount
	if p.Quota != 0 {
		quota = p.Quota
	} else if p.QuotaAmount == 0 && p.Quota == 0 && base != nil && p.Label == "" {
		quota = base.QuotaAmount
	}
	if p.Quota != 0 || p.QuotaAmount != 0 || base == nil {
		out.QuotaAmount = quota
	}
	out.ExtraTicket = p.ExtraTicket || p.ExtraTicketAlt
	if p.Enabled != nil {
		out.Enabled = *p.Enabled
	} else if base == nil {
		out.Enabled = true
	}
	out.SortOrder = p.SortOrder
	name := strings.TrimSpace(p.RedemptionName)
	if name == "" {
		name = strings.TrimSpace(p.RedemptionName2)
	}
	if p.ExtraTicket || p.ExtraTicketAlt {
		out.RedemptionName = ""
	} else if name != "" {
		out.RedemptionName = name
	}
	if p.Fill != "" {
		out.Fill = p.Fill
	}
	if p.Ink != "" {
		out.Ink = p.Ink
	}
	if p.Tier != "" {
		out.Tier = p.Tier
	}
	return out
}

func CreateLotteryAdminPrize(c *gin.Context) {
	var req lotteryPrizePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	prize := req.toPrize(nil)
	if err := model.CreateLotteryPrize(&prize); err != nil {
		common.ApiError(c, err)
		return
	}
	prize.Stock, _ = model.CountLotteryPrizeStock(prize.RedemptionName)
	common.ApiSuccess(c, lotteryPrizeDTO(prize, true))
}

func UpdateLotteryAdminPrize(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	existing, err := model.GetLotteryPrizeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req lotteryPrizePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	prize := req.toPrize(existing)
	prize.Id = existing.Id
	if err := model.SaveLotteryPrize(&prize); err != nil {
		common.ApiError(c, err)
		return
	}
	prize.Stock, _ = model.CountLotteryPrizeStock(prize.RedemptionName)
	common.ApiSuccess(c, lotteryPrizeDTO(prize, true))
}

func DeleteLotteryAdminPrize(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := model.DeleteLotteryPrize(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GenerateLotteryAdminStock(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	prize, err := model.GetLotteryPrizeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req struct {
		Keys []string `json:"keys"`
	}
	_ = c.ShouldBindJSON(&req)
	keys, err := model.AddLotteryPrizeStock(prize, req.Keys, lotteryUserID(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stock, _ := model.CountLotteryPrizeStock(prize.RedemptionName)
	common.ApiSuccess(c, gin.H{"keys": keys, "count": len(keys), "stock": stock})
}

func ListLotteryAdminCodes(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	prizeId, _ := strconv.Atoi(c.Query("prize_id"))
	rows, total, err := model.ListLotteryPrizeCodes(prizeId, c.DefaultQuery("status", "all"), c.Query("q"), page, size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "page": page, "page_size": size})
}

func DeleteLotteryAdminCode(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := model.DeleteLotteryPrizeCode(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetLotteryAdminWallets(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	rows, total, err := model.LookupLotteryWallets(c.Query("q"), page, size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, gin.H{
			"user_id":         row.UserId,
			"userId":          row.UserId,
			"username":        row.Username,
			"tickets":         row.Tickets,
			"total_draws":     row.TotalDraws,
			"totalDraws":      row.TotalDraws,
			"total_won_quota": row.TotalWonQuota,
			"totalWonQuota":   row.TotalWonQuota,
			"updated_at":      row.UpdatedAt,
			"updatedAt":       row.UpdatedAt,
		})
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

func GetLotteryAdminUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	rows, total, err := model.ListLotteryUserSummaries(page, size, c.Query("q"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "page": page, "page_size": size})
}

func GetLotteryAdminTicketLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	rows, total, err := model.ListLotteryAdminTicketLogs(model.LotteryListFilter{
		Keyword: c.Query("q"),
		Filter:  c.DefaultQuery("filter", "all"),
		From:    parseDayBound(c.Query("from"), false),
		To:      parseDayBound(c.Query("to"), true),
		Page:    page,
		Size:    size,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		item := gin.H{
			"id":            row.Id,
			"user_id":       row.UserId,
			"username":      row.Username,
			"delta":         row.Delta,
			"reason":        row.Reason,
			"ref_type":      row.RefType,
			"ref_id":        row.RefId,
			"refId":         row.RefId,
			"balance_after": row.BalanceAfter,
			"balanceAfter":  row.BalanceAfter,
			"at":            row.CreatedAt * 1000,
		}
		if row.TopUp != nil {
			item["topup"] = gin.H{
				"trade_no":       row.TopUp.TradeNo,
				"money":          row.TopUp.Money,
				"payment_method": row.TopUp.PaymentMethod,
				"paymentMethod":  row.TopUp.PaymentMethod,
				"status":         row.TopUp.Status,
				"kind":           row.TopUp.Kind,
			}
		}
		items = append(items, item)
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

func GetLotteryAdminDraws(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	rows, total, err := model.ListLotteryDraws(model.LotteryListFilter{
		Keyword: c.Query("q"),
		Filter:  c.DefaultQuery("filter", "all"),
		Prize:   c.Query("prize"),
		From:    parseDayBound(c.Query("from"), false),
		To:      parseDayBound(c.Query("to"), true),
		Page:    page,
		Size:    size,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, lotteryDrawDTO(row, true))
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

func AdminGrantLotteryTickets(c *gin.Context) {
	if lotteryRole(c) < common.RoleAdminUser {
		common.ApiErrorMsg(c, "权限不足")
		return
	}
	var req struct {
		UserId    int  `json:"user_id"`
		Tickets   int  `json:"tickets"`
		AsPayment bool `json:"as_payment"`
	}
	_ = c.ShouldBindJSON(&req)
	userId := req.UserId
	if userId <= 0 {
		userId = lotteryUserID(c)
	}
	n := req.Tickets
	if n < 1 {
		n = 1
	}
	if n > 100 {
		n = 100
	}
	var err error
	if req.AsPayment {
		tradeNo := fmt.Sprintf("SIM-%d-%d", userId, time.Now().UnixNano())
		err = model.GrantLotteryTicketsForSuccessfulTopUp(nil, userId, tradeNo)
	} else {
		err = model.AdminGrantLotteryTickets(userId, n, "")
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	wallet, _ := model.GetLotteryWallet(userId)
	tickets := 0
	if wallet != nil {
		tickets = wallet.Tickets
	}
	username := ""
	if user, err := model.GetUserById(userId, false); err == nil && user != nil {
		username = user.Username
	}
	common.ApiSuccess(c, gin.H{"user_id": userId, "username": username, "tickets": tickets})
}

func GetLotteryAdminGifts(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	preview, err := model.ListLotteryGiftCandidates(model.LotteryGiftFilter{
		Range:    c.DefaultQuery("range", model.LotteryGiftRangeMonth),
		Period:   c.Query("period"),
		From:     c.Query("from"),
		To:       c.Query("to"),
		Audience: c.DefaultQuery("audience", model.LotteryGiftAudienceUnion),
		Status:   c.DefaultQuery("status", model.LotteryGiftStatusPending),
		Keyword:  c.Query("q"),
		Page:     page,
		Size:     size,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, preview)
}

func GrantLotteryAdminGifts(c *gin.Context) {
	var req struct {
		Range    string `json:"range"`
		Period   string `json:"period"`
		From     string `json:"from"`
		To       string `json:"to"`
		Audience string `json:"audience"`
		Tickets  int    `json:"tickets"`
		UserIds  []int  `json:"user_ids"`
		GrantAll bool   `json:"grant_all"`
		Keyword  string `json:"q"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	result, err := model.AdminGrantLotteryGifts(model.LotteryGiftGrantRequest{
		Range:    req.Range,
		Period:   req.Period,
		From:     req.From,
		To:       req.To,
		Audience: req.Audience,
		Tickets:  req.Tickets,
		UserIds:  req.UserIds,
		GrantAll: req.GrantAll,
		Keyword:  req.Keyword,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.SysLog(fmt.Sprintf(
		"lottery gift grant by user %d: range=%s period=%s audience=%s tickets=%d granted=%d skipped=%d failed=%d",
		lotteryUserID(c), result.Range, result.Period, result.Audience, result.Tickets, result.Granted, result.Skipped, result.Failed,
	))
	common.ApiSuccess(c, result)
}

func AckLotteryGiftNotice(c *gin.Context) {
	userId := lotteryUserID(c)
	if userId <= 0 {
		common.ApiErrorMsg(c, "请先登录")
		return
	}
	var req struct {
		Id int `json:"id"`
	}
	_ = c.ShouldBindJSON(&req)
	if err := model.AckLotteryGiftNotice(userId, req.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": req.Id})
}
