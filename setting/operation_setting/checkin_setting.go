package operation_setting

import (
	"time"

	"github.com/QuantumNous/new-api/setting/config"
)

// CheckinSetting 签到功能配置
type CheckinSetting struct {
	Enabled bool `json:"enabled"` // 是否启用签到功能
	// MinQuota/MaxQuota 存的是 quota 而非金额。后台界面按 QuotaPerUnit 换算成
	// 金额展示与输入，底层保持 quota —— 换字段名会让线上已配置的值失效并静默
	// 回落到默认值（250000 → 1000，差 250 倍），且要等用户投诉才会发现。
	MinQuota       int     `json:"min_quota"`        // 签到最小额度奖励
	MaxQuota       int     `json:"max_quota"`        // 签到最大额度奖励
	MinTopUpAmount float64 `json:"min_topup_amount"` // 签到最低累计充值金额(元)，0 表示不限制

	// DoubleWeekdays 是额度翻倍的星期，取值 0=周日 … 6=周六，与 time.Weekday 对齐。
	// 空列表表示不开启翻倍。
	DoubleWeekdays []int `json:"double_weekdays"`
	// DoubleMultiplier 为翻倍倍数，<=1 时视为不翻倍。
	DoubleMultiplier float64 `json:"double_multiplier"`
}

// 默认配置
var checkinSetting = CheckinSetting{
	Enabled:          false, // 默认关闭
	MinQuota:         1000,  // 默认最小额度 1000 (约 0.002 USD)
	MaxQuota:         10000, // 默认最大额度 10000 (约 0.02 USD)
	MinTopUpAmount:   0,     // 默认不限制
	DoubleWeekdays:   []int{},
	DoubleMultiplier: 2,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("checkin_setting", &checkinSetting)
}

// GetCheckinSetting 获取签到配置
func GetCheckinSetting() *CheckinSetting {
	return &checkinSetting
}

// IsCheckinEnabled 是否启用签到功能
func IsCheckinEnabled() bool {
	return checkinSetting.Enabled
}

// GetCheckinQuotaRange 获取签到额度范围
func GetCheckinQuotaRange() (min, max int) {
	return checkinSetting.MinQuota, checkinSetting.MaxQuota
}

// CheckinMultiplierFor 返回 t 所在星期应套用的签到额度倍数，非翻倍日返回 1。
//
// 发放额度的 model 层与下发提示的 controller 层共用这一处判断，避免两边各写
// 一份规则后走偏 —— 用户端显示「今日双倍」而实际没翻倍是最难查的那类 bug。
//
// 星期以传入时间的时区为准。生产容器 TZ=Asia/Shanghai，调用方须传入与
// CheckinDate 同一个时钟取的时间，否则跨零点会出现「按周日算倍数、日期却记成周一」。
func CheckinMultiplierFor(t time.Time) float64 {
	if checkinSetting.DoubleMultiplier <= 1 || len(checkinSetting.DoubleWeekdays) == 0 {
		return 1
	}
	today := int(t.Weekday()) // 0=周日 … 6=周六
	for _, wd := range checkinSetting.DoubleWeekdays {
		if wd == today {
			return checkinSetting.DoubleMultiplier
		}
	}
	return 1
}
