/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// 合并开具的订单数量上限。够覆盖「客户把一年的单子一次开完」，
// 又不至于让单张收据长到几十页、或被拿来当批量查询接口刷。
const maxMergeReceiptItems = 100

// TopUpReceipt 一张已支付订单的「收款收据」。
//
// 收据 ≠ 发票：这里只出付款凭证，不涉及税务，所以没有税号、也不需要公章。
// 时间统一给 Unix 时间戳，交由前端用站点既有的 timestamp2string 格式化，
// 避免后端按服务器时区格式化出一个与页面其它时间不一致的字符串。
type TopUpReceipt struct {
	ReceiptNo      string  `json:"receipt_no"`
	TradeNo        string  `json:"trade_no"`
	PayerName      string  `json:"payer_name"`
	PayerEmail     string  `json:"payer_email"`
	ItemName       string  `json:"item_name"`
	// Remark 只有手工开具的收据会用到（线下转账的说明），其余情况为空
	Remark string `json:"remark"`
	// Amount 是所购额度的【美元计价数量】，不是 quota 原始值
	// （model/topup.go 的补单逻辑里 quota = Amount * QuotaPerUnit）。
	// 订阅套餐订单该值为 0，前端据此不渲染这一行。
	Amount         int64   `json:"amount"`
	Money          float64 `json:"money"`
	CurrencyCode   string  `json:"currency_code"`
	CurrencySymbol string  `json:"currency_symbol"`
	PaymentMethod  string  `json:"payment_method"`
	PaidAt         int64   `json:"paid_at"`
	IssuedAt       int64   `json:"issued_at"`
	SiteName       string  `json:"site_name"`
	SiteURL        string  `json:"site_url"`
}

// FillTopUpCurrency 给充值记录补上币种字段（不入库，见 model.TopUp 注释）。
// 充值列表接口在返回前调用，前端才能正确显示金额符号、并在合并收据时拦住混币种。
func FillTopUpCurrency(topups []*model.TopUp) {
	for _, t := range topups {
		if t == nil {
			continue
		}
		t.CurrencyCode, t.CurrencySymbol = receiptCurrency(t.PaymentMethod)
	}
}

// receiptCurrency 按【支付渠道】判定收款币种。
//
// 刻意不用站点的额度展示设置（general_setting.quota_display_type）：那个管的是
// 余额怎么显示，与实际收了哪种钱无关 —— 站点用美元计价、却通过易支付收人民币是
// 常见配置。收据上标错币种等于废纸，所以这里按渠道逐个给死。
//
// symbol 可能为空（冷门币种不硬猜符号），前端需回退成显示币种代码。
func receiptCurrency(paymentMethod string) (code string, symbol string) {
	switch strings.ToLower(strings.TrimSpace(paymentMethod)) {
	case "stripe", "creem":
		return "USD", "$"
	case "waffo":
		// Waffo 的币种是管理员可配的，读实际配置而不是假定
		switch strings.ToUpper(strings.TrimSpace(setting.WaffoCurrency)) {
		case "", "CNY":
			return "CNY", "¥"
		case "USD":
			return "USD", "$"
		default:
			return strings.ToUpper(strings.TrimSpace(setting.WaffoCurrency)), ""
		}
	default:
		// 易支付系（alipay / wxpay / xunhu / custom*）一律人民币收款
		return "CNY", "¥"
	}
}

// topUpPaidAt 取订单的支付时间。
// 优先 complete_time；异常数据（历史补单等）缺失时回落到下单时间 ——
// 总比在收据上印一个 1970 年好。
func topUpPaidAt(topUp *model.TopUp) int64 {
	if topUp.CompleteTime > 0 {
		return topUp.CompleteTime
	}
	return topUp.CreateTime
}

// isSubscriptionOrder 判定订阅套餐订单。
// 与前端 TopupHistoryModal 的 isSubscriptionTopup 保持同一套规则：
// 充值额度为 0 且订单号以 SUB 开头（线上实际形如 SUBUSR930NO...）。
func isSubscriptionOrder(topUp *model.TopUp) bool {
	return topUp.Amount == 0 &&
		strings.HasPrefix(strings.ToUpper(topUp.TradeNo), "SUB")
}

