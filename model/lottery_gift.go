package model

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	LotteryGiftAudienceUnion     = "union"
	LotteryGiftAudiencePaid      = "paid"
	LotteryGiftAudienceSpent     = "spent"
	LotteryGiftAudiencePaidOnly  = "paid_only"
	LotteryGiftAudienceSpentOnly = "spent_only"

	LotteryGiftStatusAll     = "all"
	LotteryGiftStatusPending = "pending"
	LotteryGiftStatusGranted = "granted"

	LotteryGiftRangeMonth  = "month"
	LotteryGiftRangeWeek   = "week"
	LotteryGiftRangeToday  = "today"
	LotteryGiftRangeCustom = "custom"

	lotteryGiftMaxBatch   = 5000
	lotteryGiftMaxTickets = 10
	lotteryGiftChunkSize  = 500
	lotteryGiftMaxDays    = 366
)

type LotteryGiftFilter struct {
	Range    string
	Period   string
	From     string
	To       string
	Audience string
	Status   string
	Keyword  string
	Page     int
	Size     int
	Now      time.Time
}

type LotteryGiftCandidate struct {
	UserId   int    `json:"user_id"`
	Username string `json:"username"`
	Paid     bool   `json:"paid"`
	Spent    bool   `json:"spent"`
	Granted  bool   `json:"granted"`
	Tickets  int    `json:"tickets"`
}

type LotteryGiftPreview struct {
	Range        string                 `json:"range"`
	Period       string                 `json:"period"`
	Campaign     string                 `json:"campaign"`
	From         string                 `json:"from"`
	To           string                 `json:"to"`
	Audience     string                 `json:"audience"`
	Paid         int                    `json:"paid"`
	Spent        int                    `json:"spent"`
	Union        int                    `json:"union"`
	Eligible     int                    `json:"eligible"`
	Pending      int                    `json:"pending"`
	Granted      int                    `json:"granted"`
	PendingMatch int                    `json:"pending_match"`
	Items        []LotteryGiftCandidate `json:"items"`
	Total        int64                  `json:"total"`
	Page         int                    `json:"page"`
	PageSize     int                    `json:"page_size"`
}

type LotteryGiftGrantRequest struct {
	Range    string
	Period   string
	From     string
	To       string
	Audience string
	Tickets  int
	UserIds  []int
	GrantAll bool
	Keyword  string
	Now      time.Time
}

type LotteryGiftGrantResult struct {
	Range    string `json:"range"`
	Period   string `json:"period"`
	Campaign string `json:"campaign"`
	From     string `json:"from"`
	To       string `json:"to"`
	Audience string `json:"audience"`
	Tickets  int    `json:"tickets"`
	Granted  int    `json:"granted"`
	Skipped  int    `json:"skipped"`
	Failed   int    `json:"failed"`
	Pending  int    `json:"pending"`
	Eligible int    `json:"eligible"`
}

type LotteryGiftWindow struct {
	Range    string
	Campaign string
	Start    int64
	End      int64
	FromDay  string
	ToDay    string
}

func ParseLotteryGiftPeriod(raw string, now time.Time) (period string, start, end int64, err error) {
	if now.IsZero() {
		now = time.Now()
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		period = LotteryGiftPeriod(now)
		start, end = LotteryMonthRange(now)
		return period, start, end, nil
	}
	t, perr := time.ParseInLocation("2006-01", raw, lotteryShanghaiLoc)
	if perr != nil {
		return "", 0, 0, errors.New("月份格式应为 YYYY-MM")
	}
	period = t.Format("2006-01")
	begin := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, lotteryShanghaiLoc)
	return period, begin.Unix(), begin.AddDate(0, 1, 0).Unix(), nil
}

