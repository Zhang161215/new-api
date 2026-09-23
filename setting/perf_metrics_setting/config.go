// Package perf_metrics_setting 模型广场性能采集的开关与参数（移植自上游 perf_metrics_setting）。
package perf_metrics_setting

import "github.com/QuantumNous/new-api/setting/config"

type PerfMetricsSetting struct {
	Enabled       bool `json:"enabled"`
	FlushInterval int  `json:"flush_interval"` // 分钟；每轮连当前小时桶一起落库，重启最多丢一个间隔
	RetentionDays int  `json:"retention_days"` // <=0 表示不清理
}

var perfMetricsSetting = PerfMetricsSetting{
	Enabled:       true,
	FlushInterval: 1,
	RetentionDays: 30,
}

func init() {
	config.GlobalConfig.Register("perf_metrics_setting", &perfMetricsSetting)
}

func GetSetting() PerfMetricsSetting {
	return perfMetricsSetting
}

func GetFlushIntervalMinutes() int {
	if perfMetricsSetting.FlushInterval < 1 {
		return 1
	}
	return perfMetricsSetting.FlushInterval
}