// GetTopUpReceipt 返回当前用户某笔已支付订单的电子收据数据。
func GetTopUpReceipt(c *gin.Context) {
	userId := c.GetInt("id")
	tradeNo := strings.TrimSpace(c.Param("trade_no"))
	if tradeNo == "" {
		common.ApiErrorMsg(c, "订单号不能为空")
		return
	}

	topUp := model.GetTopUpByTradeNo(tradeNo)
	// 「不存在」与「不属于本人」故意合并成同一条错误：分开报会让这个接口
	// 变成订单号存在性探测器（trade_no 里含用户 id，可被用来枚举他人订单）。
	//
	// 管理员放行任意订单：站长常常要替来要收据的客户开一张，
	// 而管理员的账单列表本来就能看到全站订单，这里不放行只会让那个
	// 「收据」按钮点了必报错。
	isAdminRole := c.GetInt("role") >= common.RoleAdminUser
	if topUp == nil || (!isAdminRole && topUp.UserId != userId) {
		common.ApiErrorMsg(c, "订单不存在")
		return
	}
	if topUp.Status != common.TopUpStatusSuccess {
		common.ApiErrorMsg(c, "该订单未支付成功，无法开具收据")
		return
	}

	// 付款人取【订单所属用户】而非请求者：管理员代开时，收据上必须是客户的名字。
	user, err := model.GetUserById(topUp.UserId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	payerName := strings.TrimSpace(user.DisplayName)
	if payerName == "" {
		payerName = user.Username
	}

	itemName := "API 额度充值"
	if isSubscriptionOrder(topUp) {
		itemName = "订阅套餐"
	}

	code, symbol := receiptCurrency(topUp.PaymentMethod)

	common.ApiSuccess(c, &TopUpReceipt{
		// 收据编号直接复用订单号：它本身就唯一且可与支付渠道对账，
		// 另起一套编号还得建表存自增状态，对一张付款凭证没必要。
		ReceiptNo:      topUp.TradeNo,
		TradeNo:        topUp.TradeNo,
		PayerName:      payerName,
		PayerEmail:     user.Email,
		ItemName:       itemName,
		Amount:         topUp.Amount,
		Money:          topUp.Money,
		CurrencyCode:   code,
		CurrencySymbol: symbol,
		PaymentMethod:  topUp.PaymentMethod,
		PaidAt:         topUpPaidAt(topUp),
		IssuedAt:       time.Now().Unix(),
		SiteName:       common.SystemName,
		SiteURL:        system_setting.ServerAddress,
	})
}

// ManualReceiptRequest 手工开具收据的入参。
//
// 用于「客户私信转账、系统里没有订单」的场景：钱走的是线下，
// 系统无从得知，所以金额/币种/收款方式/时间全部由管理员填。
type ManualReceiptRequest struct {
	UserId        int     `json:"user_id"`
	Money         float64 `json:"money"`
	CurrencyCode  string  `json:"currency_code"`
	PaymentMethod string  `json:"payment_method"`
	PaidAt        int64   `json:"paid_at"`
	ItemName      string  `json:"item_name"`
	Remark        string  `json:"remark"`
}

// manualCurrencySymbol 手工收据的币种符号。
// 线下转账没有支付渠道可推断币种，只能按管理员选的来。
func manualCurrencySymbol(code string) (string, string) {
	switch strings.ToUpper(strings.TrimSpace(code)) {
	case "", "CNY":
		return "CNY", "¥"
	case "USD":
		return "USD", "$"
	default:
		// 其它币种不硬猜符号，前端会回退成显示币种代码
		return strings.ToUpper(strings.TrimSpace(code)), ""
	}
}

// IssueManualReceipt 手工开具一张收据（管理员，仅 AdminAuth 路由可达）。
//
// 刻意【不写任何库】：不造 top_ups 记录，因此
//   - 不会给用户加额度、不会误发邀请返利
//   - 不会计入 GetUserTotalTopUpAmount（不影响签到的累计充值门槛）
//   - 不会出现在客户自己的账单列表里
// 就是一张凭据，出完即走。
func IssueManualReceipt(c *gin.Context) {
	var req ManualReceiptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数有误")
		return
	}

	if req.UserId <= 0 {
		common.ApiErrorMsg(c, "请选择用户")
		return
	}
	// 金额按分取整校验：0.001 这种填进来，收据上会显示成 ¥0.00
	if req.Money < 0.01 {
		common.ApiErrorMsg(c, "收款金额必须大于 0.01")
		return
	}
	if req.PaymentMethod == "" {
		common.ApiErrorMsg(c, "请填写收款方式")
		return
	}

	paidAt := req.PaidAt
	if paidAt <= 0 {
		paidAt = time.Now().Unix()
	}

	user, err := model.GetUserById(req.UserId, false)
	if err != nil {
		// 不直接抛 err：查不到时 GORM 给的是 "record not found"，
		// 印在界面上对管理员没有任何意义
		common.ApiErrorMsg(c, "用户不存在")
		return
	}
	payerName := strings.TrimSpace(user.DisplayName)
	if payerName == "" {
		payerName = user.Username
	}

	itemName := strings.TrimSpace(req.ItemName)
	if itemName == "" {
		itemName = "API 额度充值"
	}

	code, symbol := manualCurrencySymbol(req.CurrencyCode)

	// 编号对「用户+金额+时间+方式」取哈希：同样的内容重开会得到同一个编号，
	// 客户手上不会出现两张编号不同、内容相同的收据。M 前缀表示手工开具。
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%.2f|%d|%s",
		req.UserId, req.Money, paidAt, req.PaymentMethod)))
	receiptNo := fmt.Sprintf("M-%d-%s-%s",
		req.UserId,
		time.Unix(paidAt, 0).Format("20060102"),
		strings.ToUpper(hex.EncodeToString(sum[:2])),
	)

	common.ApiSuccess(c, &TopUpReceipt{
		ReceiptNo:  receiptNo,
		TradeNo:    "", // 线下付款没有系统订单号，前端不渲染这一行
		PayerName:  payerName,
		PayerEmail: user.Email,
		ItemName:   itemName,
		Remark:     strings.TrimSpace(req.Remark),
		// Amount 留 0：线下转账对应多少额度由管理员自己在后台加，
		// 收据只证明收到了多少钱
		Amount:         0,
		Money:          req.Money,
		CurrencyCode:   code,
		CurrencySymbol: symbol,
		PaymentMethod:  req.PaymentMethod,
		PaidAt:         paidAt,
		IssuedAt:       time.Now().Unix(),
		SiteName:       common.SystemName,
		SiteURL:        system_setting.ServerAddress,
	})
}