func NormalizeLotteryGiftRange(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", LotteryGiftRangeMonth, "this_month":
		return LotteryGiftRangeMonth, nil
	case LotteryGiftRangeWeek, "this_week":
		return LotteryGiftRangeWeek, nil
	case LotteryGiftRangeToday, "day":
		return LotteryGiftRangeToday, nil
	case LotteryGiftRangeCustom:
		return LotteryGiftRangeCustom, nil
	default:
		return "", errors.New("时间范围无效")
	}
}

func shanghaiDayStart(t time.Time) time.Time {
	t = t.In(lotteryShanghaiLoc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, lotteryShanghaiLoc)
}

func LotteryWeekRange(now time.Time) (start, end int64) {
	begin := shanghaiDayStart(now)
	wd := int(begin.Weekday())
	if wd == 0 {
		wd = 7
	}
	begin = begin.AddDate(0, 0, 1-wd)
	return begin.Unix(), begin.AddDate(0, 0, 7).Unix()
}

func LotteryDayRange(now time.Time) (start, end int64) {
	begin := shanghaiDayStart(now)
	return begin.Unix(), begin.AddDate(0, 0, 1).Unix()
}

func parseLotteryGiftDay(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, errors.New("请选择日期")
	}
	t, err := time.ParseInLocation("2006-01-02", raw, lotteryShanghaiLoc)
	if err != nil {
		return time.Time{}, errors.New("日期格式应为 YYYY-MM-DD")
	}
	return t, nil
}

func giftWindowFromSpan(rangeKind string, campaign string, start, end time.Time) *LotteryGiftWindow {
	inclusiveEnd := end.Add(-time.Second)
	return &LotteryGiftWindow{
		Range:    rangeKind,
		Campaign: campaign,
		Start:    start.Unix(),
		End:      end.Unix(),
		FromDay:  start.Format("2006-01-02"),
		ToDay:    inclusiveEnd.In(lotteryShanghaiLoc).Format("2006-01-02"),
	}
}

func ResolveLotteryGiftWindow(rangeKind, period, from, to string, now time.Time) (*LotteryGiftWindow, error) {
	if now.IsZero() {
		now = time.Now()
	}
	kind, err := NormalizeLotteryGiftRange(rangeKind)
	if err != nil {
		return nil, err
	}
	now = now.In(lotteryShanghaiLoc)
	switch kind {
	case LotteryGiftRangeWeek:
		start, end := LotteryWeekRange(now)
		begin := time.Unix(start, 0).In(lotteryShanghaiLoc)
		stop := time.Unix(end, 0).In(lotteryShanghaiLoc)
		return giftWindowFromSpan(kind, "w:"+begin.Format("2006-01-02"), begin, stop), nil
	case LotteryGiftRangeToday:
		start, end := LotteryDayRange(now)
		begin := time.Unix(start, 0).In(lotteryShanghaiLoc)
		stop := time.Unix(end, 0).In(lotteryShanghaiLoc)
		return giftWindowFromSpan(kind, "d:"+begin.Format("2006-01-02"), begin, stop), nil
	case LotteryGiftRangeCustom:
		begin, err := parseLotteryGiftDay(from)
		if err != nil {
			return nil, errors.New("请选择开始日期")
		}
		last, err := parseLotteryGiftDay(to)
		if err != nil {
			return nil, errors.New("请选择结束日期")
		}
		if last.Before(begin) {
			return nil, errors.New("结束日期不能早于开始日期")
		}
		stop := last.AddDate(0, 0, 1)
		if int(stop.Sub(begin).Hours()/24) > lotteryGiftMaxDays {
			return nil, fmt.Errorf("自定义时间最多 %d 天", lotteryGiftMaxDays)
		}
		campaign := fmt.Sprintf("c:%s:%s", begin.Format("2006-01-02"), last.Format("2006-01-02"))
		return giftWindowFromSpan(kind, campaign, begin, stop), nil
	default:
		month, start, end, err := ParseLotteryGiftPeriod(period, now)
		if err != nil {
			return nil, err
		}
		begin := time.Unix(start, 0).In(lotteryShanghaiLoc)
		stop := time.Unix(end, 0).In(lotteryShanghaiLoc)
		return giftWindowFromSpan(LotteryGiftRangeMonth, month, begin, stop), nil
	}
}

