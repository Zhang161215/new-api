package model

import (
	"encoding/json"
	"strings"
	"sync"
	"time"
)

const OpsCostOptionKey = "ops_cost_records"

var (
	opsCostImportOnce sync.Once
	opsCostCategories = map[string]string{
		"upstream": "上游充值",
		"account":  "账号充值",
		"server":   "服务器",
		"domain":   "域名/CDN",
		"other":    "其他",
	}
)

// OpsCostRecord 站点运营支出（上游充值、服务器、账号等），用于对照到账看成本。
type OpsCostRecord struct {
	Id         int     `json:"id" gorm:"primaryKey;autoIncrement"`
	Category   string  `json:"category" gorm:"type:varchar(32);index;not null"`
	Title      string  `json:"title" gorm:"type:varchar(64)"`
	Amount     float64 `json:"amount" gorm:"not null"`
	OccurredAt int64   `json:"occurred_at" gorm:"index;not null"`
	Note       string  `json:"note" gorm:"type:varchar(255)"`
	CreatedBy  int     `json:"created_by"`
	CreatedAt  int64   `json:"created_at"`
	UpdatedAt  int64   `json:"updated_at"`
}

func (OpsCostRecord) TableName() string {
	return "ops_cost_records"
}

func NormalizeOpsCostCategory(category string) (string, bool) {
	key := strings.TrimSpace(strings.ToLower(category))
	if key == "" {
		return "", false
	}
	if _, ok := opsCostCategories[key]; ok {
		return key, true
	}
	return "", false
}

func OpsCostCategoryLabel(category string) string {
	if label, ok := opsCostCategories[category]; ok {
		return label
	}
	return category
}

func ListOpsCosts(start, end int64) ([]OpsCostRecord, error) {
	EnsureOpsCostImported()
	q := DB.Model(&OpsCostRecord{})
	if start > 0 {
		q = q.Where("occurred_at >= ?", start)
	}
	if end > 0 {
		q = q.Where("occurred_at <= ?", end)
	}
	var items []OpsCostRecord
	err := q.Order("occurred_at DESC, id DESC").Find(&items).Error
	return items, err
}

func GetOpsCostById(id int) (*OpsCostRecord, error) {
	var item OpsCostRecord
	err := DB.First(&item, id).Error
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *OpsCostRecord) Insert() error {
	now := time.Now().Unix()
	if r.CreatedAt == 0 {
		r.CreatedAt = now
	}
	r.UpdatedAt = now
	if strings.TrimSpace(r.Title) == "" {
		r.Title = OpsCostCategoryLabel(r.Category)
	}
	return DB.Create(r).Error
}

func (r *OpsCostRecord) Update() error {
	r.UpdatedAt = time.Now().Unix()
	if strings.TrimSpace(r.Title) == "" {
		r.Title = OpsCostCategoryLabel(r.Category)
	}
	return DB.Model(r).Select("category", "title", "amount", "occurred_at", "note", "updated_at").Updates(r).Error
}

func DeleteOpsCostById(id int) error {
	return DB.Delete(&OpsCostRecord{}, id).Error
}

// EnsureOpsCostImported 把发版前暂存在 options 里的成本账导入正式表，只做一次。
func EnsureOpsCostImported() {
	opsCostImportOnce.Do(func() {
		if DB == nil {
			return
		}
		var n int64
		if err := DB.Model(&OpsCostRecord{}).Count(&n).Error; err != nil || n > 0 {
			return
		}
		var opt Option
		if err := DB.Where("key = ?", OpsCostOptionKey).First(&opt).Error; err != nil {
			return
		}
		raw := strings.TrimSpace(opt.Value)
		if raw == "" || raw == "[]" {
			return
		}
		var items []OpsCostRecord
		if err := json.Unmarshal([]byte(raw), &items); err != nil {
			return
		}
		now := time.Now().Unix()
		for i := range items {
			item := items[i]
			item.Id = 0
			category, ok := NormalizeOpsCostCategory(item.Category)
			if !ok || item.Amount <= 0 || item.OccurredAt <= 0 {
				continue
			}
			item.Category = category
			if strings.TrimSpace(item.Title) == "" {
				item.Title = OpsCostCategoryLabel(category)
			}
			if item.CreatedAt == 0 {
				item.CreatedAt = now
			}
			item.UpdatedAt = now
			_ = DB.Create(&item).Error
		}
	})
}
