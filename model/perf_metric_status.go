package model

// GetPerfMetricsSince 取某时刻以后的全部性能桶，供模型广场可用率状态（/api/pricing/status）使用。
func GetPerfMetricsSince(startTs int64) ([]PerfMetric, error) {
	var metrics []PerfMetric
	err := DB.Where("bucket_ts >= ?", startTs).Find(&metrics).Error
	return metrics, err
}
