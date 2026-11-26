// Package model — 用户自定义邀请码
//
// 每个用户有一个默认邀请码（users.aff_code，随机 4 位，不可改），另外最多可建 9 个自定义邀请码。
// 自定义码删除后链接立即失效，但码本身保留占位，别人不能再注册同名码接手旧链接；本人可以重新启用。
package model

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const AffInviteCodeMaxPerUser = 9

var affInviteCodePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{4,32}$`)

var (
	ErrInviteCodeInvalid = errors.New("邀请码需为 4~32 位字母、数字、下划线或连字符")
	ErrInviteCodeTaken   = errors.New("该邀请码已被占用，换一个试试")
	ErrInviteCodeLimit   = errors.New("最多只能创建 9 个自定义邀请码")
	ErrInviteCodeMissing = errors.New("邀请码不存在或已删除")
)

// affInviteCodesReady 表迁移完成后置位。新用户生成默认码时据此决定要不要避开自定义码
// （单测里没迁这张表，不置位就不查，免得在事务里报错）。
var affInviteCodesReady bool

// AffInviteCode 用户自定义邀请码。
type AffInviteCode struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"user_id" gorm:"index;not null"`
	Code      string `json:"code" gorm:"type:varchar(32);not null"`
	CodeKey   string `json:"-" gorm:"type:varchar(32);uniqueIndex;not null"` // 小写，大小写不敏感去重
	CreatedAt int64  `json:"created_at"`
	RemovedAt int64  `json:"removed_at" gorm:"index;default:0"` // 0 = 有效；删除只置时间，码继续占位
}

func (AffInviteCode) TableName() string {
	return "aff_invite_codes"
}

// ValidateCustomInviteCode 校验格式，返回去掉首尾空白后的码。
func ValidateCustomInviteCode(code string) (string, error) {
	code = strings.TrimSpace(code)
	if !affInviteCodePattern.MatchString(code) {
		return "", ErrInviteCodeInvalid
	}
	return code, nil
}

// ListUserInviteCodes 用户当前有效的自定义邀请码（按创建顺序）。
func ListUserInviteCodes(userId int) ([]AffInviteCode, error) {
	var codes []AffInviteCode
	err := DB.Where("user_id = ? AND removed_at = 0", userId).Order("id asc").Find(&codes).Error
	return codes, err
}

// CreateUserInviteCode 新建自定义邀请码。和所有默认码、所有自定义码（含已删除的）按大小写不敏感去重；
// 本人删掉过的码再建一次视为重新启用。
func CreateUserInviteCode(userId int, raw string) (*AffInviteCode, error) {
	code, err := ValidateCustomInviteCode(raw)
	if err != nil {
		return nil, err
	}
	key := strings.ToLower(code)
	var created AffInviteCode
	err = DB.Transaction(func(tx *gorm.DB) error {
		var owner User
		if err := lockForUpdate(tx).Select("id").First(&owner, "id = ?", userId).Error; err != nil {
			return err
		}
		var active int64
		if err := tx.Model(&AffInviteCode{}).Where("user_id = ? AND removed_at = 0", userId).Count(&active).Error; err != nil {
			return err
		}
		if active >= AffInviteCodeMaxPerUser {
			return ErrInviteCodeLimit
		}
		var clash int64
		if err := tx.Unscoped().Model(&User{}).Where("LOWER(aff_code) = ?", key).Count(&clash).Error; err != nil {
			return err
		}
		if clash > 0 {
			return ErrInviteCodeTaken
		}
		var existing AffInviteCode
		err := tx.Where("code_key = ?", key).First(&existing).Error
		switch {
		case err == nil:
			if existing.UserId != userId || existing.RemovedAt == 0 {
				return ErrInviteCodeTaken
			}
			now := time.Now().Unix()
			if err := tx.Model(&AffInviteCode{}).Where("id = ?", existing.Id).Updates(map[string]any{
				"code": code, "removed_at": 0, "created_at": now,
			}).Error; err != nil {
				return err
			}
			existing.Code, existing.RemovedAt, existing.CreatedAt = code, 0, now
			created = existing
			return nil
		case errors.Is(err, gorm.ErrRecordNotFound):
			created = AffInviteCode{UserId: userId, Code: code, CodeKey: key, CreatedAt: time.Now().Unix()}
			return tx.Create(&created).Error
		default:
			return err
		}
	})
	if err != nil {
		if !errors.Is(err, ErrInviteCodeLimit) && !errors.Is(err, ErrInviteCodeTaken) && isUniqueViolation(err) {
			return nil, ErrInviteCodeTaken // 并发抢同一个码
		}
		return nil, err
	}
	return &created, nil
}

