package controller

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type opsCostRequest struct {
	Category   string  `json:"category"`
	Title      string  `json:"title"`
	Amount     float64 `json:"amount"`
	OccurredAt int64   `json:"occurred_at"`
	Note       string  `json:"note"`
}

func roundMoney(amount float64) float64 {
	return math.Round(amount*100) / 100
}

func bindOpsCost(req opsCostRequest) (*model.OpsCostRecord, string) {
	category, ok := model.NormalizeOpsCostCategory(req.Category)
	if !ok {
		return nil, "请选择成本类别"
	}
	amount := roundMoney(req.Amount)
	if amount <= 0 {
		return nil, "金额必须大于 0"
	}
	if amount > 10000000 {
		return nil, "单笔金额过大"
	}
	if req.OccurredAt <= 0 {
		return nil, "请选择发生日期"
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > 200 {
		return nil, "备注最多 200 字"
	}
	title := strings.TrimSpace(req.Title)
	if utf8.RuneCountInString(title) > 64 {
		return nil, "名称最多 64 字"
	}
	if title == "" {
		title = model.OpsCostCategoryLabel(category)
	}
	return &model.OpsCostRecord{
		Category:   category,
		Title:      title,
		Amount:     amount,
		OccurredAt: req.OccurredAt,
		Note:       note,
	}, ""
}

func GetOpsCosts(c *gin.Context) {
	start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	items, err := model.ListOpsCosts(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if items == nil {
		items = []model.OpsCostRecord{}
	}
	var total float64
	for _, item := range items {
		total += item.Amount
	}
	common.ApiSuccess(c, gin.H{
		"items":        items,
		"total_amount": roundMoney(total),
	})
}

func CreateOpsCost(c *gin.Context) {
	var req opsCostRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	item, msg := bindOpsCost(req)
	if msg != "" {
		common.ApiErrorMsg(c, msg)
		return
	}
	item.CreatedBy = c.GetInt("id")
	if err := item.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, item)
}

func UpdateOpsCost(c *gin.Context) {
	var req struct {
		opsCostRequest
		Id int `json:"id"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if req.Id <= 0 {
		common.ApiErrorMsg(c, "缺少记录 ID")
		return
	}
	existing, err := model.GetOpsCostById(req.Id)
	if err != nil {
		common.ApiErrorMsg(c, "记录不存在")
		return
	}
	item, msg := bindOpsCost(req.opsCostRequest)
	if msg != "" {
		common.ApiErrorMsg(c, msg)
		return
	}
	existing.Category = item.Category
	existing.Title = item.Title
	existing.Amount = item.Amount
	existing.OccurredAt = item.OccurredAt
	existing.Note = item.Note
	if err := existing.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, existing)
}

func DeleteOpsCost(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的记录 ID")
		return
	}
	if _, err := model.GetOpsCostById(id); err != nil {
		common.ApiErrorMsg(c, "记录不存在")
		return
	}
	if err := model.DeleteOpsCostById(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