func NormalizeLotteryGiftAudience(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", LotteryGiftAudienceUnion, "paid_or_spent", "recharge_or_consume":
		return LotteryGiftAudienceUnion, nil
	case LotteryGiftAudiencePaid, "recharge":
		return LotteryGiftAudiencePaid, nil
	case LotteryGiftAudienceSpent, "consume":
		return LotteryGiftAudienceSpent, nil
	case LotteryGiftAudiencePaidOnly:
		return LotteryGiftAudiencePaidOnly, nil
	case LotteryGiftAudienceSpentOnly:
		return LotteryGiftAudienceSpentOnly, nil
	default:
		return "", errors.New("人员范围无效")
	}
}

func NormalizeLotteryGiftStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case LotteryGiftStatusGranted:
		return LotteryGiftStatusGranted
	case LotteryGiftStatusAll:
		return LotteryGiftStatusAll
	default:
		return LotteryGiftStatusPending
	}
}

func grantLotteryGiftTickets(userId, n int, period string) error {
	if userId <= 0 || period == "" {
		return errors.New("invalid gift grant")
	}
	if n < 1 {
		n = 1
	}
	if n > lotteryGiftMaxTickets {
		n = lotteryGiftMaxTickets
	}
	refId := lotteryGiftRefId(userId, period)
	return DB.Transaction(func(tx *gorm.DB) error {
		return addLotteryTickets(tx, userId, n, LotteryReasonMonthlyGift, LotteryRefGift, refId)
	})
}

func ListLotteryGiftCandidates(f LotteryGiftFilter) (*LotteryGiftPreview, error) {
	collected, err := collectLotteryGiftAudience(f)
	if err != nil {
		return nil, err
	}
	page := f.Page
	if page < 1 {
		page = 1
	}
	size := f.Size
	if size < 1 || size > 100 {
		size = 20
	}
	status := NormalizeLotteryGiftStatus(f.Status)
	filtered := filterLotteryGiftCandidates(collected.Users, f.Keyword, status)
	total := int64(len(filtered))
	pendingMatch := len(filterLotteryGiftCandidates(collected.Users, f.Keyword, LotteryGiftStatusPending))
	start := (page - 1) * size
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + size
	if end > len(filtered) {
		end = len(filtered)
	}
	items := filtered[start:end]
	if err := fillLotteryGiftTickets(items); err != nil {
		return nil, err
	}
	out := &LotteryGiftPreview{
		Range:        collected.Range,
		Period:       collected.Campaign,
		Campaign:     collected.Campaign,
		From:         collected.FromDay,
		To:           collected.ToDay,
		Audience:     collected.Audience,
		Paid:         collected.Paid,
		Spent:        collected.Spent,
		Union:        collected.Union,
		Eligible:     collected.Eligible,
		Pending:      collected.Pending,
		Granted:      collected.Granted,
		PendingMatch: pendingMatch,
		Items:        items,
		Total:        total,
		Page:         page,
		PageSize:     size,
	}
	return out, nil
}

