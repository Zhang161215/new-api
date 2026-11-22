package model

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const UserNameMaxLength = 20

var userSortColumns = map[string]string{
	"id":            "id",
	"username":      "username",
	"quota":         "quota",
	"group":         "group",
	"created_at":    "created_at",
	"last_login_at": "last_login_at",
}

type UserSortOptions struct {
	SortBy    string
	SortOrder string
}

func NewUserSortOptions(sortBy string, sortOrder string) UserSortOptions {
	normalizedSortBy := strings.ToLower(strings.TrimSpace(sortBy))
	normalizedSortOrder := strings.ToLower(strings.TrimSpace(sortOrder))
	if _, ok := userSortColumns[normalizedSortBy]; !ok {
		normalizedSortBy = "id"
		normalizedSortOrder = "desc"
	} else if normalizedSortOrder != "asc" {
		normalizedSortOrder = "desc"
	}

	return UserSortOptions{
		SortBy:    normalizedSortBy,
		SortOrder: normalizedSortOrder,
	}
}

func (options UserSortOptions) Apply(query *gorm.DB) *gorm.DB {
	columnName, ok := userSortColumns[options.SortBy]
	if !ok {
		columnName = "id"
	}
	q := query.Order(clause.OrderByColumn{
		Column: clause.Column{Name: columnName},
		Desc:   options.SortOrder != "asc",
	})
	if columnName != "id" {
		q = q.Order(clause.OrderByColumn{
			Column: clause.Column{Name: "id"},
			Desc:   true,
		})
	}
	return q
}

func resolveUserSortOptions(sortOptions []UserSortOptions) UserSortOptions {
	if len(sortOptions) == 0 {
		return NewUserSortOptions("", "")
	}
	return sortOptions[0]
}