// DeleteUserInviteCode 删除（停用）自己的自定义邀请码，对应链接立即失效。
func DeleteUserInviteCode(userId, codeId int) error {
	res := DB.Model(&AffInviteCode{}).
		Where("id = ? AND user_id = ? AND removed_at = 0", codeId, userId).
		Update("removed_at", time.Now().Unix())
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrInviteCodeMissing
	}
	return nil
}

// ResolveInviteCode 注册时把 ?aff= 解析成邀请人：先认默认码（原有行为），再认有效的自定义码。
// codeId 为 0 表示用的是默认码。找不到返回 (0, 0)。
func ResolveInviteCode(raw string) (inviterId int, codeId int) {
	code := strings.TrimSpace(raw)
	if code == "" {
		return 0, 0
	}
	if id, err := GetUserIdByAffCode(code); err == nil && id > 0 {
		return id, 0
	}
	if !affInviteCodePattern.MatchString(code) {
		return 0, 0
	}
	var c AffInviteCode
	if err := DB.Where("code_key = ? AND removed_at = 0", strings.ToLower(code)).First(&c).Error; err != nil {
		return 0, 0
	}
	var owner User
	if err := DB.Select("id").First(&owner, "id = ?", c.UserId).Error; err != nil {
		return 0, 0 // 邀请人已注销
	}
	return owner.Id, c.Id
}

// newUserAffCode 给新用户生成默认邀请码，避开已有的自定义码（含已删除占位的）和别人的默认码。
func newUserAffCode(tx *gorm.DB) string {
	code := common.GetRandomString(4)
	if !affInviteCodesReady || tx == nil {
		return code
	}
	for i := 0; i < 10; i++ {
		var n int64
		if err := tx.Model(&AffInviteCode{}).Where("code_key = ?", strings.ToLower(code)).Count(&n).Error; err != nil {
			return code
		}
		if n == 0 {
			if err := tx.Unscoped().Model(&User{}).Where("aff_code = ?", code).Count(&n).Error; err != nil || n == 0 {
				return code
			}
		}
		code = common.GetRandomString(4)
	}
	return code
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate")
}

// ---------- 邀请返利页统计 ----------

// InviteCodeStat 某个邀请码（0 = 默认码）带来的注册人数与返利额度（待到账 + 已到账）。
type InviteCodeStat struct {
	InviteCount int `json:"invite_count"`
	RebateQuota int `json:"rebate_quota"`
}

var affRebateCountedStatuses = []string{AffRebateStatusPending, AffRebateStatusReleased}

// GetInviteCodeStats 按邀请码汇总：key 为 users.invite_code_id（0 = 默认码 / 功能上线前的老邀请）。
func GetInviteCodeStats(inviterId int) (map[int]*InviteCodeStat, int, error) {
	stats := map[int]*InviteCodeStat{}
	ensure := func(id int) *InviteCodeStat {
		if stats[id] == nil {
			stats[id] = &InviteCodeStat{}
		}
		return stats[id]
	}
	var countRows []struct {
		InviteCodeId int
		N            int
	}
	if err := DB.Model(&User{}).Select("invite_code_id, COUNT(*) AS n").
		Where("inviter_id = ?", inviterId).Group("invite_code_id").Scan(&countRows).Error; err != nil {
		return nil, 0, err
	}
	total := 0
	for _, r := range countRows {
		ensure(r.InviteCodeId).InviteCount += r.N
		total += r.N
	}
	var rebateRows []struct {
		InviteCodeId int
		Quota        int64
	}
	if err := DB.Table("aff_rebates").
		Select("COALESCE(users.invite_code_id, 0) AS invite_code_id, COALESCE(SUM(aff_rebates.rebate_amount), 0) AS quota").
		Joins("LEFT JOIN users ON users.id = aff_rebates.invitee_id").
		Where("aff_rebates.inviter_id = ? AND aff_rebates.status IN ?", inviterId, affRebateCountedStatuses).
		Group("COALESCE(users.invite_code_id, 0)").Scan(&rebateRows).Error; err != nil {
		return nil, 0, err
	}
	for _, r := range rebateRows {
		ensure(r.InviteCodeId).RebateQuota += int(r.Quota)
	}
	return stats, total, nil
}

// InviteeRow 已邀请用户列表的一行（邮箱已脱敏）。
type InviteeRow struct {
	Id           int    `json:"-"`
	Email        string `json:"email"`
	Username     string `json:"username"`
	RebateQuota  int    `json:"rebate_quota"`
	RegisterTime int64  `json:"register_time"`
	InviteCode   string `json:"invite_code"` // 空 = 默认码
}

