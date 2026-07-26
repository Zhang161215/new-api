package model

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const UserNameMaxLength = 20

// User if you add sensitive fields, don't forget to clean them in setupLogin function.
// Otherwise, the sensitive information will be saved on local storage in plain text!
type User struct {
	Id                    int            `json:"id"`
	Username              string         `json:"username" gorm:"unique;index" validate:"max=20"`
	Password              string         `json:"password" gorm:"not null;" validate:"min=8,max=20"`
	OriginalPassword      string         `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName           string         `json:"display_name" gorm:"index" validate:"max=20"`
	Role                  int            `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status                int            `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email                 string         `json:"email" gorm:"index" validate:"max=50"`
	GitHubId              string         `json:"github_id" gorm:"column:github_id;index"`
	DiscordId             string         `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId                string         `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId              string         `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId            string         `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode      string         `json:"verification_code" gorm:"-:all"`                                    // this field is only for Email verification, don't save it to database!
	AccessToken           *string        `json:"access_token" gorm:"type:char(32);column:access_token;uniqueIndex"` // this token is for system management
	Quota                 int            `json:"quota" gorm:"type:int;default:0"`
	UsedQuota             int            `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount          int            `json:"request_count" gorm:"type:int;default:0;"`               // request number
	Group                 string         `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode               string         `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount              int            `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota              int            `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`                            // 邀请剩余额度
	AffPendingQuota       int            `json:"aff_pending_quota" gorm:"type:int;default:0;column:aff_pending_quota"`            // 邀请待到账额度
	AffHistoryQuota       int            `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"`                  // 邀请历史额度
	InviterId             int            `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	RegisterIP            string         `json:"register_ip,omitempty" gorm:"type:varchar(64);column:register_ip;index"`
	RegisterTime          int64          `json:"register_time" gorm:"bigint;column:register_time;index"`
	InvitedTotal          int            `json:"invited_total,omitempty" gorm:"-:all"`
	InvitedPaidCount      int            `json:"invited_paid_count,omitempty" gorm:"-:all"`
	InviteSuspiciousCount int            `json:"invite_suspicious_count,omitempty" gorm:"-:all"`
	InvitePaidAmount      float64        `json:"invite_paid_amount,omitempty" gorm:"-:all"`
	InviteConversionRate  float64        `json:"invite_conversion_rate,omitempty" gorm:"-:all"`
	DeletedAt             gorm.DeletedAt `gorm:"index"`
	LinuxDOId             string         `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	Setting               string         `json:"setting" gorm:"type:text;column:setting"`
	Remark                string         `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer        string         `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	ExpiredTime           int64          `json:"expired_time" gorm:"bigint;default:-1"` // -1 means never expired
}

