package common

func GetTrustQuota() int {
	return int(5 * QuotaPerUnit)
}
