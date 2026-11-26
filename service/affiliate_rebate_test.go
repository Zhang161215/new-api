package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func setupAffRebateTest(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.AffRebate{}, &model.AffInviteCode{}))
	saved := []any{common.AffiliateRebateEnabled, common.AffiliateRebatePercent, common.AffiliateRebateEveryTopUp,
		common.AffiliateRebateMinThresholdUSD, common.AffiliateRebateBonusUSD, common.AffiliateRebateDelayDays,
		common.AffiliateRebateSameIPCheck, common.AffiliateRebateSharedIPs}
	common.AffiliateRebateEnabled = true
	common.AffiliateRebatePercent = 2
	common.AffiliateRebateEveryTopUp = true
	common.AffiliateRebateMinThresholdUSD = 0
	common.AffiliateRebateBonusUSD = 0
	common.AffiliateRebateDelayDays = 3
	common.AffiliateRebateSameIPCheck = true
	common.AffiliateRebateSharedIPs = "45.129.8.33, 10.8.0.0/16"
	t.Cleanup(func() {
		common.AffiliateRebateEnabled = saved[0].(bool)
		common.AffiliateRebatePercent = saved[1].(float64)
		common.AffiliateRebateEveryTopUp = saved[2].(bool)
		common.AffiliateRebateMinThresholdUSD = saved[3].(float64)
		common.AffiliateRebateBonusUSD = saved[4].(float64)
		common.AffiliateRebateDelayDays = saved[5].(int)
		common.AffiliateRebateSameIPCheck = saved[6].(bool)
		common.AffiliateRebateSharedIPs = saved[7].(string)
		model.DB.Exec("DELETE FROM aff_rebates")
		model.DB.Exec("DELETE FROM top_ups")
		model.DB.Exec("DELETE FROM users")
		model.DB.Exec("DELETE FROM logs")
	})
}

