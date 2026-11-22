package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
)

func TestPaymentReturnPathUsesDefaultDashboardRoutes(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	previousTheme := common.GetTheme()
	system_setting.ServerAddress = "https://dashboard.example.com/"
	common.SetTheme("default")
	t.Cleanup(func() {
		system_setting.ServerAddress = previousAddress
		common.SetTheme(previousTheme)
	})

	assert.Equal(
		t,
		"https://dashboard.example.com/wallet?pay=success",
		paymentReturnPath("/wallet?pay=success"),
	)
	assert.Equal(
		t,
		"https://dashboard.example.com/usage-logs",
		paymentReturnPath("/usage-logs"),
	)
}

// 本站默认 classic 主题：上游写的新版路由要改写成 classic 页面。
func TestPaymentReturnPathMapsToClassicRoutes(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	previousTheme := common.GetTheme()
	system_setting.ServerAddress = "https://dashboard.example.com/"
	common.SetTheme("classic")
	t.Cleanup(func() {
		system_setting.ServerAddress = previousAddress
		common.SetTheme(previousTheme)
	})

	assert.Equal(t, "https://dashboard.example.com/console/topup?pay=success", paymentReturnPath("/wallet?pay=success"))
	assert.Equal(t, "https://dashboard.example.com/console/topup", paymentReturnPath("/wallet"))
	assert.Equal(t, "https://dashboard.example.com/console/log", paymentReturnPath("/usage-logs"))
	assert.Equal(t, "https://dashboard.example.com/console/personal", paymentReturnPath("/profile"))
	assert.Equal(t, "https://dashboard.example.com/wallets", paymentReturnPath("/wallets"))
}