// ListInvitees 邀请人名下的被邀用户，新注册的在前。
func ListInvitees(inviterId, page, pageSize int) ([]InviteeRow, int64, error) {
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 10
	}
	if page <= 0 {
		page = 1
	}
	var total int64
	base := DB.Model(&User{}).Where("inviter_id = ?", inviterId)
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var users []User
	if err := DB.Model(&User{}).Select("id, username, email, register_time, created_at, invite_code_id").
		Where("inviter_id = ?", inviterId).Order("id desc").
		Limit(pageSize).Offset((page - 1) * pageSize).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	rows := make([]InviteeRow, 0, len(users))
	if len(users) == 0 {
		return rows, total, nil
	}
	ids := make([]int, 0, len(users))
	codeIds := make([]int, 0)
	for _, u := range users {
		ids = append(ids, u.Id)
		if u.InviteCodeId > 0 {
			codeIds = append(codeIds, u.InviteCodeId)
		}
	}
	var sums []struct {
		InviteeId int
		Quota     int64
	}
	if err := DB.Model(&AffRebate{}).Select("invitee_id, COALESCE(SUM(rebate_amount), 0) AS quota").
		Where("inviter_id = ? AND invitee_id IN ? AND status IN ?", inviterId, ids, affRebateCountedStatuses).
		Group("invitee_id").Scan(&sums).Error; err != nil {
		return nil, 0, err
	}
	quotaBy := make(map[int]int, len(sums))
	for _, s := range sums {
		quotaBy[s.InviteeId] = int(s.Quota)
	}
	codeBy := map[int]string{}
	if len(codeIds) > 0 {
		var codes []AffInviteCode
		if err := DB.Select("id, code").Where("id IN ?", codeIds).Find(&codes).Error; err == nil {
			for _, c := range codes {
				codeBy[c.Id] = c.Code
			}
		}
	}
	for _, u := range users {
		registered := u.RegisterTime
		if registered == 0 {
			registered = u.CreatedAt
		}
		rows = append(rows, InviteeRow{
			Id:           u.Id,
			Email:        MaskEmail(u.Email),
			Username:     u.Username,
			RebateQuota:  quotaBy[u.Id],
			RegisterTime: registered,
			InviteCode:   codeBy[u.InviteCodeId],
		})
	}
	return rows, total, nil
}

// MaskEmail q***@g***.com：本地部分和域名各留首字符，保留顶级域。
func MaskEmail(email string) string {
	email = strings.TrimSpace(email)
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 {
		return ""
	}
	local, domain := []rune(email[:at]), email[at+1:]
	masked := string(local[0]) + "***@"
	dot := strings.LastIndex(domain, ".")
	if dot <= 0 {
		return masked + string([]rune(domain)[0]) + "***"
	}
	return masked + string([]rune(domain)[0]) + "***" + domain[dot:]
}

var ErrNoAffQuotaToTransfer = errors.New("当前没有可转入额度")

// TransferAllAffQuotaToQuota 把可用返利额度（aff_quota）一次性全部转入余额，返回转入的额度。
// 和钱包页的按金额划转不同，这里不设 $1 起转门槛：2% 返利金额小，攒不到 $1 也要能用。
func TransferAllAffQuotaToQuota(userId int) (int, error) {
	moved := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var u User
		if err := lockForUpdate(tx).Select("id, aff_quota").First(&u, "id = ?", userId).Error; err != nil {
			return err
		}
		if u.AffQuota <= 0 {
			return ErrNoAffQuotaToTransfer
		}
		res := tx.Model(&User{}).Where("id = ? AND aff_quota = ?", userId, u.AffQuota).Updates(map[string]any{
			"aff_quota": gorm.Expr("aff_quota - ?", u.AffQuota),
			"quota":     gorm.Expr("quota + ?", u.AffQuota),
		})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errors.New("返利额度有变动，请刷新后重试")
		}
		moved = u.AffQuota
		return nil
	})
	if err != nil {
		return 0, err
	}
	if cacheErr := invalidateUserCache(userId); cacheErr != nil {
		common.SysLog("invalidate user cache after aff transfer failed: " + cacheErr.Error())
	}
	RecordLog(userId, LogTypeAffiliateRebate, common.NewMessage("返利额度 ${{amount}} 已转入余额", map[string]any{
		"amount": fmt.Sprintf("%.2f", float64(moved)/common.QuotaPerUnit),
	}))
	return moved, nil
}