func affUser(t *testing.T, name, ip string, inviterId int) *model.User {
	t.Helper()
	u := &model.User{Username: name, Password: "x", AffCode: name, InviterId: inviterId, RegisterIP: ip,
		Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	require.NoError(t, model.DB.Create(u).Error)
	return u
}

func affTopUp(t *testing.T, userId int, money float64) *model.TopUp {
	t.Helper()
	tu := &model.TopUp{UserId: userId, Amount: int64(money), Money: money, TradeNo: common.GetRandomString(12),
		Status: common.TopUpStatusSuccess, PaymentMethod: "alipay"}
	require.NoError(t, model.DB.Create(tu).Error)
	require.NoError(t, TriggerAffiliateRebate(tu))
	return tu
}

func pendingOf(t *testing.T, userId int) int {
	t.Helper()
	var u model.User
	require.NoError(t, model.DB.Select("aff_pending_quota").First(&u, userId).Error)
	return u.AffPendingQuota
}

func TestAffiliateRebateEveryTopUpTwoPercent(t *testing.T) {
	setupAffRebateTest(t)
	inviter := affUser(t, "inv-a", "1.2.3.4", 0)
	invitee := affUser(t, "ee-a", "5.6.7.8", inviter.Id)

	first := affTopUp(t, invitee.Id, 10)
	affTopUp(t, invitee.Id, 100)
	require.NoError(t, TriggerAffiliateRebate(first), "重复回调不重复返利")

	var rows []model.AffRebate
	require.NoError(t, model.DB.Where("inviter_id = ?", inviter.Id).Order("id").Find(&rows).Error)
	require.Len(t, rows, 2, "每笔充值都返利")
	require.InDelta(t, 0.2, rows[0].RebateMoney, 1e-9)
	require.InDelta(t, 2.0, rows[1].RebateMoney, 1e-9)
	require.Equal(t, model.AffRebateStatusPending, rows[1].Status)
	want := int(0.2*common.QuotaPerUnit) + int(2*common.QuotaPerUnit)
	require.Equal(t, want, pendingOf(t, inviter.Id))
}

func TestAffiliateRebateFirstOnlyModeKeepsBonus(t *testing.T) {
	setupAffRebateTest(t)
	common.AffiliateRebateEveryTopUp = false
	common.AffiliateRebatePercent = 10
	common.AffiliateRebateMinThresholdUSD = 2
	common.AffiliateRebateBonusUSD = 2
	inviter := affUser(t, "inv-f", "1.2.3.4", 0)
	invitee := affUser(t, "ee-f", "5.6.7.8", inviter.Id)
	affTopUp(t, invitee.Id, 10)
	affTopUp(t, invitee.Id, 100)
	var rows []model.AffRebate
	require.NoError(t, model.DB.Where("inviter_id = ?", inviter.Id).Find(&rows).Error)
	require.Len(t, rows, 1, "首充模式只返第一笔")
	require.InDelta(t, 3.0, rows[0].RebateMoney, 1e-9, "10% 不足 $2 时加 $2")
}

func TestAffiliateRebateSameIPSkipped(t *testing.T) {
	setupAffRebateTest(t)
	inviter := affUser(t, "inv-ip", "8.8.4.4", 0)
	same := affUser(t, "ee-same", " 8.8.4.4 ", inviter.Id)
	v6a := affUser(t, "inv-v6", "2408:8207:1:2:aaaa::1", 0)
	v6b := affUser(t, "ee-v6", "2408:8207:1:2:bbbb::9", v6a.Id)
	shared := affUser(t, "inv-jp", "45.129.8.33", 0)
	viaLine := affUser(t, "ee-jp", "45.129.8.33", shared.Id)
	cidrInv := affUser(t, "inv-cidr", "10.8.3.4", 0)
	cidrEe := affUser(t, "ee-cidr", "10.8.3.4", cidrInv.Id)
	noIP := affUser(t, "inv-noip", "", 0)
	noIPEe := affUser(t, "ee-noip", "", noIP.Id)

	affTopUp(t, same.Id, 50)
	affTopUp(t, v6b.Id, 50)
	affTopUp(t, viaLine.Id, 50)
	affTopUp(t, cidrEe.Id, 50)
	affTopUp(t, noIPEe.Id, 50)

	check := func(inviterId int, wantStatus string, wantPending int) {
		t.Helper()
		var r model.AffRebate
		require.NoError(t, model.DB.Where("inviter_id = ?", inviterId).First(&r).Error)
		require.Equal(t, wantStatus, r.Status)
		require.Equal(t, wantPending, pendingOf(t, inviterId))
		if wantStatus == model.AffRebateStatusRevoked {
			require.Equal(t, model.AffRebateSkipSameIP, r.SkipReason)
			require.Equal(t, model.AffRebateSameIPReason, r.RevokeReason)
			require.Zero(t, r.ReleaseAt)
		}
	}
	oneQuota := int(1 * common.QuotaPerUnit)
	check(inviter.Id, model.AffRebateStatusRevoked, 0)
	check(v6a.Id, model.AffRebateStatusRevoked, 0) // IPv6 同 /64
	check(shared.Id, model.AffRebateStatusPending, oneQuota)
	check(cidrInv.Id, model.AffRebateStatusPending, oneQuota)
	check(noIP.Id, model.AffRebateStatusPending, oneQuota) // 空 IP 不算同 IP

	// 关掉同 IP 判断后正常返利
	common.AffiliateRebateSameIPCheck = false
	affTopUp(t, same.Id, 50)
	require.Equal(t, oneQuota, pendingOf(t, inviter.Id))
}

func TestSameRegisterNetwork(t *testing.T) {
	require.True(t, sameRegisterNetwork("1.1.1.1", "1.1.1.1"))
	require.False(t, sameRegisterNetwork("1.1.1.1", "1.1.1.2"))
	require.False(t, sameRegisterNetwork("", ""))
	require.False(t, sameRegisterNetwork("bad", "bad"))
	require.True(t, sameRegisterNetwork("::ffff:1.1.1.1", "1.1.1.1"))
	require.False(t, sameRegisterNetwork("2408:8207:1:2::1", "2408:8207:1:3::1"))
	require.True(t, isSharedEgressIP("45.129.8.33", "1.1.1.1\n45.129.8.33"))
	require.True(t, isSharedEgressIP("10.8.9.9", "10.8.0.0/16；"))
	require.False(t, isSharedEgressIP("10.9.0.1", "10.8.0.0/16"))
}

func TestAffiliateRebateLoginIPOverlapSkipped(t *testing.T) {
	setupAffRebateTest(t)
	ips := map[int][]string{}
	prev := userNetworkIPs
	userNetworkIPs = func(id int) []string { return ips[id] }
	t.Cleanup(func() { userNetworkIPs = prev })

	inviter := affUser(t, "inv-login", "1.1.1.1", 0)
	alt := affUser(t, "ee-login", "2.2.2.2", inviter.Id)
	friend := affUser(t, "ee-friend", "3.3.3.3", inviter.Id)
	viaLine := affUser(t, "ee-line", "4.4.4.4", inviter.Id)
	ips[inviter.Id] = []string{"1.1.1.1", "9.9.9.9", "45.129.8.33"}
	ips[alt.Id] = []string{"2.2.2.2", "9.9.9.9"}         // 注册换了 IP，但登录 IP 和邀请人一样
	ips[friend.Id] = []string{"3.3.3.3"}                 // 真实好友
	ips[viaLine.Id] = []string{"4.4.4.4", "45.129.8.33"} // 只在共享出口上重合

	affTopUp(t, alt.Id, 50)
	affTopUp(t, friend.Id, 50)
	affTopUp(t, viaLine.Id, 50)
	status := func(invitee int) (string, string) {
		var r model.AffRebate
		require.NoError(t, model.DB.Where("invitee_id = ?", invitee).First(&r).Error)
		return r.Status, r.SkipIP
	}
	st, hit := status(alt.Id)
	require.Equal(t, model.AffRebateStatusRevoked, st)
	require.Equal(t, "9.9.9.9", hit)
	st, _ = status(friend.Id)
	require.Equal(t, model.AffRebateStatusPending, st)
	st, _ = status(viaLine.Id)
	require.Equal(t, model.AffRebateStatusPending, st, "共享出口上的重合不算")
}
