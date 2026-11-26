package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func setupAffInviteTables(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&User{}, &AffInviteCode{}, &AffRebate{}, &Log{}))
	t.Cleanup(func() {
		DB.Exec("DELETE FROM aff_invite_codes")
		DB.Exec("DELETE FROM aff_rebates")
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})
}

func newAffTestUser(t *testing.T, name, affCode string, inviterId, codeId int) *User {
	t.Helper()
	u := &User{Username: name, Password: "x", Status: common.UserStatusEnabled, Role: common.RoleCommonUser,
		AffCode: affCode, InviterId: inviterId, InviteCodeId: codeId, Email: name + "@gmail.com"}
	require.NoError(t, DB.Create(u).Error)
	return u
}

func TestCustomInviteCodeLifecycle(t *testing.T) {
	setupAffInviteTables(t)
	alice := newAffTestUser(t, "alice", "AbCd", 0, 0)
	bob := newAffTestUser(t, "bob", "wxyz", 0, 0)

	// 格式
	for _, bad := range []string{"abc", "has space", "中文邀请码", "a.b.c.d", "x123456789012345678901234567890123"} {
		_, err := CreateUserInviteCode(alice.Id, bad)
		require.ErrorIs(t, err, ErrInviteCodeInvalid, bad)
	}
	// 和别人的默认码大小写不敏感冲突
	_, err := CreateUserInviteCode(alice.Id, "WXYZ")
	require.ErrorIs(t, err, ErrInviteCodeTaken)

	c1, err := CreateUserInviteCode(alice.Id, "  Alice_2026  ")
	require.NoError(t, err)
	require.Equal(t, "Alice_2026", c1.Code)
	_, err = CreateUserInviteCode(bob.Id, "alice_2026")
	require.ErrorIs(t, err, ErrInviteCodeTaken, "自定义码之间大小写不敏感去重")

	// 解析：默认码优先，其次自定义码（大小写不敏感）
	inviter, codeId := ResolveInviteCode("AbCd")
	require.Equal(t, alice.Id, inviter)
	require.Zero(t, codeId)
	inviter, codeId = ResolveInviteCode("ALICE_2026")
	require.Equal(t, alice.Id, inviter)
	require.Equal(t, c1.Id, codeId)
	inviter, _ = ResolveInviteCode("nope-code")
	require.Zero(t, inviter)

	// 删除后链接立即失效，别人也不能接手；本人可重新启用
	require.NoError(t, DeleteUserInviteCode(alice.Id, c1.Id))
	require.ErrorIs(t, DeleteUserInviteCode(alice.Id, c1.Id), ErrInviteCodeMissing)
	inviter, _ = ResolveInviteCode("Alice_2026")
	require.Zero(t, inviter)
	_, err = CreateUserInviteCode(bob.Id, "Alice_2026")
	require.ErrorIs(t, err, ErrInviteCodeTaken)
	again, err := CreateUserInviteCode(alice.Id, "alice_2026")
	require.NoError(t, err)
	require.Equal(t, c1.Id, again.Id)
	require.Equal(t, "alice_2026", again.Code)

	// 不能删别人的码
	require.ErrorIs(t, DeleteUserInviteCode(bob.Id, again.Id), ErrInviteCodeMissing)

	// 最多 9 个有效码
	for i := 2; i <= AffInviteCodeMaxPerUser; i++ {
		_, err := CreateUserInviteCode(alice.Id, fmt.Sprintf("alice-%02d", i))
		require.NoError(t, err)
	}
	_, err = CreateUserInviteCode(alice.Id, "alice-overflow")
	require.ErrorIs(t, err, ErrInviteCodeLimit)
	codes, err := ListUserInviteCodes(alice.Id)
	require.NoError(t, err)
	require.Len(t, codes, AffInviteCodeMaxPerUser)
}

