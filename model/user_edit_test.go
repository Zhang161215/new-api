package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// newEditTestUser 建一个带额度、分组、备注的用户，便于验证「没提交的字段不该被动」
func newEditTestUser(t *testing.T) *User {
	t.Helper()
	u := &User{
		Username:    "edit-target",
		Password:    "hashed-placeholder",
		DisplayName: "原昵称",
		Group:       "default",
		Quota:       500000,
		Remark:      "原备注",
		ExpiredTime: -1,
	}
	require.NoError(t, DB.Create(u).Error)
	t.Cleanup(func() { DB.Unscoped().Where("id = ?", u.Id).Delete(&User{}) })
	return u
}

func fields(keys ...string) map[string]struct{} {
	out := make(map[string]struct{}, len(keys))
	for _, k := range keys {
		out[k] = struct{}{}
	}
	return out
}

// 回归用例：后台「只改分组」时前端不会提交 quota，
// 早先版本会把解码出的零值写库，导致用户余额被清空。
func TestUserEdit_GroupOnlyKeepsQuota(t *testing.T) {
	origin := newEditTestUser(t)

	// 模拟前端 payload：{id, username, display_name, remark, group}，无 quota
	edit := &User{
		Id:          origin.Id,
		Username:    origin.Username,
		DisplayName: origin.DisplayName,
		Remark:      origin.Remark,
		Group:       "vip",
		// Quota 未提交 → 解码为 0
	}
	require.NoError(t, edit.Edit(false, fields("id", "username", "display_name", "remark", "group")))

	var got User
	require.NoError(t, DB.First(&got, origin.Id).Error)
	require.Equal(t, "vip", got.Group, "分组应更新")
	require.Equal(t, 500000, got.Quota, "未提交 quota 时额度必须原样保留")
	require.Equal(t, "原备注", got.Remark)
	require.Equal(t, int64(-1), got.ExpiredTime, "未提交的过期时间不应被改写")
}

// 显式提交 quota 时仍要能改（含改成 0 这种合法清零）
func TestUserEdit_QuotaUpdatedWhenProvided(t *testing.T) {
	origin := newEditTestUser(t)

	edit := &User{Id: origin.Id, Quota: 123456}
	require.NoError(t, edit.Edit(false, fields("id", "quota")))
	var got User
	require.NoError(t, DB.First(&got, origin.Id).Error)
	require.Equal(t, 123456, got.Quota)

	// 管理员确实想清零时也要生效，不能被「保护零值」的逻辑挡掉
	zero := &User{Id: origin.Id, Quota: 0}
	require.NoError(t, zero.Edit(false, fields("id", "quota")))
	require.NoError(t, DB.First(&got, origin.Id).Error)
	require.Zero(t, got.Quota)
}

// 未提交的字段一律不动，避免用户名/分组被空值覆盖
func TestUserEdit_OmittedFieldsUntouched(t *testing.T) {
	origin := newEditTestUser(t)

	edit := &User{Id: origin.Id, Remark: "新备注"}
	require.NoError(t, edit.Edit(false, fields("id", "remark")))

	var got User
	require.NoError(t, DB.First(&got, origin.Id).Error)
	require.Equal(t, "新备注", got.Remark)
	require.Equal(t, "edit-target", got.Username, "用户名没提交就不该被清空")
	require.Equal(t, "default", got.Group, "分组没提交就不该被清空")
	require.Equal(t, "原昵称", got.DisplayName)
	require.Equal(t, 500000, got.Quota)
}

// 空集合意味着调用方没给字段清单，此时不应写任何业务字段
func TestUserEdit_NoProvidedFieldsIsNoop(t *testing.T) {
	origin := newEditTestUser(t)

	edit := &User{Id: origin.Id}
	require.NoError(t, edit.Edit(false, nil))

	var got User
	require.NoError(t, DB.First(&got, origin.Id).Error)
	require.Equal(t, "edit-target", got.Username)
	require.Equal(t, "default", got.Group)
	require.Equal(t, 500000, got.Quota)
	require.Equal(t, "原备注", got.Remark)
}

// 允许把可选文本字段显式改成空
func TestUserEdit_ExplicitEmptyStringApplies(t *testing.T) {
	origin := newEditTestUser(t)

	edit := &User{Id: origin.Id, Remark: ""}
	require.NoError(t, edit.Edit(false, fields("id", "remark")))

	var got User
	require.NoError(t, DB.First(&got, origin.Id).Error)
	require.Equal(t, "", got.Remark, "显式提交空备注应生效")
	require.Equal(t, 500000, got.Quota, "但不该波及未提交的额度")
}

// 改密码时同样只动提交过的字段
func TestUserEdit_PasswordUpdateKeepsOtherFields(t *testing.T) {
	origin := newEditTestUser(t)

	edit := &User{Id: origin.Id, Password: "new-password"}
	require.NoError(t, edit.Edit(true, fields("id", "password")))

	var got User
	require.NoError(t, DB.First(&got, origin.Id).Error)
	require.NotEqual(t, "hashed-placeholder", got.Password, "密码应已更新为新哈希")
	require.NotEqual(t, "new-password", got.Password, "且必须是哈希而非明文")
	require.Equal(t, 500000, got.Quota)
	require.Equal(t, "default", got.Group)
}

// EditableUserFields 的键必须与 Edit 内部取值的列名对得上，
// 否则会出现「提交了字段却没更新」或写错列的静默错误
func TestEditableUserFieldsMapping(t *testing.T) {
	for key, column := range EditableUserFields {
		require.Equal(t, key, column, "字段 %s 的 JSON 键与列名应一致", key)
	}
	for _, key := range []string{"username", "display_name", "group", "quota", "remark", "expired_time"} {
		_, ok := EditableUserFields[key]
		require.True(t, ok, "可编辑字段清单缺少 %s", key)
	}
}