// MergedReceiptItem 合并收据里的一行明细。
type MergedReceiptItem struct {
	TradeNo       string  `json:"trade_no"`
	ItemName      string  `json:"item_name"`
	Amount        int64   `json:"amount"`
	Money         float64 `json:"money"`
	PaymentMethod string  `json:"payment_method"`
	PaidAt        int64   `json:"paid_at"`
}

// MergedReceipt 多笔付款合并的一张收据。
type MergedReceipt struct {
	ReceiptNo      string              `json:"receipt_no"`
	PayerName      string              `json:"payer_name"`
	PayerEmail     string              `json:"payer_email"`
	Items          []MergedReceiptItem `json:"items"`
	TotalMoney     float64             `json:"total_money"`
	CurrencyCode   string              `json:"currency_code"`
	CurrencySymbol string              `json:"currency_symbol"`
	// 明细里最早/最晚的支付时间，收据上作为「付款区间」
	PeriodStart int64  `json:"period_start"`
	PeriodEnd   int64  `json:"period_end"`
	IssuedAt    int64  `json:"issued_at"`
	SiteName    string `json:"site_name"`
	SiteURL     string `json:"site_url"`
}

// mergedReceiptNo 按订单集合确定性地生成收据编号。
//
// 用哈希而不是自增序号：自增要建表存状态，且同一批订单重开会拿到新号，
// 客户手上就出现两张编号不同、内容相同的收据，对账时说不清。
// 哈希对【排序后】的单号集合取，所以勾选顺序不影响编号。
func mergedReceiptNo(userId int, tradeNos []string, latestPaidAt int64) string {
	sorted := make([]string, len(tradeNos))
	copy(sorted, tradeNos)
	sort.Strings(sorted)
	sum := sha256.Sum256([]byte(strings.Join(sorted, "|")))
	return fmt.Sprintf("R-%d-%s-%s",
		userId,
		time.Unix(latestPaidAt, 0).Format("20060102"),
		strings.ToUpper(hex.EncodeToString(sum[:2])),
	)
}