func AdminGrantLotteryGifts(req LotteryGiftGrantRequest) (*LotteryGiftGrantResult, error) {
	if !req.GrantAll && len(req.UserIds) == 0 {
		return nil, errors.New("请勾选用户，或选择发放全部未发")
	}
	n := req.Tickets
	if n < 1 {
		n = 1
	}
	if n > lotteryGiftMaxTickets {
		return nil, fmt.Errorf("每人发放次数最多 %d", lotteryGiftMaxTickets)
	}
	filter := LotteryGiftFilter{
		Range:    req.Range,
		Period:   req.Period,
		From:     req.From,
		To:       req.To,
		Audience: req.Audience,
		Now:      req.Now,
	}
	collected, err := collectLotteryGiftAudience(filter)
	if err != nil {
		return nil, err
	}
	targets := pendingLotteryGiftCandidates(collected.Users)
	if req.GrantAll {
		targets = filterLotteryGiftCandidates(targets, req.Keyword, LotteryGiftStatusPending)
	} else {
		allow := intIDSet(req.UserIds)
		filtered := make([]LotteryGiftCandidate, 0, len(req.UserIds))
		for _, row := range targets {
			if _, ok := allow[row.UserId]; ok {
				filtered = append(filtered, row)
			}
		}
		targets = filtered
	}
	if len(targets) == 0 {
		return nil, errors.New("没有可发放的用户")
	}
	if len(targets) > lotteryGiftMaxBatch {
		return nil, fmt.Errorf("单次最多发放 %d 人，请缩小筛选范围", lotteryGiftMaxBatch)
	}
	result := &LotteryGiftGrantResult{
		Range:    collected.Range,
		Period:   collected.Campaign,
		Campaign: collected.Campaign,
		From:     collected.FromDay,
		To:       collected.ToDay,
		Audience: collected.Audience,
		Tickets:  n,
		Eligible: collected.Eligible,
	}
	for _, row := range targets {
		existing, err := findLotteryGiftLog(row.UserId, lotteryGiftRefId(row.UserId, collected.Campaign))
		if err != nil {
			result.Failed++
			continue
		}
		if existing != nil {
			result.Skipped++
			continue
		}
		if err := grantLotteryGiftTickets(row.UserId, n, collected.Campaign); err != nil {
			result.Failed++
			continue
		}
		result.Granted++
	}
	after, err := collectLotteryGiftAudience(filter)
	if err == nil && after != nil {
		result.Pending = after.Pending
		result.Eligible = after.Eligible
	}
	return result, nil
}

type lotteryGiftAudience struct {
	Range    string
	Campaign string
	FromDay  string
	ToDay    string
	Audience string
	Paid     int
	Spent    int
	Union    int
	Eligible int
	Pending  int
	Granted  int
	Users    []LotteryGiftCandidate
}

func collectLotteryGiftAudience(f LotteryGiftFilter) (*lotteryGiftAudience, error) {
	audience, err := NormalizeLotteryGiftAudience(f.Audience)
	if err != nil {
		return nil, err
	}
	window, err := ResolveLotteryGiftWindow(f.Range, f.Period, f.From, f.To, f.Now)
	if err != nil {
		return nil, err
	}
	paidIds, err := listMonthlyPaidUserIds(window.Start, window.End)
	if err != nil {
		return nil, err
	}
	spentIds, err := listMonthlySpentUserIds(window.Start, window.End)
	if err != nil {
		return nil, err
	}
	paidSet := intIDSet(paidIds)
	spentSet := intIDSet(spentIds)
	unionSet := mergeIntSets(paidSet, spentSet)
	audienceSet := lotteryGiftAudienceSet(audience, paidSet, spentSet)
	users, err := loadEnabledLotteryGiftUsers(setToSortedIDs(audienceSet), paidSet, spentSet)
	if err != nil {
		return nil, err
	}
	granted, err := lotteryGiftGrantedSet(userIDsOf(users), window.Campaign)
	if err != nil {
		return nil, err
	}
	pending := 0
	grantedN := 0
	for i := range users {
		if _, ok := granted[users[i].UserId]; ok {
			users[i].Granted = true
			grantedN++
		} else {
			pending++
		}
	}
	sort.Slice(users, func(i, j int) bool {
		return users[i].UserId > users[j].UserId
	})
	return &lotteryGiftAudience{
		Range:    window.Range,
		Campaign: window.Campaign,
		FromDay:  window.FromDay,
		ToDay:    window.ToDay,
		Audience: audience,
		Paid:     len(paidSet),
		Spent:    len(spentSet),
		Union:    len(unionSet),
		Eligible: len(users),
		Pending:  pending,
		Granted:  grantedN,
		Users:    users,
	}, nil
}