// User if you add sensitive fields, don't forget to clean them in setupLogin function.
// Otherwise, the sensitive information will be saved on local storage in plain text!
type User struct {
	Id                    int                        `json:"id"`
	Username              string                     `json:"username" gorm:"unique;index" validate:"max=20"`
	Password              string                     `json:"password" gorm:"not null;" validate:"min=8,max=20"`
	OriginalPassword      string                     `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName           string                     `json:"display_name" gorm:"index" validate:"max=20"`
	Role                  int                        `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status                int                        `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email                 string                     `json:"email" gorm:"index" validate:"max=50"`
	GitHubId              string                     `json:"github_id" gorm:"column:github_id;index"`
	DiscordId             string                     `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId                string                     `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId              string                     `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId            string                     `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode      string                     `json:"verification_code" gorm:"-:all"`                         // this field is only for Email verification, don't save it to database!
	AccessToken           *string                    `json:"-" gorm:"type:char(32);column:access_token;uniqueIndex"` // this token is for system management
	Quota                 int                        `json:"quota" gorm:"type:int;default:0"`
	UsedQuota             int                        `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount          int                        `json:"request_count" gorm:"type:int;default:0;"`               // request number
	Group                 string                     `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode               string                     `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount              int                        `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota              int                        `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`                 // 邀请剩余额度
	AffPendingQuota       int                        `json:"aff_pending_quota" gorm:"type:int;default:0;column:aff_pending_quota"` // 邀请待到账额度
	AffHistoryQuota       int                        `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"`       // 邀请历史额度
	InviterId             int                        `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	RegisterIP            string                     `json:"register_ip,omitempty" gorm:"type:varchar(64);column:register_ip;index"`
	RegisterTime          int64                      `json:"register_time" gorm:"bigint;column:register_time;index"`
	InvitedTotal          int                        `json:"invited_total,omitempty" gorm:"-:all"`
	InvitedPaidCount      int                        `json:"invited_paid_count,omitempty" gorm:"-:all"`
	InviteSuspiciousCount int                        `json:"invite_suspicious_count,omitempty" gorm:"-:all"`
	InvitePaidAmount      float64                    `json:"invite_paid_amount,omitempty" gorm:"-:all"`
	InviteConversionRate  float64                    `json:"invite_conversion_rate,omitempty" gorm:"-:all"`
	DeletedAt             gorm.DeletedAt             `gorm:"index"`
	LinuxDOId             string                     `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	Setting               string                     `json:"setting" gorm:"type:text;column:setting"`
	Remark                string                     `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer        string                     `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	CreatedAt             int64                      `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	LastLoginAt           int64                      `json:"last_login_at" gorm:"default:0;column:last_login_at"`
	AuthVersion           int64                      `json:"-" gorm:"type:bigint;not null;default:1;column:auth_version"`
	AdminPermissions      map[string]map[string]bool `json:"admin_permissions,omitempty" gorm:"-:all"`
}

func (user *User) ToBaseUser() *UserBase {
	cache := &UserBase{
		Id:          user.Id,
		Group:       user.Group,
		Quota:       user.Quota,
		Status:      user.Status,
		Role:        user.Role,
		Username:    user.Username,
		Setting:     user.Setting,
		Email:       user.Email,
		AuthVersion: user.AuthVersion,
		CacheSchema: userCacheSchemaVersion,
	}
	return cache
}

func (user *User) GetAccessToken() string {
	if user.AccessToken == nil {
		return ""
	}
	return *user.AccessToken
}

func (user *User) SetAccessToken(token string) {
	user.AccessToken = &token
}

// UpdateUserAccessToken rotates a dashboard personal access token without
// writing a stale user snapshot back over concurrently updated fields.
func UpdateUserAccessToken(id int, token string) error {
	if id == 0 {
		return errors.New("id 为空！")
	}
	result := DB.Model(&User{}).Where("id = ?", id).Update("access_token", token)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (user *User) GetSetting() dto.UserSetting {
	setting := dto.UserSetting{}
	if user.Setting != "" {
		err := common.Unmarshal([]byte(user.Setting), &setting)
		if err != nil {
			common.SysLog("failed to unmarshal setting: " + err.Error())
		}
	}
	return setting
}

func (user *User) SetSetting(setting dto.UserSetting) {
	settingBytes, err := common.Marshal(setting)
	if err != nil {
		common.SysLog("failed to marshal setting: " + err.Error())
		return
	}
	user.Setting = string(settingBytes)
}

func UpdateUserSetting(userId int, setting dto.UserSetting) error {
	if userId == 0 {
		return errors.New("id 为空！")
	}
	settingBytes, err := common.Marshal(setting)
	if err != nil {
		return err
	}
	settingValue := string(settingBytes)
	if err = DB.Model(&User{}).Where("id = ?", userId).Update("setting", settingValue).Error; err != nil {
		return err
	}
	return updateUserSettingCache(userId, settingValue)
}

// userBindColumns 允许通过 UpdateUserBindColumn 更新的第三方账号绑定列白名单。
// 列名只可能来自代码内部的 provider 实现，白名单是防御纵深，不依赖调用方自律。
var userBindColumns = map[string]bool{
	"github_id":   true,
	"discord_id":  true,
	"oidc_id":     true,
	"linux_do_id": true,
	"wechat_id":   true,
}

// UpdateUserBindColumn 第三方账号绑定字段的专用更新。
// 绑定操作必须只写绑定列：若改为“读取完整用户 → 改一个字段 → 整体更新”，
// 读快照期间并发发生的封禁、降权或分组变更会被旧快照覆盖恢复。
// 角色、状态、分组只允许通过各自带锁/CAS 的专用方法修改。
func UpdateUserBindColumn(userId int, column string, value string) error {
	if userId <= 0 {
		return errors.New("id 为空！")
	}
	if !userBindColumns[column] {
		return fmt.Errorf("invalid user bind column: %s", column)
	}
	return DB.Model(&User{}).Where("id = ?", userId).Update(column, value).Error
}

// 根据用户角色生成默认的边栏配置
func generateDefaultSidebarConfigForRole(userRole int) string {
	defaultConfig := map[string]interface{}{}

	// 聊天区域 - 所有用户都可以访问
	defaultConfig["chat"] = map[string]interface{}{
		"enabled":    true,
		"playground": true,
		"chat":       true,
	}

	// 控制台区域 - 所有用户都可以访问
	defaultConfig["console"] = map[string]interface{}{
		"enabled":    true,
		"detail":     true,
		"token":      true,
		"log":        true,
		"midjourney": true,
		"task":       true,
	}

	// 个人中心区域 - 所有用户都可以访问
	defaultConfig["personal"] = map[string]interface{}{
		"enabled":  true,
		"topup":    true,
		"personal": true,
	}

	// 管理员区域 - 根据角色决定
	if userRole == common.RoleAdminUser {
		// 管理员可以访问管理员区域，但不能访问系统设置
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    false, // 管理员不能访问系统设置
		}
	} else if userRole == common.RoleRootUser {
		// 超级管理员可以访问所有功能
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    true,
		}
	}
	// 普通用户不包含admin区域

	// 转换为JSON字符串
	configBytes, err := common.Marshal(defaultConfig)
	if err != nil {
		common.SysLog("生成默认边栏配置失败: " + err.Error())
		return ""
	}

	return string(configBytes)
}

// CheckUserExistOrDeleted check if user exist or deleted, if not exist, return false, nil, if deleted or exist, return true, nil
func CheckUserExistOrDeleted(username string, email string) (bool, error) {
	var user User

	// err := DB.Unscoped().First(&user, "username = ? or email = ?", username, email).Error
	// check email if empty
	var err error
	email = NormalizeEmail(email)
	if email == "" {
		err = DB.Unscoped().First(&user, "username = ?", username).Error
	} else {
		err = DB.Unscoped().First(&user, "username = ? or LOWER(email) = ?", username, email).Error
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// not exist, return false, nil
			return false, nil
		}
		// other error, return false, err
		return false, err
	}
	// exist, return true, nil
	return true, nil
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func emailQuery(tx *gorm.DB, email string) *gorm.DB {
	if tx == nil {
		tx = DB
	}
	return tx.Unscoped().Model(&User{}).Where("LOWER(email) = ?", NormalizeEmail(email))
}

func CountUsersByEmail(email string) (int64, error) {
	email = NormalizeEmail(email)
	if email == "" {
		return 0, nil
	}
	var count int64
	err := emailQuery(DB, email).Count(&count).Error
	return count, err
}

func IsEmailAvailable(email string, excludeUserID int) (bool, error) {
	email = NormalizeEmail(email)
	if email == "" {
		return true, nil
	}
	query := emailQuery(DB, email)
	if excludeUserID > 0 {
		query = query.Where("id <> ?", excludeUserID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count == 0, nil
}

func EnsureEmailAvailable(email string, excludeUserID int) error {
	available, err := IsEmailAvailable(email, excludeUserID)
	if err != nil {
		return err
	}
	if !available {
		return ErrEmailAlreadyTaken
	}
	return nil
}

// withNormalizedEmailLock serializes concurrent writers that target the same
// normalized email inside tx, so a "check then write" sequence cannot be raced
// by two transactions. It must be called inside an active transaction; the lock
// is scoped to that transaction and released on commit/rollback.
//
//   - PostgreSQL: transaction-level advisory lock keyed by the normalized email.
//   - MySQL (default REPEATABLE READ): a locking read that takes a next-key/gap
//     lock on the email index, blocking concurrent inserts of the same value.
//   - SQLite: no explicit lock; the single-writer model already serializes the
//     write, so a racing second write fails instead of duplicating.
//
// An empty email is allowed to repeat and needs no serialization.
func withNormalizedEmailLock(tx *gorm.DB, email string, fn func(tx *gorm.DB) error) error {
	email = NormalizeEmail(email)
	if email == "" {
		return fn(tx)
	}
	switch {
	case common.UsingMainDatabase(common.DatabaseTypePostgreSQL):
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", email).Error; err != nil {
			return err
		}
	case common.UsingMainDatabase(common.DatabaseTypeMySQL):
		var ids []int
		if err := tx.Raw("SELECT id FROM users WHERE email = ? FOR UPDATE", email).Scan(&ids).Error; err != nil {
			return err
		}
	}
	return fn(tx)
}

func GetMaxUserId() int {
	var user User
	DB.Unscoped().Last(&user)
	return user.Id
}

func GetAllUsers(pageInfo *common.PageInfo, sortOptions ...UserSortOptions) (users []*User, total int64, err error) {
	// Start transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Get total count within transaction
	err = tx.Unscoped().Model(&User{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated users within same transaction
	order := resolveUserSortOptions(sortOptions)
	err = order.Apply(tx.Unscoped()).Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Omit("password", "access_token").Find(&users).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err = enrichUsersInviteStats(tx, users); err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func SearchUsers(keyword string, group string, role *int, status *int, startIdx int, num int, sortOptions ...UserSortOptions) ([]*User, int64, error) {
	var users []*User
	var total int64
	var err error

	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 构建基础查询
	query := tx.Unscoped().Model(&User{})

	// 构建搜索条件
	likeCondition := "username LIKE ? OR email LIKE ? OR display_name LIKE ?"
	likeArgs := []interface{}{"%" + keyword + "%", "%" + keyword + "%", "%" + keyword + "%"}

	// 尝试将关键字转换为整数ID
	keywordInt, err := strconv.Atoi(keyword)
	if err == nil {
		// 如果是数字，同时搜索ID和其他字段
		likeCondition = "id = ? OR " + likeCondition
		likeArgs = append([]interface{}{keywordInt}, likeArgs...)
	}

	query = query.Where("("+likeCondition+")", likeArgs...)
	if group != "" {
		query = query.Where(commonGroupCol+" = ?", group)
	}
	if role != nil {
		query = query.Where("role = ?", *role)
	}
	if status != nil {
		if *status == -1 {
			query = query.Where("deleted_at IS NOT NULL")
		} else {
			query = query.Where("deleted_at IS NULL").Where("status = ?", *status)
		}
	}

	// 获取总数
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	order := resolveUserSortOptions(sortOptions)
	err = order.Apply(query.Omit("password", "access_token")).Limit(num).Offset(startIdx).Find(&users).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err = enrichUsersInviteStats(tx, users); err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func GetUserById(id int, selectAll bool) (*User, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	user := User{Id: id}
	var err error = nil
	if selectAll {
		err = DB.First(&user, "id = ?", id).Error
	} else {
		err = DB.Omit("password", "access_token").First(&user, "id = ?", id).Error
	}
	return &user, err
}

func GetUserIdByAffCode(affCode string) (int, error) {
	if affCode == "" {
		return 0, errors.New("affCode 为空！")
	}
	var user User
	err := DB.Select("id").First(&user, "aff_code = ?", affCode).Error
	return user.Id, err
}

func DeleteUserById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	user := User{Id: id}
	return user.Delete()
}

func HardDeleteUserById(id int) error {
	if id == 0 {
		return errors.New("id 为空！")
	}
	user := User{Id: id}
	return user.HardDelete()
}

func inviteUser(inviterId int) error {
	updates := map[string]interface{}{
		"aff_count": gorm.Expr("aff_count + ?", 1),
	}
	if common.QuotaForInviter > 0 {
		updates["aff_quota"] = gorm.Expr("aff_quota + ?", common.QuotaForInviter)
		updates["aff_history"] = gorm.Expr("aff_history + ?", common.QuotaForInviter)
	}
	result := DB.Model(&User{}).Where("id = ?", inviterId).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (user *User) TransferAffQuotaToQuota(quota int) error {
	// 检查quota是否小于最小额度
	if float64(quota) < common.QuotaPerUnit {
		return fmt.Errorf("转移额度最小为%s！", logger.LogQuota(common.QuotaFromFloat(common.QuotaPerUnit)))
	}

	// 开始数据库事务
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback() // 确保在函数退出时事务能回滚

	// 加锁查询用户以确保数据一致性
	err := lockForUpdate(tx).First(user, user.Id).Error
	if err != nil {
		return err
	}

	// 再次检查用户的AffQuota是否足够
	if user.AffQuota < quota {
		return errors.New("邀请额度不足！")
	}

	// 更新用户额度
	user.AffQuota -= quota
	user.Quota += quota

	// 保存用户状态
	if err := tx.Save(user).Error; err != nil {
		return err
	}

	// 提交事务
	return tx.Commit().Error
}

func (user *User) prepareForInsert(tx *gorm.DB) error {
	user.Email = NormalizeEmail(user.Email)
	if err := ensureEmailAvailableWithTx(tx, user.Email, 0); err != nil {
		return err
	}
	if user.RegisterTime == 0 {
		user.RegisterTime = common.GetTimestamp()
	}
	if user.Password == "" {
		return nil
	}
	var err error
	user.Password, err = common.Password2Hash(user.Password)
	return err
}

// BindEmailToUser atomically checks email availability and assigns it to the
// user, serializing concurrent binds of the same email so two accounts cannot
// end up sharing one address. The email is normalized before check and store.
func BindEmailToUser(user *User, email string) error {
	email = NormalizeEmail(email)
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return withNormalizedEmailLock(tx, email, func(tx *gorm.DB) error {
			if err := ensureEmailAvailableWithTx(tx, email, user.Id); err != nil {
				return err
			}
			user.Email = email
			return user.UpdateWithTx(tx, false)
		})
	}); err != nil {
		return err
	}
	return updateUserCache(*user)
}

func ensureEmailAvailableWithTx(tx *gorm.DB, email string, excludeUserID int) error {
	email = NormalizeEmail(email)
	if email == "" {
		return nil
	}
	query := emailQuery(tx, email)
	if excludeUserID > 0 {
		query = query.Where("id <> ?", excludeUserID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrEmailAlreadyTaken
	}
	return nil
}

func (user *User) Insert(inviterId int) error {
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return withNormalizedEmailLock(tx, user.Email, func(tx *gorm.DB) error {
			if err := user.prepareForInsert(tx); err != nil {
				return err
			}
			user.Quota = common.QuotaForNewUser
			user.AffCode = common.GetRandomString(4)

			// 初始化用户设置，包括默认的边栏配置
			if user.Setting == "" {
				defaultSetting := dto.UserSetting{}
				// 这里暂时不设置SidebarModules，因为需要在用户创建后根据角色设置
				user.SetSetting(defaultSetting)
			}

			return tx.Create(user).Error
		})
	}); err != nil {
		return err
	}

	user.finishInsert(inviterId)
	return nil
}

func (user *User) finishInsert(inviterId int) {
	// 用户创建成功后，根据角色初始化边栏配置
	// 需要重新获取用户以确保有正确的ID和Role
	var createdUser User
	if err := DB.Where("username = ?", user.Username).First(&createdUser).Error; err == nil {
		// 生成基于角色的默认边栏配置
		defaultSidebarConfig := generateDefaultSidebarConfigForRole(createdUser.Role)
		if defaultSidebarConfig != "" {
			currentSetting := createdUser.GetSetting()
			currentSetting.SidebarModules = defaultSidebarConfig
			createdUser.SetSetting(currentSetting)
			createdUser.Update(false)
			common.SysLog(fmt.Sprintf("为新用户 %s (角色: %d) 初始化边栏配置", createdUser.Username, createdUser.Role))
		}
	}

	if common.QuotaForNewUser > 0 {
		RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("新用户注册赠送 %s", logger.LogQuota(common.QuotaForNewUser)))
	}
	if inviterId != 0 && operation_setting.IsPaymentComplianceConfirmed() {
		if common.QuotaForInvitee > 0 {
			_ = IncreaseUserQuota(user.Id, common.QuotaForInvitee, true)
			RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", logger.LogQuota(common.QuotaForInvitee)))
		}
		_ = inviteUser(inviterId)
		if common.QuotaForInviter > 0 {
			RecordLog(inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", logger.LogQuota(common.QuotaForInviter)))
		}
	}
}

func (user *User) FinishInsert(inviterId int) {
	user.finishInsert(inviterId)
}

// InsertWithTx inserts a new user within an existing transaction.
// This is used for OAuth registration where user creation and binding need to be atomic.
// Post-creation tasks (sidebar config, logs, inviter rewards) are handled after the transaction commits.
func (user *User) InsertWithTx(tx *gorm.DB, inviterId int) error {
	return withNormalizedEmailLock(tx, user.Email, func(tx *gorm.DB) error {
		if err := user.prepareForInsert(tx); err != nil {
			return err
		}
		user.Quota = common.QuotaForNewUser
		user.AffCode = common.GetRandomString(4)

		// 初始化用户设置
		if user.Setting == "" {
			defaultSetting := dto.UserSetting{}
			user.SetSetting(defaultSetting)
		}

		return tx.Create(user).Error
	})
}

// FinalizeOAuthUserCreation performs post-transaction tasks for OAuth user creation.
// This should be called after the transaction commits successfully.
func (user *User) FinalizeOAuthUserCreation(inviterId int) {
	// 用户创建成功后，根据角色初始化边栏配置
	var createdUser User
	if err := DB.Where("id = ?", user.Id).First(&createdUser).Error; err == nil {
		defaultSidebarConfig := generateDefaultSidebarConfigForRole(createdUser.Role)
		if defaultSidebarConfig != "" {
			currentSetting := createdUser.GetSetting()
			currentSetting.SidebarModules = defaultSidebarConfig
			createdUser.SetSetting(currentSetting)
			createdUser.Update(false)
			common.SysLog(fmt.Sprintf("为新用户 %s (角色: %d) 初始化边栏配置", createdUser.Username, createdUser.Role))
		}
	}

	if common.QuotaForNewUser > 0 {
		RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("新用户注册赠送 %s", logger.LogQuota(common.QuotaForNewUser)))
	}
	if inviterId != 0 && operation_setting.IsPaymentComplianceConfirmed() {
		if common.QuotaForInvitee > 0 {
			_ = IncreaseUserQuota(user.Id, common.QuotaForInvitee, true)
			RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", logger.LogQuota(common.QuotaForInvitee)))
		}
		_ = inviteUser(inviterId)
		if common.QuotaForInviter > 0 {
			RecordLog(inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", logger.LogQuota(common.QuotaForInviter)))
		}
	}
}

func (user *User) Update(updatePassword bool) error {
	var previousAuthVersion int64
	if err := DB.Model(&User{}).Where("id = ?", user.Id).Select("auth_version").Find(&previousAuthVersion).Error; err != nil {
		return err
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return user.UpdateWithTx(tx, updatePassword)
	}); err != nil {
		return err
	}
	if err := updateUserCache(*user); err != nil {
		return err
	}
	if user.AuthVersion > previousAuthVersion {
		_, err := RevokeAllUserSessions(user.Id, "user_security_changed")
		return err
	}
	return nil
}

func (user *User) UpdateWithTx(tx *gorm.DB, updatePassword bool) error {
	var err error
	if updatePassword {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	newUser := *user
	current := User{}
	if err = tx.First(&current, user.Id).Error; err != nil {
		return err
	}
	// Updates(struct) ignores zero values. Match that behavior when deciding
	// whether this request actually changes authentication-sensitive state;
	// partial self-profile updates intentionally leave role/status/group empty.
	authChanged := (updatePassword && current.Password != newUser.Password) ||
		(newUser.Role != 0 && current.Role != newUser.Role) ||
		(newUser.Status != 0 && current.Status != newUser.Status) ||
		(newUser.Group != "" && current.Group != newUser.Group)
	if authChanged {
		newUser.AuthVersion, err = IncrementUserAuthVersionWithTx(tx, user.Id)
		if err != nil {
			return err
		}
	}
	if err = tx.Model(&current).Omit(
		"access_token",
		"quota",
		"used_quota",
		"request_count",
		"aff_count",
		"aff_quota",
		"aff_history",
		"auth_version",
	).Updates(newUser).Error; err != nil {
		return err
	}
	return tx.First(user, user.Id).Error
}

// EditableUserFields 管理员可编辑字段的 JSON 键 -> 数据库列映射
var EditableUserFields = map[string]string{
	"username":     "username",
	"display_name": "display_name",
	"group":        "group",
	"quota":        "quota",
	"remark":       "remark",
}

// Edit 更新管理员可编辑的用户字段。
//
// provided 是本次请求里**实际提交过**的 JSON 键集合，只有其中的字段才会被写库。
// 这一点至关重要：GORM 用 map 更新时不会跳过零值，早先版本无条件写入全部字段，
// 于是前端没提交的字段会被解码成 Go 零值再覆盖进库——后台只改分组却把用户额度
// 清零就是这么来的（前端为走原子调额接口，提交时特意剔除了 quota）。
// provided 为 nil 时不更新任何业务字段，避免调用方漏传集合就静默清库。
func (user *User) Edit(updatePassword bool, provided map[string]struct{}) error {
	var previousAuthVersion int64
	if err := DB.Model(&User{}).Where("id = ?", user.Id).Select("auth_version").Find(&previousAuthVersion).Error; err != nil {
		return err
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return user.EditWithTx(tx, updatePassword, provided)
	}); err != nil {
		return err
	}
	if err := updateUserCache(*user); err != nil {
		return err
	}
	if user.AuthVersion > previousAuthVersion {
		_, err := RevokeAllUserSessions(user.Id, "user_security_changed")
		return err
	}
	return nil
}

func (user *User) EditWithTx(tx *gorm.DB, updatePassword bool, provided map[string]struct{}) error {
	var err error
	if updatePassword {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}

	newUser := *user
	values := map[string]interface{}{
		"username":     newUser.Username,
		"display_name": newUser.DisplayName,
		"group":        newUser.Group,
		"quota":        newUser.Quota,
		"remark":       newUser.Remark,
	}
	updates := make(map[string]interface{}, len(values)+1)
	for key, column := range EditableUserFields {
		if _, ok := provided[key]; ok {
			updates[column] = values[column]
		}
	}
	if updatePassword {
		updates["password"] = newUser.Password
	}

	current := User{}
	if err = tx.First(&current, user.Id).Error; err != nil {
		return err
	}
	// 上游 7-20：密码或分组变化时递增 auth_version，调用方据此撤销该用户所有登录会话。
	// 本站只写本次请求实际提交的字段，所以分组只在提交了 group 时才算变化。
	_, groupProvided := provided["group"]
	authChanged := (updatePassword && current.Password != newUser.Password) ||
		(groupProvided && current.Group != newUser.Group)
	if authChanged {
		if _, err = IncrementUserAuthVersionWithTx(tx, user.Id); err != nil {
			return err
		}
	}
	if len(updates) > 0 {
		if err = tx.Model(&current).Updates(updates).Error; err != nil {
			return err
		}
	}
	return tx.First(user, user.Id).Error
}

func (user *User) ClearBinding(bindingType string) error {
	if user.Id == 0 {
		return errors.New("user id is empty")
	}

	bindingColumnMap := map[string]string{
		"email":    "email",
		"github":   "github_id",
		"discord":  "discord_id",
		"oidc":     "oidc_id",
		"wechat":   "wechat_id",
		"telegram": "telegram_id",
		"linuxdo":  "linux_do_id",
	}

	column, ok := bindingColumnMap[bindingType]
	if !ok {
		return errors.New("invalid binding type")
	}

	if err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", user.Id).Update(column, "").Error; err != nil {
			return err
		}
		if bindingType == ExternalIdentityProviderTelegram {
			return ReleaseExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, user.Id)
		}
		return nil
	}); err != nil {
		return err
	}

	if err := DB.Where("id = ?", user.Id).First(user).Error; err != nil {
		return err
	}

	return updateUserCache(*user)
}

func (user *User) Delete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	var nextAuthVersion int64
	if err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		nextAuthVersion, err = IncrementUserAuthVersionWithTx(tx, user.Id)
		if err != nil {
			return err
		}
		return tx.Delete(user).Error
	}); err != nil {
		return err
	}
	if err := publishCommittedUserAuthVersion(user.Id, nextAuthVersion); err != nil {
		return err
	}
	if _, err := RevokeAllUserSessions(user.Id, "user_deleted"); err != nil {
		return err
	}
	return invalidateUserCache(user.Id)
}

func (user *User) HardDelete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	var tokens []Token
	var deletedAuthVersion int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		deletedAuthVersion, err = IncrementUserAuthVersionWithTx(tx, user.Id)
		if err != nil {
			return err
		}
		if common.RedisEnabled {
			if err := tx.Unscoped().Select("id", commonKeyCol).Where("user_id = ?", user.Id).Find(&tokens).Error; err != nil {
				return err
			}
		}
		if err := deleteUserAuthenticationData(tx, user.Id); err != nil {
			return err
		}
		return tx.Unscoped().Delete(user).Error
	})
	if err != nil {
		return err
	}
	if err := publishCommittedUserAuthVersion(user.Id, deletedAuthVersion); err != nil {
		common.SysError(fmt.Sprintf("failed to publish auth tombstone after hard deleting user %d: %v", user.Id, err))
	}
	if err := invalidateTokensCache(tokens); err != nil {
		common.SysError(fmt.Sprintf("failed to invalidate token cache after hard deleting user %d: %v", user.Id, err))
	}
	if err := invalidateUserCache(user.Id); err != nil {
		common.SysError(fmt.Sprintf("failed to invalidate user cache after hard deleting user %d: %v", user.Id, err))
	}
	return nil
}

func deleteUserAuthenticationData(tx *gorm.DB, userId int) error {
	if err := releaseAllExternalIdentitiesWithTx(tx, userId); err != nil {
		return err
	}
	for _, authenticationData := range []any{
		&TwoFABackupCode{},
		&TwoFA{},
		&UserSession{},
		&AuthFlow{},
		&PasskeyCredential{},
		&Token{},
	} {
		if err := tx.Unscoped().Where("user_id = ?", userId).Delete(authenticationData).Error; err != nil {
			return err
		}
	}
	return deleteUserOAuthBindingsByUserId(tx, userId)
}

// ValidateAndFill check password & user status
func (user *User) ValidateAndFill() (err error) {
	// When querying with struct, GORM will only query with non-zero fields,
	// that means if your field's value is 0, '', false or other zero values,
	// it won't be used to build query conditions
	password := user.Password
	username := strings.TrimSpace(user.Username)
	if username == "" || password == "" {
		return ErrUserEmptyCredentials
	}
	// find by username or email
	err = DB.Where("username = ? OR email = ?", username, username).First(user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidCredentials
		}
		return fmt.Errorf("%w: %v", ErrDatabase, err)
	}
	if user.Password == "" {
		return ErrInvalidCredentials
	}
	okay := common.ValidatePasswordAndHash(password, user.Password)
	if !okay || user.Status != common.UserStatusEnabled {
		return ErrInvalidCredentials
	}
	return nil
}

func (user *User) FillUserById() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	DB.Where(User{Id: user.Id}).First(user)
	return nil
}

func (user *User) FillUserByEmail() error {
	if user.Email == "" {
		return errors.New("email 为空！")
	}
	DB.Where(User{Email: user.Email}).First(user)
	return nil
}

func (user *User) FillUserByGitHubId() error {
	if user.GitHubId == "" {
		return errors.New("GitHub id 为空！")
	}
	DB.Where(User{GitHubId: user.GitHubId}).First(user)
	return nil
}

// UpdateGitHubId updates the user's GitHub ID (used for migration from login to numeric ID)
func (user *User) UpdateGitHubId(newGitHubId string) error {
	if user.Id == 0 {
		return errors.New("user id is empty")
	}
	return DB.Model(user).Update("github_id", newGitHubId).Error
}

func (user *User) FillUserByDiscordId() error {
	if user.DiscordId == "" {
		return errors.New("discord id 为空！")
	}
	DB.Where(User{DiscordId: user.DiscordId}).First(user)
	return nil
}

func (user *User) FillUserByOidcId() error {
	if user.OidcId == "" {
		return errors.New("oidc id 为空！")
	}
	DB.Where(User{OidcId: user.OidcId}).First(user)
	return nil
}

func (user *User) FillUserByWeChatId() error {
	if user.WeChatId == "" {
		return errors.New("WeChat id 为空！")
	}
	DB.Where(User{WeChatId: user.WeChatId}).First(user)
	return nil
}

func (user *User) FillUserByTelegramId() error {
	if user.TelegramId == "" {
		return errors.New("Telegram id 为空！")
	}
	err := DB.Where(User{TelegramId: user.TelegramId}).First(user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("该 Telegram 账户未绑定")
	}
	return nil
}

func IsEmailAlreadyTaken(email string) bool {
	count, err := CountUsersByEmail(email)
	return err == nil && count > 0
}

func GetUniqueUserByEmail(email string) (*User, error) {
	email = NormalizeEmail(email)
	if email == "" {
		return nil, ErrEmailNotFound
	}
	var users []User
	if err := DB.Where("LOWER(email) = ?", email).Limit(2).Find(&users).Error; err != nil {
		return nil, err
	}
	switch len(users) {
	case 0:
		return nil, ErrEmailNotFound
	case 1:
		return &users[0], nil
	default:
		return nil, ErrEmailAmbiguous
	}
}

func IsWeChatIdAlreadyTaken(wechatId string) bool {
	return DB.Unscoped().Where("wechat_id = ?", wechatId).Find(&User{}).RowsAffected == 1
}

func IsGitHubIdAlreadyTaken(githubId string) bool {
	return DB.Unscoped().Where("github_id = ?", githubId).Find(&User{}).RowsAffected == 1
}

func IsDiscordIdAlreadyTaken(discordId string) bool {
	return DB.Unscoped().Where("discord_id = ?", discordId).Find(&User{}).RowsAffected == 1
}

func IsOidcIdAlreadyTaken(oidcId string) bool {
	return DB.Where("oidc_id = ?", oidcId).Find(&User{}).RowsAffected == 1
}

func IsTelegramIdAlreadyTaken(telegramId string) bool {
	return DB.Unscoped().Where("telegram_id = ?", telegramId).Find(&User{}).RowsAffected == 1
}

func ResetUserPasswordByEmail(email string, password string) error {
	if email == "" || password == "" {
		return errors.New("邮箱地址或密码为空！")
	}
	user, err := GetUniqueUserByEmail(email)
	if err != nil {
		return err
	}
	hashedPassword, err := common.Password2Hash(password)
	if err != nil {
		return err
	}
	if err = DB.Transaction(func(tx *gorm.DB) error {
		if _, err := IncrementUserAuthVersionWithTx(tx, user.Id); err != nil {
			return err
		}
		return tx.Model(&User{}).Where("id = ?", user.Id).Update("password", hashedPassword).Error
	}); err != nil {
		return err
	}
	if err := PublishUserAuthCache(user.Id); err != nil {
		return err
	}
	_, err = RevokeAllUserSessions(user.Id, "password_reset")
	return err
}

func IsAdmin(userId int) bool {
	if userId == 0 {
		return false
	}
	var user User
	err := DB.Where("id = ?", userId).Select("role").Find(&user).Error
	if err != nil {
		common.SysLog("no such user " + err.Error())
		return false
	}
	return user.Role >= common.RoleAdminUser
}

func ValidateAccessToken(token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	token = strings.Replace(token, "Bearer ", "", 1)
	user := &User{}
	err := DB.Where("access_token = ?", token).First(user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("%w: %v", ErrDatabase, err)
	}
	return user, nil
}

// GetUserQuota gets quota from Redis first, falls back to DB if needed
func GetUserQuota(id int, fromDB bool) (quota int, err error) {
	if !fromDB && common.RedisEnabled {
		return getUserQuotaCache(id)
	}
	err = DB.Model(&User{}).Where("id = ?", id).Select("quota").Find(&quota).Error
	if err != nil {
		return 0, err
	}

	return quota, nil
}

func GetUserUsedQuota(id int) (quota int, err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Select("used_quota").Find(&quota).Error
	return quota, err
}

func GetUserEmail(id int) (email string, err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Select("email").Find(&email).Error
	return email, err
}

// GetUserGroup gets group from Redis first, falls back to DB if needed
func GetUserGroup(id int, fromDB bool) (group string, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := RefreshUserGroupCache(id); err != nil {
					common.SysLog("failed to update user group cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		group, err := getUserGroupCache(id)
		if err == nil {
			return group, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Model(&User{}).Where("id = ?", id).Select(commonGroupCol).Find(&group).Error
	if err != nil {
		return "", err
	}

	return group, nil
}

// GetUserSetting gets setting from Redis first, falls back to DB if needed
func GetUserSetting(id int, fromDB bool) (settingMap dto.UserSetting, err error) {
	var setting string
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserSettingCache(id, setting); err != nil {
					common.SysLog("failed to update user setting cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		setting, err := getUserSettingCache(id)
		if err == nil {
			return setting, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	// can be nil setting
	var safeSetting sql.NullString
	err = DB.Model(&User{}).Where("id = ?", id).Select("setting").Find(&safeSetting).Error
	if err != nil {
		return settingMap, err
	}
	if safeSetting.Valid {
		setting = safeSetting.String
	} else {
		setting = ""
	}
	userBase := &UserBase{
		Setting: setting,
	}
	return userBase.GetSetting(), nil
}

func IncreaseUserQuota(id int, quota int, db bool) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if err := common.ValidateWalletQuota(quota); err != nil {
		return err
	}
	if !db && common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuota, id, quota)
		gopool.Go(func() {
			if err := cacheIncrUserQuota(id, int64(quota)); err != nil {
				common.SysLog("failed to increase user quota: " + err.Error())
			}
		})
		return nil
	}
	if err := increaseUserQuota(id, quota); err != nil {
		return err
	}
	gopool.Go(func() {
		if err := cacheIncrUserQuota(id, int64(quota)); err != nil {
			common.SysLog("failed to increase user quota: " + err.Error())
		}
	})
	return nil
}

func increaseUserQuota(id int, quota int) (err error) {
	result := DB.Model(&User{}).
		Where("id = ? AND quota <= ?", id, common.MaxWalletQuota-quota).
		Update("quota", gorm.Expr("quota + ?", quota))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var count int64
	if err := DB.Model(&User{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return ErrWalletQuotaLimitExceeded
}

func DecreaseUserQuota(id int, quota int, db bool) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	gopool.Go(func() {
		err := cacheDecrUserQuota(id, int64(quota))
		if err != nil {
			common.SysLog("failed to decrease user quota: " + err.Error())
		}
	})
	if !db && common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuota, id, -quota)
		return nil
	}
	return decreaseUserQuota(id, quota)
}

func decreaseUserQuota(id int, quota int) (err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Update("quota", gorm.Expr("quota - ?", quota)).Error
	if err != nil {
		return err
	}
	return err
}

func DeltaUpdateUserQuota(id int, delta int) (err error) {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return IncreaseUserQuota(id, delta, false)
	} else {
		return DecreaseUserQuota(id, -delta, false)
	}
}

//func GetRootUserEmail() (email string) {
//	DB.Model(&User{}).Where("role = ?", common.RoleRootUser).Select("email").Find(&email)
//	return email
//}

func GetRootUser() (user *User) {
	DB.Where("role = ?", common.RoleRootUser).First(&user)
	return user
}

func UpdateUserLastLoginAt(id int) {
	if err := DB.Model(&User{}).Where("id = ?", id).Update("last_login_at", common.GetTimestamp()).Error; err != nil {
		common.SysLog("failed to update user last_login_at: " + err.Error())
	}
}

func UpdateUserUsedQuotaAndRequestCount(id int, quota int) {
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUsedQuota, id, quota)
		addNewRecord(BatchUpdateTypeRequestCount, id, 1)
		return
	}
	updateUserUsedQuotaAndRequestCount(id, quota, 1)
}

// UpdateUserUsedQuota adjusts accumulated usage without changing request count.
func UpdateUserUsedQuota(id int, quota int) {
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUsedQuota, id, quota)
		return
	}
	if err := DB.Model(&User{}).Where("id = ?", id).Update("used_quota", gorm.Expr("used_quota + ?", quota)).Error; err != nil {
		common.SysLog("failed to update user used quota: " + err.Error())
	}
}

func updateUserUsedQuotaAndRequestCount(id int, quota int, count int) {
	err := DB.Model(&User{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"request_count": gorm.Expr("request_count + ?", count),
		},
	).Error
	if err != nil {
		common.SysLog("failed to update user used quota and request count: " + err.Error())
		return
	}

	//// 更新缓存
	//if err := invalidateUserCache(id); err != nil {
	//	common.SysError("failed to invalidate user cache: " + err.Error())
	//}
}

func updateUserQuotaUsedQuotaAndRequestCount(id int, quota int, usedQuota int, requestCount int) {
	if quota == 0 && usedQuota == 0 && requestCount == 0 {
		return
	}

	err := DB.Model(&User{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"quota":         gorm.Expr("quota + ?", quota),
			"used_quota":    gorm.Expr("used_quota + ?", usedQuota),
			"request_count": gorm.Expr("request_count + ?", requestCount),
		},
	).Error
	if err != nil {
		common.SysLog("failed to batch update user quota, used quota and request count: " + err.Error())
	}
}

// GetUsernameById gets username from Redis first, falls back to DB if needed
func GetUsernameById(id int, fromDB bool) (username string, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserNameCache(id, username); err != nil {
					common.SysLog("failed to update user name cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		username, err := getUserNameCache(id)
		if err == nil {
			return username, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Model(&User{}).Where("id = ?", id).Select("username").Find(&username).Error
	if err != nil {
		return "", err
	}

	return username, nil
}

func IsLinuxDOIdAlreadyTaken(linuxDOId string) bool {
	var user User
	err := DB.Unscoped().Where("linux_do_id = ?", linuxDOId).First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func (user *User) FillUserByLinuxDOId() error {
	if user.LinuxDOId == "" {
		return errors.New("linux do id is empty")
	}
	err := DB.Where("linux_do_id = ?", user.LinuxDOId).First(user).Error
	return err
}

func RootUserExists() bool {
	var user User
	err := DB.Where("role = ?", common.RoleRootUser).First(&user).Error
	if err != nil {
		return false
	}
	return true
}

// ==================== Invite Statistics ====================

type UserInviteOrderStats struct {
	// 合计字段（向下兼容旧 UI；含义：订阅 + 充值合计）
	PaidOrderCount int     `json:"paid_order_count"`
	PaidAmount     float64 `json:"paid_amount"`
	LastPaidTime   int64   `json:"last_paid_time"`
	// 拆分字段
	SubscriptionOrderCount int     `json:"subscription_order_count"`
	SubscriptionAmount     float64 `json:"subscription_amount"`
	TopUpCount             int     `json:"topup_count"`
	TopUpAmount            float64 `json:"topup_amount"`
}

type UserInviteSubscriptionStats struct {
	SubscriptionCount       int `json:"subscription_count"`
	ActiveSubscriptionCount int `json:"active_subscription_count"`
}

type UserInviteDetail struct {
	Id                int                         `json:"id"`
	Username          string                      `json:"username"`
	DisplayName       string                      `json:"display_name"`
	Email             string                      `json:"email"`
	RegisterIP        string                      `json:"register_ip"`
	RegisterTime      int64                       `json:"register_time"`
	InviterId         int                         `json:"inviter_id"`
	OrderStats        UserInviteOrderStats        `json:"order_stats"`
	SubscriptionStats UserInviteSubscriptionStats `json:"subscription_stats"`
	RiskTags          []string                    `json:"risk_tags"`
	RiskScore         int                         `json:"risk_score"`
	IsDeleted         bool                        `json:"is_deleted"`
	DeletedAt         int64                       `json:"deleted_at,omitempty"`
}

type UserInviteSummary struct {
	InvitedTotal            int     `json:"invited_total"`
	PaidTotal               int     `json:"paid_total"`
	UnpaidTotal             int     `json:"unpaid_total"`
	PaidAmountTotal         float64 `json:"paid_amount_total"`
	SubscriptionAmountTotal float64 `json:"subscription_amount_total"`
	TopUpAmountTotal        float64 `json:"topup_amount_total"`
	ActiveSubscriptionTotal int     `json:"active_subscription_total"`
	SuspiciousTotal         int     `json:"suspicious_total"`
	DeletedTotal            int     `json:"deleted_total"`
}

type UserInviteDetailsResponse struct {
	Summary UserInviteSummary  `json:"summary"`
	Items   []UserInviteDetail `json:"items"`
}

func GetUserInviteDetails(inviterId int) (*UserInviteDetailsResponse, error) {
	if inviterId <= 0 {
		return nil, errors.New("inviter id 为空！")
	}

	var invitees []*User
	// Unscoped 含软删用户，与 aff_count 口径对齐
	if err := DB.Unscoped().Model(&User{}).
		Where("inviter_id = ?", inviterId).
		Order("id desc").
		Find(&invitees).Error; err != nil {
		return nil, err
	}

	resp := &UserInviteDetailsResponse{
		Items: make([]UserInviteDetail, 0, len(invitees)),
	}
	if len(invitees) == 0 {
		return resp, nil
	}

	userIds := make([]int, 0, len(invitees))
	for _, invitee := range invitees {
		userIds = append(userIds, invitee.Id)
	}

	orderStatsMap, err := getInviteOrderStats(userIds)
	if err != nil {
		return nil, err
	}
	subscriptionStatsMap, err := getInviteSubscriptionStats(userIds)
	if err != nil {
		return nil, err
	}
	ipCount := make(map[string]int)
	for _, invitee := range invitees {
		if invitee.RegisterIP != "" {
			ipCount[invitee.RegisterIP]++
		}
	}

	for _, invitee := range invitees {
		orderStats := orderStatsMap[invitee.Id]
		subStats := subscriptionStatsMap[invitee.Id]
		riskTags := make([]string, 0, 2)
		riskScore := 0
		if invitee.RegisterIP != "" && ipCount[invitee.RegisterIP] > 1 {
			riskTags = append(riskTags, "same_ip")
			riskScore += 2
		}
		if orderStats.PaidOrderCount == 0 {
			riskTags = append(riskTags, "no_real_payment")
			riskScore += 1
		}

		isDeleted := invitee.DeletedAt.Valid
		deletedAtTs := int64(0)
		if isDeleted {
			deletedAtTs = invitee.DeletedAt.Time.Unix()
		}

		resp.Items = append(resp.Items, UserInviteDetail{
			Id:                invitee.Id,
			Username:          invitee.Username,
			DisplayName:       invitee.DisplayName,
			Email:             invitee.Email,
			RegisterIP:        invitee.RegisterIP,
			RegisterTime:      invitee.RegisterTime,
			InviterId:         invitee.InviterId,
			OrderStats:        orderStats,
			SubscriptionStats: subStats,
			RiskTags:          riskTags,
			RiskScore:         riskScore,
			IsDeleted:         isDeleted,
			DeletedAt:         deletedAtTs,
		})

		resp.Summary.InvitedTotal++
		if isDeleted {
			resp.Summary.DeletedTotal++
		}
		if orderStats.PaidOrderCount > 0 {
			resp.Summary.PaidTotal++
			resp.Summary.PaidAmountTotal += orderStats.PaidAmount
			resp.Summary.SubscriptionAmountTotal += orderStats.SubscriptionAmount
			resp.Summary.TopUpAmountTotal += orderStats.TopUpAmount
		} else {
			resp.Summary.UnpaidTotal++
		}
		if subStats.ActiveSubscriptionCount > 0 {
			resp.Summary.ActiveSubscriptionTotal++
		}
		// 计分制：score >= 2 才算可疑
		if riskScore >= 2 {
			resp.Summary.SuspiciousTotal++
		}
	}

	return resp, nil
}

func getInviteOrderStats(userIds []int) (map[int]UserInviteOrderStats, error) {
	result := make(map[int]UserInviteOrderStats, len(userIds))
	if len(userIds) == 0 {
		return result, nil
	}

	// 查询 A：订阅订单
	var subRows []struct {
		UserId       int     `gorm:"column:user_id"`
		OrderCount   int     `gorm:"column:order_count"`
		Amount       float64 `gorm:"column:amount"`
		LastPaidTime int64   `gorm:"column:last_paid_time"`
	}
	err := DB.Model(&SubscriptionOrder{}).
		Select("user_id, COUNT(*) as order_count, COALESCE(SUM(money), 0) as amount, COALESCE(MAX(complete_time), 0) as last_paid_time").
		Where("user_id IN ? AND status = ?", userIds, "paid").
		Group("user_id").
		Find(&subRows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range subRows {
		result[row.UserId] = UserInviteOrderStats{
			SubscriptionOrderCount: row.OrderCount,
			SubscriptionAmount:     row.Amount,
			PaidOrderCount:         row.OrderCount,
			PaidAmount:             row.Amount,
			LastPaidTime:           row.LastPaidTime,
		}
	}

	// 查询 B：在线充值（Stripe/Creem/Waffo/易支付等）
	var topupRows []struct {
		UserId       int     `gorm:"column:user_id"`
		OrderCount   int     `gorm:"column:order_count"`
		Amount       float64 `gorm:"column:amount"`
		LastPaidTime int64   `gorm:"column:last_paid_time"`
	}
	err = DB.Model(&TopUp{}).
		Select("user_id, COUNT(*) as order_count, COALESCE(SUM(money), 0) as amount, COALESCE(MAX(complete_time), 0) as last_paid_time").
		Where("user_id IN ? AND status = ?", userIds, common.TopUpStatusSuccess).
		Group("user_id").
		Find(&topupRows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range topupRows {
		stat := result[row.UserId]
		stat.TopUpCount = row.OrderCount
		stat.TopUpAmount = row.Amount
		stat.PaidOrderCount += row.OrderCount
		stat.PaidAmount += row.Amount
		if row.LastPaidTime > stat.LastPaidTime {
			stat.LastPaidTime = row.LastPaidTime
		}
		result[row.UserId] = stat
	}

	return result, nil
}

func getInviteSubscriptionStats(userIds []int) (map[int]UserInviteSubscriptionStats, error) {
	result := make(map[int]UserInviteSubscriptionStats, len(userIds))
	if len(userIds) == 0 {
		return result, nil
	}

	var rows []struct {
		UserId                  int `gorm:"column:user_id"`
		SubscriptionCount       int `gorm:"column:subscription_count"`
		ActiveSubscriptionCount int `gorm:"column:active_subscription_count"`
	}

	err := DB.Model(&UserSubscription{}).
		Select("user_id, COUNT(*) as subscription_count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_subscription_count").
		Where("user_id IN ?", userIds).
		Group("user_id").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		result[row.UserId] = UserInviteSubscriptionStats{
			SubscriptionCount:       row.SubscriptionCount,
			ActiveSubscriptionCount: row.ActiveSubscriptionCount,
		}
	}
	return result, nil
}

func enrichUsersInviteStats(tx *gorm.DB, users []*User) error {
	if len(users) == 0 {
		return nil
	}

	userIds := make([]int, 0, len(users))
	for _, user := range users {
		userIds = append(userIds, user.Id)
	}

	var invitedRows []struct {
		InviterId    int `gorm:"column:inviter_id"`
		InvitedTotal int `gorm:"column:invited_total"`
	}
	// Unscoped 含软删被邀用户，与详情页/aff_count 口径对齐
	if err := tx.Unscoped().Model(&User{}).
		Select("inviter_id, COUNT(*) as invited_total").
		Where("inviter_id IN ?", userIds).
		Group("inviter_id").
		Find(&invitedRows).Error; err != nil {
		return err
	}

	invitedMap := make(map[int]int, len(invitedRows))
	for _, row := range invitedRows {
		invitedMap[row.InviterId] = row.InvitedTotal
	}

	// 真实付费 = 订阅 ∪ 充值。先按 inviter 分别查 subscription_orders 和 top_ups，
	// 再在 Go 内存合并去重，避免一个被邀人同时出现在两个表导致计数翻倍。
	type inviterPaid struct {
		invitees map[int]struct{}
		amount   float64
	}
	merged := make(map[int]*inviterPaid)
	ensure := func(inviterId int) *inviterPaid {
		if p, ok := merged[inviterId]; ok {
			return p
		}
		p := &inviterPaid{invitees: make(map[int]struct{})}
		merged[inviterId] = p
		return p
	}

	// 订阅订单付费记录
	var subPaidRows []struct {
		InviterId int     `gorm:"column:inviter_id"`
		InviteeId int     `gorm:"column:invitee_id"`
		Amount    float64 `gorm:"column:amount"`
	}
	if err := tx.Table("users AS invitees").
		Select(`invitees.inviter_id, invitees.id as invitee_id,
			COALESCE(SUM(subscription_orders.money), 0) as amount`).
		Joins(`JOIN subscription_orders ON subscription_orders.user_id = invitees.id AND subscription_orders.status = ?`, "paid").
		Where("invitees.inviter_id IN ?", userIds).
		Group("invitees.inviter_id, invitees.id").
		Find(&subPaidRows).Error; err != nil {
		return err
	}
	for _, row := range subPaidRows {
		p := ensure(row.InviterId)
		p.invitees[row.InviteeId] = struct{}{}
		p.amount += row.Amount
	}

	// 充值付费记录（top_ups.status='success'）
	var topupPaidRows []struct {
		InviterId int     `gorm:"column:inviter_id"`
		InviteeId int     `gorm:"column:invitee_id"`
		Amount    float64 `gorm:"column:amount"`
	}
	if err := tx.Table("users AS invitees").
		Select(`invitees.inviter_id, invitees.id as invitee_id,
			COALESCE(SUM(top_ups.money), 0) as amount`).
		Joins(`JOIN top_ups ON top_ups.user_id = invitees.id AND top_ups.status = ?`, common.TopUpStatusSuccess).
		Where("invitees.inviter_id IN ?", userIds).
		Group("invitees.inviter_id, invitees.id").
		Find(&topupPaidRows).Error; err != nil {
		return err
	}
	for _, row := range topupPaidRows {
		p := ensure(row.InviterId)
		p.invitees[row.InviteeId] = struct{}{}
		p.amount += row.Amount
	}

	paidMap := make(map[int]struct {
		count  int
		amount float64
	}, len(merged))
	for inviterId, p := range merged {
		paidMap[inviterId] = struct {
			count  int
			amount float64
		}{count: len(p.invitees), amount: p.amount}
	}

	var suspiciousRows []struct {
		InviterId             int `gorm:"column:inviter_id"`
		InviteSuspiciousCount int `gorm:"column:invite_suspicious_count"`
	}
	if err := tx.Table("users AS invitees").
		Select(`invitees.inviter_id, COUNT(*) as invite_suspicious_count`).
		Where(`invitees.inviter_id IN ? AND invitees.register_ip <> '' AND invitees.register_ip IN (
			SELECT register_ip FROM users WHERE inviter_id IN ? AND register_ip <> '' GROUP BY inviter_id, register_ip HAVING COUNT(*) > 1
		)`, userIds, userIds).
		Group("invitees.inviter_id").
		Find(&suspiciousRows).Error; err != nil {
		return err
	}

	suspiciousMap := make(map[int]int, len(suspiciousRows))
	for _, row := range suspiciousRows {
		suspiciousMap[row.InviterId] = row.InviteSuspiciousCount
	}

	for _, user := range users {
		user.InvitedTotal = invitedMap[user.Id]
		paid := paidMap[user.Id]
		user.InvitedPaidCount = paid.count
		user.InvitePaidAmount = paid.amount
		user.InviteSuspiciousCount = suspiciousMap[user.Id]
		if user.InvitedTotal > 0 {
			user.InviteConversionRate = float64(user.InvitedPaidCount) / float64(user.InvitedTotal)
		}
	}

	return nil
}

// DisableUserByAudit 因内容审核自动封禁某用户，返回是否真的发生了状态变更。
//
// 不复用 (user *User) Update：那里用 Updates(结构体) 会跳过零值，
// 而且会连带写入调用方传入的其它字段，风险面比这里需要的大得多。
// 这里只动 status 一列，并显式刷新用户缓存，否则已缓存的启用状态会让封禁在缓存过期前无效。
func DisableUserByAudit(userId int) (bool, error) {
	var user User
	if err := DB.First(&user, userId).Error; err != nil {
		return false, err
	}
	// 兜底：root 永不封禁，避免把站点管理员自己锁死
	if user.Role == common.RoleRootUser {
		return false, nil
	}
	if user.Status != common.UserStatusEnabled {
		return false, nil
	}
	if err := DB.Model(&User{}).Where("id = ?", userId).
		Update("status", common.UserStatusDisabled).Error; err != nil {
		return false, err
	}
	user.Status = common.UserStatusDisabled
	if err := updateUserCache(user); err != nil {
		// 库已改成功，缓存刷新失败只记日志：缓存会自然过期，不该因此报失败
		common.SysLog(fmt.Sprintf("自动封禁后刷新用户缓存失败 user=%d: %s", userId, err.Error()))
	}
	return true, nil
}