// GetMergedTopUpReceipt 把多笔已支付订单合并成一张收据。
func GetMergedTopUpReceipt(c *gin.Context) {
	userId := c.GetInt("id")
	isAdminRole := c.GetInt("role") >= common.RoleAdminUser

	var req struct {
		TradeNos []string `json:"trade_nos"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数有误")
		return
	}

	// 去重：同一单号重复传会把这笔金额在合计里算两次
	seen := make(map[string]bool, len(req.TradeNos))
	nos := make([]string, 0, len(req.TradeNos))
	for _, n := range req.TradeNos {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		nos = append(nos, n)
	}
	if len(nos) == 0 {
		common.ApiErrorMsg(c, "请至少选择一笔订单")
		return
	}
	if len(nos) > maxMergeReceiptItems {
		common.ApiErrorMsg(c, fmt.Sprintf("一张收据最多合并 %d 笔订单", maxMergeReceiptItems))
		return
	}

	topups := make([]*model.TopUp, 0, len(nos))
	for _, n := range nos {
		t := model.GetTopUpByTradeNo(n)
		if t == nil {
			common.ApiErrorMsg(c, "订单不存在")
			return
		}
		topups = append(topups, t)
	}

	// 全部订单必须同属一个用户：不同客户的付款合成一张收据没有意义，
	// 更要紧的是会把 A 的订单号印在 B 的收据上。
	owner := topups[0].UserId
	for _, t := range topups {
		if t.UserId != owner {
			common.ApiErrorMsg(c, "所选订单不属于同一用户，无法合并开具")
			return
		}
	}
	// 非管理员只能合并自己的单；与单笔接口一致，不透露订单是否存在
	if !isAdminRole && owner != userId {
		common.ApiErrorMsg(c, "订单不存在")
		return
	}

	for _, t := range topups {
		if t.Status != common.TopUpStatusSuccess {
			common.ApiErrorMsg(c, fmt.Sprintf("订单 %s 未支付成功，无法开具收据", t.TradeNo))
			return
		}
	}

	// 币种必须一致 —— 混着 ¥ 和 $ 时合计栏填什么都是错的，只能拒绝。
	code, symbol := receiptCurrency(topups[0].PaymentMethod)
	for _, t := range topups {
		if other, _ := receiptCurrency(t.PaymentMethod); other != code {
			common.ApiErrorMsg(c, fmt.Sprintf(
				"所选订单币种不一致（%s 与 %s），无法合并开具", code, other))
			return
		}
	}

	// 按支付时间升序，收据上的明细才是一条时间线
	sort.Slice(topups, func(i, j int) bool {
		return topUpPaidAt(topups[i]) < topUpPaidAt(topups[j])
	})

	items := make([]MergedReceiptItem, 0, len(topups))
	total := decimal.NewFromInt(0)
	for _, t := range topups {
		itemName := "API 额度充值"
		if isSubscriptionOrder(t) {
			itemName = "订阅套餐"
		}
		items = append(items, MergedReceiptItem{
			TradeNo:       t.TradeNo,
			ItemName:      itemName,
			Amount:        t.Amount,
			Money:         t.Money,
			PaymentMethod: t.PaymentMethod,
			PaidAt:        topUpPaidAt(t),
		})
		// 用 decimal 累加：float64 直接相加，¥0.01 这类小额多笔会累出
		// 255.49999999999997 这种尾数，印在收据上很难解释
		total = total.Add(decimal.NewFromFloat(t.Money))
	}

	user, err := model.GetUserById(owner, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	payerName := strings.TrimSpace(user.DisplayName)
	if payerName == "" {
		payerName = user.Username
	}

	common.ApiSuccess(c, &MergedReceipt{
		ReceiptNo:      mergedReceiptNo(owner, nos, items[len(items)-1].PaidAt),
		PayerName:      payerName,
		PayerEmail:     user.Email,
		Items:          items,
		TotalMoney:     total.InexactFloat64(),
		CurrencyCode:   code,
		CurrencySymbol: symbol,
		PeriodStart:    items[0].PaidAt,
		PeriodEnd:      items[len(items)-1].PaidAt,
		IssuedAt:       time.Now().Unix(),
		SiteName:       common.SystemName,
		SiteURL:        system_setting.ServerAddress,
	})
}