func TestNewUserAffCodeAvoidsCustomCodes(t *testing.T) {
	setupAffInviteTables(t)
	owner := newAffTestUser(t, "owner", "own1", 0, 0)
	prev := affInviteCodesReady
	affInviteCodesReady = true
	t.Cleanup(func() { affInviteCodesReady = prev })
	// 所有 4 位随机码都撞不上是正常情况；这里只验证查询本身能跑、返回 4 位
	require.Len(t, newUserAffCode(DB), 4)
	c, err := CreateUserInviteCode(owner.Id, "zzzz")
	require.NoError(t, err)
	var n int64
	require.NoError(t, DB.Model(&AffInviteCode{}).Where("code_key = ?", "zzzz").Count(&n).Error)
	require.EqualValues(t, 1, n)
	require.NotZero(t, c.Id)
}

func TestInviteStatsAndInvitees(t *testing.T) {
	setupAffInviteTables(t)
	inviter := newAffTestUser(t, "inv", "inv1", 0, 0)
	code, err := CreateUserInviteCode(inviter.Id, "promo-x")
	require.NoError(t, err)
	a := newAffTestUser(t, "a", "aaa1", inviter.Id, 0)
	b := newAffTestUser(t, "b", "bbb1", inviter.Id, code.Id)
	_ = newAffTestUser(t, "c", "ccc1", inviter.Id, code.Id)

	mk := func(invitee, topUp, quota int, status string) {
		require.NoError(t, DB.Create(&AffRebate{InviterId: inviter.Id, InviteeId: invitee, TopUpId: topUp, RebateAmount: quota, Status: status}).Error)
	}
	mk(a.Id, 1, 100, AffRebateStatusReleased)
	mk(a.Id, 2, 50, AffRebateStatusPending)
	mk(b.Id, 3, 30, AffRebateStatusReleased)
	mk(b.Id, 4, 999, AffRebateStatusRevoked) // 撤销 / 同 IP 跳过的不计

	stats, total, err := GetInviteCodeStats(inviter.Id)
	require.NoError(t, err)
	require.Equal(t, 3, total)
	require.Equal(t, 1, stats[0].InviteCount)
	require.Equal(t, 150, stats[0].RebateQuota)
	require.Equal(t, 2, stats[code.Id].InviteCount)
	require.Equal(t, 30, stats[code.Id].RebateQuota)

	rows, n, err := ListInvitees(inviter.Id, 1, 10)
	require.NoError(t, err)
	require.EqualValues(t, 3, n)
	require.Len(t, rows, 3)
	require.Equal(t, "c", rows[0].Username, "新注册的在前")
	require.Equal(t, "promo-x", rows[0].InviteCode)
	require.Equal(t, "c***@g***.com", rows[0].Email)
	byName := map[string]InviteeRow{}
	for _, r := range rows {
		byName[r.Username] = r
	}
	require.Equal(t, 150, byName["a"].RebateQuota)
	require.Equal(t, "", byName["a"].InviteCode)
	require.Equal(t, 30, byName["b"].RebateQuota)
}

func TestMaskEmail(t *testing.T) {
	require.Equal(t, "q***@g***.com", MaskEmail("qwerty@gmail.com"))
	require.Equal(t, "5***@q***.com", MaskEmail("5566@qq.com"))
	require.Equal(t, "张***@e***.cn", MaskEmail("张三@example.com.cn"))
	require.Equal(t, "", MaskEmail(""))
	require.Equal(t, "", MaskEmail("not-an-email"))
	require.Equal(t, "a***@l***", MaskEmail("a@localhost"))
}

