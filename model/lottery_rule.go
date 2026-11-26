package model

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// 支付送抽奖次数的规则。金额一律按「单笔实付、折成人民币」算，不跨单累计。
const (
	// LotteryGrantModePerPayment 按笔固定：每笔送 TicketsPerPayment 次；MinPayAmount > 0 时单笔实付不足不送。
	LotteryGrantModePerPayment = "per_payment"
	// LotteryGrantModeTiers 金额阶梯：取命中的最高一档发放，不叠加；低于最低档不送。
	LotteryGrantModeTiers = "tiers"
	// LotteryGrantModePerAmount 每满金额：floor(实付 / StepAmount) × StepTickets，单笔封顶 MaxTicketsPerPayment。
	LotteryGrantModePerAmount = "per_amount"

	lotteryMaxTicketsPerGrant    = 100
	lotteryMaxAmountTiers        = 10
	lotteryMaxRuleAmount         = 1000000.0
	lotteryDefaultPerAmountCap   = 20
	lotteryDefaultPerAmountStep  = 10.0
	lotteryDefaultPerAmountGrant = 1
	// lotteryMaxGrantWindowHours 防刷窗口最长 30 天。
	lotteryMaxGrantWindowHours = 720
)

type LotteryAmountTier struct {
	MinAmount float64 `json:"min_amount"`
	Tickets   int     `json:"tickets"`
}

// LotteryGrantRule 嵌入 LotteryConfig，列名与字段一一对应（tickets_per_payment 沿用旧列）。
// 新列不带 gorm default，旧库加列后为空值，由 normalize 统一兜成默认。
type LotteryGrantRule struct {
	GrantMode            string              `json:"grant_mode" gorm:"type:varchar(16)"`
	TicketsPerPayment    int                 `json:"tickets_per_payment" gorm:"default:1"`
	MinPayAmount         float64             `json:"min_pay_amount"`
	AmountTiers          []LotteryAmountTier `json:"amount_tiers" gorm:"-"`
	StepAmount           float64             `json:"step_amount"`
	StepTickets          int                 `json:"step_tickets"`
	MaxTicketsPerPayment int                 `json:"max_tickets_per_payment"`
	// GrantWindowHours 防刷窗口（小时，0 = 不限）：同一用户在窗口内靠支付拿到的次数合计，
	// 不超过窗口内单笔能拿到的最高一档。连续充小额只送一次；之后充更多只补差额。对所有发放方式生效。
	GrantWindowHours int `json:"grant_window_hours"`
}

func lotteryAmountCents(v float64) int64 {
	if v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return int64(math.Round(v * 100))
}

func lotteryRoundAmount(v float64) float64 {
	return float64(lotteryAmountCents(v)) / 100
}

func clampLotteryTickets(n, fallback int) int {
	if n < 1 {
		n = fallback
	}
	if n > lotteryMaxTicketsPerGrant {
		n = lotteryMaxTicketsPerGrant
	}
	return n
}

// normalize 把空值/越界值兜成可用默认，不报错；用于读库和非当前模式的字段。
func (r *LotteryGrantRule) normalize() {
	switch r.GrantMode {
	case LotteryGrantModePerPayment, LotteryGrantModeTiers, LotteryGrantModePerAmount:
	default:
		r.GrantMode = LotteryGrantModePerPayment
	}
	r.TicketsPerPayment = clampLotteryTickets(r.TicketsPerPayment, 1)
	r.MinPayAmount = lotteryRoundAmount(math.Min(r.MinPayAmount, lotteryMaxRuleAmount))
	r.StepAmount = lotteryRoundAmount(math.Min(r.StepAmount, lotteryMaxRuleAmount))
	if r.StepAmount <= 0 {
		r.StepAmount = lotteryDefaultPerAmountStep
	}
	r.StepTickets = clampLotteryTickets(r.StepTickets, lotteryDefaultPerAmountGrant)
	r.MaxTicketsPerPayment = clampLotteryTickets(r.MaxTicketsPerPayment, lotteryDefaultPerAmountCap)
	r.GrantWindowHours = min(max(r.GrantWindowHours, 0), lotteryMaxGrantWindowHours)

	seen := make(map[int64]bool, len(r.AmountTiers))
	tiers := make([]LotteryAmountTier, 0, len(r.AmountTiers))
	for _, t := range r.AmountTiers {
		cents := lotteryAmountCents(math.Min(t.MinAmount, lotteryMaxRuleAmount))
		if cents <= 0 || t.Tickets < 1 || seen[cents] {
			continue
		}
		seen[cents] = true
		tiers = append(tiers, LotteryAmountTier{MinAmount: float64(cents) / 100, Tickets: clampLotteryTickets(t.Tickets, 1)})
	}
	sort.Slice(tiers, func(i, j int) bool { return tiers[i].MinAmount < tiers[j].MinAmount })
	if len(tiers) > lotteryMaxAmountTiers {
		tiers = tiers[:lotteryMaxAmountTiers]
	}
	r.AmountTiers = tiers
}