func lotteryGiftAudienceSet(audience string, paidSet, spentSet map[int]struct{}) map[int]struct{} {
	out := make(map[int]struct{})
	switch audience {
	case LotteryGiftAudiencePaid:
		return cloneIntSet(paidSet)
	case LotteryGiftAudienceSpent:
		return cloneIntSet(spentSet)
	case LotteryGiftAudiencePaidOnly:
		for id := range paidSet {
			if _, ok := spentSet[id]; !ok {
				out[id] = struct{}{}
			}
		}
	case LotteryGiftAudienceSpentOnly:
		for id := range spentSet {
			if _, ok := paidSet[id]; !ok {
				out[id] = struct{}{}
			}
		}
	default:
		return mergeIntSets(paidSet, spentSet)
	}
	return out
}

func filterLotteryGiftCandidates(rows []LotteryGiftCandidate, keyword, status string) []LotteryGiftCandidate {
	out := make([]LotteryGiftCandidate, 0, len(rows))
	for _, row := range rows {
		if status == LotteryGiftStatusPending && row.Granted {
			continue
		}
		if status == LotteryGiftStatusGranted && !row.Granted {
			continue
		}
		if !lotteryGiftKeywordMatch(row, keyword) {
			continue
		}
		out = append(out, row)
	}
	return out
}

func pendingLotteryGiftCandidates(rows []LotteryGiftCandidate) []LotteryGiftCandidate {
	out := make([]LotteryGiftCandidate, 0, len(rows))
	for _, row := range rows {
		if !row.Granted {
			out = append(out, row)
		}
	}
	return out
}

func lotteryGiftKeywordMatch(row LotteryGiftCandidate, keyword string) bool {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return true
	}
	if strconv.Itoa(row.UserId) == keyword {
		return true
	}
	return strings.Contains(strings.ToLower(row.Username), strings.ToLower(keyword))
}

func fillLotteryGiftTickets(rows []LotteryGiftCandidate) error {
	if len(rows) == 0 {
		return nil
	}
	ids := userIDsOf(rows)
	wallets := make(map[int]int, len(ids))
	for _, chunk := range chunkInts(ids, lotteryGiftChunkSize) {
		var list []LotteryWallet
		if err := DB.Select("user_id, tickets").Where("user_id IN ?", chunk).Find(&list).Error; err != nil {
			return err
		}
		for _, w := range list {
			wallets[w.UserId] = w.Tickets
		}
	}
	for i := range rows {
		rows[i].Tickets = wallets[rows[i].UserId]
	}
	return nil
}

func loadEnabledLotteryGiftUsers(ids []int, paidSet, spentSet map[int]struct{}) ([]LotteryGiftCandidate, error) {
	out := make([]LotteryGiftCandidate, 0, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	for _, chunk := range chunkInts(ids, lotteryGiftChunkSize) {
		var users []User
		err := DB.Select("id, username").
			Where("id IN ? AND status = ?", chunk, common.UserStatusEnabled).
			Find(&users).Error
		if err != nil {
			return nil, err
		}
		for _, u := range users {
			_, paid := paidSet[u.Id]
			_, spent := spentSet[u.Id]
			out = append(out, LotteryGiftCandidate{
				UserId:   u.Id,
				Username: u.Username,
				Paid:     paid,
				Spent:    spent,
			})
		}
	}
	return out, nil
}

func lotteryGiftGrantedSet(userIds []int, period string) (map[int]struct{}, error) {
	out := make(map[int]struct{})
	if len(userIds) == 0 || period == "" {
		return out, nil
	}
	for _, chunk := range chunkInts(userIds, lotteryGiftChunkSize) {
		var rows []LotteryTicketLog
		err := DB.Select("user_id, ref_id").
			Where("reason = ? AND ref_type = ? AND user_id IN ?", LotteryReasonMonthlyGift, LotteryRefGift, chunk).
			Find(&rows).Error
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			if row.RefId == lotteryGiftRefId(row.UserId, period) {
				out[row.UserId] = struct{}{}
			}
		}
	}
	return out, nil
}