func TestTransferAllAffQuotaAndApproveSkipped(t *testing.T) {
	setupAffInviteTables(t)
	u := newAffTestUser(t, "tr", "trr1", 0, 0)
	_, err := TransferAllAffQuotaToQuota(u.Id)
	require.ErrorIs(t, err, ErrNoAffQuotaToTransfer)

	invitee := newAffTestUser(t, "tr-invitee", "tri1", u.Id, 0)
	skipped := &AffRebate{InviterId: u.Id, InviteeId: invitee.Id, TopUpId: 77, TopUpMoney: 10, RebateAmount: 1000, RebateMoney: 0.2}
	require.NoError(t, CreateSkippedAffRebate(skipped, AffRebateSkipSameIP, AffRebateSameIPReason, "9.9.9.9"))
	got, err := GetAffRebateById(skipped.Id)
	require.NoError(t, err)
	require.Equal(t, AffRebateStatusRevoked, got.Status)
	require.Equal(t, AffRebateSkipSameIP, got.SkipReason)
	var fresh User
	require.NoError(t, DB.First(&fresh, u.Id).Error)
	require.Zero(t, fresh.AffQuota, "跳过的记录不动额度")

	// 管理员撤销的记录不能走补发
	manual := &AffRebate{InviterId: u.Id, InviteeId: invitee.Id, TopUpId: 78, RebateAmount: 500, Status: AffRebateStatusRevoked}
	require.NoError(t, DB.Create(manual).Error)
	require.Error(t, ApproveSkippedAffRebateById(manual.Id, 1))

	require.NoError(t, ApproveSkippedAffRebateById(skipped.Id, 1))
	require.Error(t, ApproveSkippedAffRebateById(skipped.Id, 1), "补发只能一次")
	require.NoError(t, DB.First(&fresh, u.Id).Error)
	require.Equal(t, 1000, fresh.AffQuota)
	require.Equal(t, 1000, fresh.AffHistoryQuota)

	quotaBefore := fresh.Quota
	moved, err := TransferAllAffQuotaToQuota(u.Id)
	require.NoError(t, err)
	require.Equal(t, 1000, moved)
	require.NoError(t, DB.First(&fresh, u.Id).Error)
	require.Zero(t, fresh.AffQuota)
	require.Equal(t, quotaBefore+1000, fresh.Quota)

	// 补发后被管理员撤销的记录不能再补发（否则能绕回去）
	require.NoError(t, RevokeAffRebateById(skipped.Id, 1, "复核后确认是小号"))
	require.Error(t, ApproveSkippedAffRebateById(skipped.Id, 1))

	items, total, err := ListAffRebates(ListAffRebatesQuery{SkipReason: "any"}, 1, 20)
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Equal(t, skipped.Id, items[0].Id)
}

func TestInviteCodeSquatCap(t *testing.T) {
	setupAffInviteTables(t)
	u := newAffTestUser(t, "squat", "sq01", 0, 0)
	var last *AffInviteCode
	for i := 0; i < AffInviteCodeMaxRecordsPerUser; i++ {
		c, err := CreateUserInviteCode(u.Id, fmt.Sprintf("squat-%03d", i))
		require.NoError(t, err)
		require.NoError(t, DeleteUserInviteCode(u.Id, c.Id))
		last = c
	}
	_, err := CreateUserInviteCode(u.Id, "squat-new")
	require.ErrorIs(t, err, ErrInviteCodeQuota, "累计占位到上限后不能再建新码")
	again, err := CreateUserInviteCode(u.Id, last.Code)
	require.NoError(t, err, "重新启用自己删掉的码不受上限影响")
	require.Equal(t, last.Id, again.Id)
}

func TestIsUniqueViolation(t *testing.T) {
	require.True(t, isUniqueViolation(fmt.Errorf(`错误: 重复键违反唯一约束"idx_aff_invite_codes_code_key" (SQLSTATE 23505)`)))
	require.True(t, isUniqueViolation(fmt.Errorf("Error 1062 (23000): Duplicate entry 'x' for key 'idx'")))
	require.True(t, isUniqueViolation(fmt.Errorf("UNIQUE constraint failed: aff_invite_codes.code_key")))
	require.False(t, isUniqueViolation(fmt.Errorf("connection refused")))
}

func TestUserNetworkIPs(t *testing.T) {
	setupAffInviteTables(t)
	require.NoError(t, DB.AutoMigrate(&UserSession{}))
	t.Cleanup(func() { DB.Exec("DELETE FROM user_sessions") })
	u := newAffTestUser(t, "netips", "net1", 0, 0)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", u.Id).Update("register_ip", "1.2.3.4").Error)
	for i, ip := range []string{"5.6.7.8", "5.6.7.8", "", "2408:8207::1"} {
		require.NoError(t, DB.Create(&UserSession{SID: fmt.Sprintf("s-%d", i), UserID: u.Id, UserAuthVersion: 1, Status: "active",
			RefreshHash: fmt.Sprintf("%064d", i), LoginMethod: "password", IP: ip, LastActiveAt: 1, ExpiresAt: 2}).Error)
	}
	require.ElementsMatch(t, []string{"1.2.3.4", "5.6.7.8", "2408:8207::1"}, UserNetworkIPs(u.Id))
}