// Validate 严格校验管理员提交的规则：当前模式的字段必须合法，其余模式字段只做兜底。
func (r *LotteryGrantRule) Validate() error {
	mode := strings.TrimSpace(r.GrantMode)
	switch mode {
	case LotteryGrantModePerPayment:
		if r.TicketsPerPayment < 1 || r.TicketsPerPayment > lotteryMaxTicketsPerGrant {
			return fmt.Errorf("每笔发放次数要在 1–%d 之间", lotteryMaxTicketsPerGrant)
		}
		if r.MinPayAmount < 0 || r.MinPayAmount > lotteryMaxRuleAmount {
			return errors.New("起送金额要在 0–1000000 元之间")
		}
	case LotteryGrantModeTiers:
		if len(r.AmountTiers) == 0 {
			return errors.New("金额阶梯至少要有一档")
		}
		if len(r.AmountTiers) > lotteryMaxAmountTiers {
			return fmt.Errorf("金额阶梯最多 %d 档", lotteryMaxAmountTiers)
		}
		seen := make(map[int64]bool, len(r.AmountTiers))
		for _, t := range r.AmountTiers {
			cents := lotteryAmountCents(t.MinAmount)
			if cents <= 0 || t.MinAmount > lotteryMaxRuleAmount {
				return errors.New("每档金额要大于 0")
			}
			if t.Tickets < 1 || t.Tickets > lotteryMaxTicketsPerGrant {
				return fmt.Errorf("每档次数要在 1–%d 之间", lotteryMaxTicketsPerGrant)
			}
			if seen[cents] {
				return fmt.Errorf("金额阶梯里 %.2f 元出现了两次", float64(cents)/100)
			}
			seen[cents] = true
		}
	case LotteryGrantModePerAmount:
		if lotteryAmountCents(r.StepAmount) <= 0 || r.StepAmount > lotteryMaxRuleAmount {
			return errors.New("「每满」金额要大于 0")
		}
		if r.StepTickets < 1 || r.StepTickets > lotteryMaxTicketsPerGrant {
			return fmt.Errorf("每满一次发放次数要在 1–%d 之间", lotteryMaxTicketsPerGrant)
		}
		if r.MaxTicketsPerPayment < 1 || r.MaxTicketsPerPayment > lotteryMaxTicketsPerGrant {
			return fmt.Errorf("单笔封顶要在 1–%d 之间", lotteryMaxTicketsPerGrant)
		}
	default:
		return errors.New("未知的发放方式")
	}
	if r.GrantWindowHours < 0 || r.GrantWindowHours > lotteryMaxGrantWindowHours {
		return fmt.Errorf("限制时长要在 0–%d 小时之间", lotteryMaxGrantWindowHours)
	}
	r.GrantMode = mode
	r.normalize()
	return nil
}

// TicketsForAmount 按规则算单笔实付（人民币）应发次数；0 表示不发。
func (r LotteryGrantRule) TicketsForAmount(amountCNY float64) int {
	r.normalize()
	cents := lotteryAmountCents(amountCNY)
	switch r.GrantMode {
	case LotteryGrantModeTiers:
		n := 0
		for _, t := range r.AmountTiers {
			if cents >= lotteryAmountCents(t.MinAmount) {
				n = t.Tickets
			}
		}
		return n
	case LotteryGrantModePerAmount:
		step := lotteryAmountCents(r.StepAmount)
		if step <= 0 {
			return 0
		}
		n := (cents / step) * int64(r.StepTickets)
		if limit := int64(r.MaxTicketsPerPayment); n > limit {
			n = limit
		}
		return int(n)
	default:
		if r.MinPayAmount > 0 && cents < lotteryAmountCents(r.MinPayAmount) {
			return 0
		}
		return r.TicketsPerPayment
	}
}

// LotteryPaidAmountCNY 把订单实付折成人民币，币种口径与收据一致：
// 易支付系（alipay/wxpay/custom）收人民币；stripe/creem/offline/usdt 记美元；waffo 看配置。
// 其他币种无汇率可用，按原数算。
func LotteryPaidAmountCNY(money float64, paymentMethod string) float64 {
	if money <= 0 {
		return 0
	}
	usd := false
	switch strings.ToLower(strings.TrimSpace(paymentMethod)) {
	case "stripe", "creem", "offline", "usdt":
		usd = true
	case "waffo":
		usd = strings.EqualFold(strings.TrimSpace(setting.WaffoCurrency), "USD")
	}
	if !usd {
		return money
	}
	rate := operation_setting.USDExchangeRate
	if rate <= 0 {
		rate = 7.3
	}
	return money * rate
}

func (c *LotteryConfig) BeforeSave(tx *gorm.DB) error {
	if len(c.AmountTiers) == 0 {
		c.AmountTiersRaw = ""
		return nil
	}
	raw, err := common.Marshal(c.AmountTiers)
	if err != nil {
		return err
	}
	c.AmountTiersRaw = string(raw)
	return nil
}

func (c *LotteryConfig) AfterFind(tx *gorm.DB) error {
	c.AmountTiers = nil
	if strings.TrimSpace(c.AmountTiersRaw) != "" {
		var tiers []LotteryAmountTier
		if err := common.UnmarshalJsonStr(c.AmountTiersRaw, &tiers); err == nil {
			c.AmountTiers = tiers
		}
	}
	c.LotteryGrantRule.normalize()
	return nil
}