func listMonthlyPaidUserIds(start, end int64) ([]int, error) {
	timeExpr := "(CASE WHEN complete_time > 0 THEN complete_time ELSE create_time END)"
	var ids []int
	err := DB.Model(&TopUp{}).
		Where("status = ?", common.TopUpStatusSuccess).
		Where(timeExpr+" >= ? AND "+timeExpr+" < ?", start, end).
		Distinct("user_id").
		Pluck("user_id", &ids).Error
	return filterPositiveIDs(ids), err
}

func listMonthlySpentUserIds(start, end int64) ([]int, error) {
	var ids []int
	err := lotteryLogDB().Model(&Log{}).
		Where("type = ? AND quota > 0 AND created_at >= ? AND created_at < ?", LogTypeConsume, start, end).
		Distinct("user_id").
		Pluck("user_id", &ids).Error
	return filterPositiveIDs(ids), err
}

func lotteryLogDB() *gorm.DB {
	if LOG_DB != nil {
		return LOG_DB
	}
	return DB
}

func intIDSet(ids []int) map[int]struct{} {
	out := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		if id > 0 {
			out[id] = struct{}{}
		}
	}
	return out
}

func cloneIntSet(in map[int]struct{}) map[int]struct{} {
	out := make(map[int]struct{}, len(in))
	for id := range in {
		out[id] = struct{}{}
	}
	return out
}

func mergeIntSets(a, b map[int]struct{}) map[int]struct{} {
	out := cloneIntSet(a)
	for id := range b {
		out[id] = struct{}{}
	}
	return out
}

func setToSortedIDs(in map[int]struct{}) []int {
	ids := make([]int, 0, len(in))
	for id := range in {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

func userIDsOf(rows []LotteryGiftCandidate) []int {
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		if row.UserId > 0 {
			ids = append(ids, row.UserId)
		}
	}
	return ids
}

func filterPositiveIDs(ids []int) []int {
	out := make([]int, 0, len(ids))
	seen := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func chunkInts(ids []int, n int) [][]int {
	if n < 1 {
		n = lotteryGiftChunkSize
	}
	if len(ids) == 0 {
		return nil
	}
	out := make([][]int, 0, (len(ids)+n-1)/n)
	for i := 0; i < len(ids); i += n {
		j := i + n
		if j > len(ids) {
			j = len(ids)
		}
		out = append(out, ids[i:j])
	}
	return out
}

func lotteryGiftNoticeReasons() []string {
	return []string{LotteryReasonMonthlyGift, LotteryReasonAdminAdjust}
}

func LatestUnseenLotteryGiftNotice(userId int) (*LotteryTicketLog, error) {
	if userId <= 0 {
		return nil, nil
	}
	seen := 0
	if wallet, err := GetLotteryWallet(userId); err == nil && wallet != nil {
		seen = wallet.GiftNoticeSeenId
	}
	var row LotteryTicketLog
	q := DB.Where("user_id = ? AND delta > 0 AND reason IN ?", userId, lotteryGiftNoticeReasons())
	if seen > 0 {
		q = q.Where("id > ?", seen)
	}
	err := q.Order("id DESC").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func AckLotteryGiftNotice(userId, logId int) error {
	if userId <= 0 || logId <= 0 {
		return errors.New("没有这条礼包提醒")
	}
	var row LotteryTicketLog
	err := DB.Where("id = ? AND user_id = ? AND delta > 0 AND reason IN ?",
		logId, userId, lotteryGiftNoticeReasons()).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("没有这条礼包提醒")
	}
	if err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		wallet, err := getOrCreateLotteryWallet(tx, userId)
		if err != nil {
			return err
		}
		if wallet.GiftNoticeSeenId >= logId {
			return nil
		}
		return tx.Model(&LotteryWallet{}).
			Where("user_id = ?", userId).
			Update("gift_notice_seen_id", logId).Error
	})
}