func (user *User) ToBaseUser() *UserBase {
	cache := &UserBase{
		Id:          user.Id,
		Group:       user.Group,
		Quota:       user.Quota,
		Status:      user.Status,
		Username:    user.Username,
		Setting:     user.Setting,
		Email:       user.Email,
		ExpiredTime: user.ExpiredTime,
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

func (user *User) GetSetting() dto.UserSetting {
	setting := dto.UserSetting{}
	if user.Setting != "" {
		err := json.Unmarshal([]byte(user.Setting), &setting)
		if err != nil {
			common.SysLog("failed to unmarshal setting: " + err.Error())
		}
	}
	return setting
}

func (user *User) SetSetting(setting dto.UserSetting) {
	settingBytes, err := json.Marshal(setting)
	if err != nil {
		common.SysLog("failed to marshal setting: " + err.Error())
		return
	}
	user.Setting = string(settingBytes)
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
	configBytes, err := json.Marshal(defaultConfig)
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
	if email == "" {
		err = DB.Unscoped().First(&user, "username = ?", username).Error
	} else {
		err = DB.Unscoped().First(&user, "username = ? or email = ?", username, email).Error
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

func GetMaxUserId() int {
	var user User
	DB.Unscoped().Last(&user)
	return user.Id
}

func GetAllUsers(pageInfo *common.PageInfo) (users []*User, total int64, err error) {
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
	err = tx.Unscoped().Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Omit("password").Find(&users).Error
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

func SearchUsers(keyword string, group string, startIdx int, num int) ([]*User, int64, error) {
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

	// 尝试将关键字转换为整数ID
	keywordInt, err := strconv.Atoi(keyword)
	if err == nil {
		// 如果是数字，同时搜索ID和其他字段
		likeCondition = "id = ? OR " + likeCondition
		if group != "" {
			query = query.Where("("+likeCondition+") AND "+commonGroupCol+" = ?",
				keywordInt, "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", group)
		} else {
			query = query.Where(likeCondition,
				keywordInt, "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
		}
	} else {
		// 非数字关键字，只搜索字符串字段
		if group != "" {
			query = query.Where("("+likeCondition+") AND "+commonGroupCol+" = ?",
				"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", group)
		} else {
			query = query.Where(likeCondition,
				"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
		}
	}

	// 获取总数
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = query.Omit("password").Order("id desc").Limit(num).Offset(startIdx).Find(&users).Error
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
		err = DB.Omit("password").First(&user, "id = ?", id).Error
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
	err := DB.Unscoped().Delete(&User{}, "id = ?", id).Error
	return err
}

func inviteUser(inviterId int) (err error) {
	if _, err = GetUserById(inviterId, true); err != nil {
		return err
	}
	updates := map[string]interface{}{
		"aff_count": gorm.Expr("aff_count + ?", 1),
	}
	if common.QuotaForInviter > 0 {
		updates["aff_quota"] = gorm.Expr("aff_quota + ?", common.QuotaForInviter)
		updates["aff_history"] = gorm.Expr("aff_history + ?", common.QuotaForInviter)
	}
	return DB.Model(&User{}).Where("id = ?", inviterId).Updates(updates).Error
}

func (user *User) TransferAffQuotaToQuota(quota int) error {
	// 检查quota是否小于最小额度
	if float64(quota) < common.QuotaPerUnit {
		return fmt.Errorf("转移额度最小为%s！", logger.LogQuota(int(common.QuotaPerUnit)))
	}

	// 开始数据库事务
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback() // 确保在函数退出时事务能回滚

	// 加锁查询用户以确保数据一致性
	err := tx.Set("gorm:query_option", "FOR UPDATE").First(&user, user.Id).Error
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

func (user *User) Insert(inviterId int) error {
	var err error
	if user.Password != "" {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	user.Quota = common.QuotaForNewUser
	//user.SetAccessToken(common.GetUUID())
	user.AffCode = common.GetRandomString(4)
	if user.RegisterTime == 0 {
		user.RegisterTime = common.GetTimestamp()
	}

	// 初始化用户设置，包括默认的边栏配置
	if user.Setting == "" {
		defaultSetting := dto.UserSetting{}
		// 这里暂时不设置SidebarModules，因为需要在用户创建后根据角色设置
		user.SetSetting(defaultSetting)
	}

	result := DB.Create(user)
	if result.Error != nil {
		return result.Error
	}

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
	if inviterId != 0 {
		if common.QuotaForInvitee > 0 {
			_ = IncreaseUserQuota(user.Id, common.QuotaForInvitee, true)
			RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", logger.LogQuota(common.QuotaForInvitee)))
		}
		_ = inviteUser(inviterId)
		if common.QuotaForInviter > 0 {
			RecordLog(inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", logger.LogQuota(common.QuotaForInviter)))
		}
	}
	return nil
}

// InsertWithTx inserts a new user within an existing transaction.
// This is used for OAuth registration where user creation and binding need to be atomic.
// Post-creation tasks (sidebar config, logs, inviter rewards) are handled after the transaction commits.
func (user *User) InsertWithTx(tx *gorm.DB, inviterId int) error {
	var err error
	if user.Password != "" {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	user.Quota = common.QuotaForNewUser
	user.AffCode = common.GetRandomString(4)
	if user.RegisterTime == 0 {
		user.RegisterTime = common.GetTimestamp()
	}

	// 初始化用户设置
	if user.Setting == "" {
		defaultSetting := dto.UserSetting{}
		user.SetSetting(defaultSetting)
	}

	result := tx.Create(user)
	if result.Error != nil {
		return result.Error
	}

	return nil
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
	if inviterId != 0 {
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
	var err error
	if updatePassword {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	newUser := *user
	DB.First(&user, user.Id)
	if err = DB.Model(user).Updates(newUser).Error; err != nil {
		return err
	}

	// Update cache
	return updateUserCache(*user)
}

// EditableUserFields 管理员可编辑字段的 JSON 键 -> 数据库列映射
var EditableUserFields = map[string]string{
	"username":     "username",
	"display_name": "display_name",
	"group":        "group",
	"quota":        "quota",
	"remark":       "remark",
	"expired_time": "expired_time",
}

// Edit 更新管理员可编辑的用户字段。
//
// provided 是本次请求里**实际提交过**的 JSON 键集合，只有其中的字段才会被写库。
// 这一点至关重要：GORM 用 map 更新时不会跳过零值，早先版本无条件写入全部字段，
// 于是前端没提交的字段会被解码成 Go 零值再覆盖进库——后台只改分组却把用户额度
// 清零就是这么来的（前端为走原子调额接口，提交时特意剔除了 quota）。
// provided 为 nil 时不更新任何业务字段，避免调用方漏传集合就静默清库。
func (user *User) Edit(updatePassword bool, provided map[string]struct{}) error {
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
		"expired_time": newUser.ExpiredTime,
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

	DB.First(&user, user.Id)
	if len(updates) > 0 {
		if err = DB.Model(user).Updates(updates).Error; err != nil {
			return err
		}
	}

	// Update cache
	return updateUserCache(*user)
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

	if err := DB.Model(&User{}).Where("id = ?", user.Id).Update(column, "").Error; err != nil {
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
	if err := DB.Delete(user).Error; err != nil {
		return err
	}

	// 清除缓存
	return invalidateUserCache(user.Id)
}

func (user *User) HardDelete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	err := DB.Unscoped().Delete(user).Error
	return err
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
	return DB.Unscoped().Where("email = ?", email).Find(&User{}).RowsAffected == 1
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
	hashedPassword, err := common.Password2Hash(password)
	if err != nil {
		return err
	}
	err = DB.Model(&User{}).Where("email = ?", email).Update("password", hashedPassword).Error
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

//// IsUserEnabled checks user status from Redis first, falls back to DB if needed
//func IsUserEnabled(id int, fromDB bool) (status bool, err error) {
//	defer func() {
//		// Update Redis cache asynchronously on successful DB read
//		if shouldUpdateRedis(fromDB, err) {
//			gopool.Go(func() {
//				if err := updateUserStatusCache(id, status); err != nil {
//					common.SysError("failed to update user status cache: " + err.Error())
//				}
//			})
//		}
//	}()
//	if !fromDB && common.RedisEnabled {
//		// Try Redis first
//		status, err := getUserStatusCache(id)
//		if err == nil {
//			return status == common.UserStatusEnabled, nil
//		}
//		// Don't return error - fall through to DB
//	}
//	fromDB = true
//	var user User
//	err = DB.Where("id = ?", id).Select("status").Find(&user).Error
//	if err != nil {
//		return false, err
//	}
//
//	return user.Status == common.UserStatusEnabled, nil
//}

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
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserQuotaCache(id, quota); err != nil {
					common.SysLog("failed to update user quota cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		quota, err := getUserQuotaCache(id)
		if err == nil {
			return quota, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
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
				if err := updateUserGroupCache(id, group); err != nil {
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
	gopool.Go(func() {
		err := cacheIncrUserQuota(id, int64(quota))
		if err != nil {
			common.SysLog("failed to increase user quota: " + err.Error())
		}
	})
	if !db && common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuota, id, quota)
		return nil
	}
	return increaseUserQuota(id, quota)
}

func increaseUserQuota(id int, quota int) (err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Update("quota", gorm.Expr("quota + ?", quota)).Error
	if err != nil {
		return err
	}
	return err
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

func UpdateUserUsedQuotaAndRequestCount(id int, quota int) {
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUsedQuota, id, quota)
		addNewRecord(BatchUpdateTypeRequestCount, id, 1)
		return
	}
	updateUserUsedQuotaAndRequestCount(id, quota, 1)
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

func updateUserUsedQuota(id int, quota int) {
	err := DB.Model(&User{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"used_quota": gorm.Expr("used_quota + ?", quota),
		},
	).Error
	if err != nil {
		common.SysLog("failed to update user used quota: " + err.Error())
	}
}

func updateUserRequestCount(id int, count int) {
	err := DB.Model(&User{}).Where("id = ?", id).Update("request_count", gorm.Expr("request_count + ?", count)).Error
	if err != nil {
		common.SysLog("failed to update user request count: " + err.Error())
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
