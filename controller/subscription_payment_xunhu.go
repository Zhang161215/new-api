package controller

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

type SubscriptionXunhuPayRequest struct {
	PlanId        int    `json:"plan_id"`
	PaymentMethod string `json:"payment_method"`
}

func SubscriptionRequestXunhuPay(c *gin.Context) {
	var req SubscriptionXunhuPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	if operation_setting.XunhuPayAppId == "" || operation_setting.XunhuPayAppSecret == "" {
		common.ApiErrorMsg(c, "虎皮椒支付未配置")
		return
	}

	// 虎皮椒只支持 wxpay
	if req.PaymentMethod != "wxpay" && req.PaymentMethod != "alipay" {
		common.ApiErrorMsg(c, "虎皮椒仅支持微信/支付宝")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "套餐金额过低")
		return
	}

	userId := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}

	tradeNo := fmt.Sprintf("SUBUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().Unix())
	callBackAddress := service.GetCallbackAddress()
	notifyUrl := callBackAddress + "/api/subscription/xunhu/notify"
	returnUrl := system_setting.ServerAddress + "/console/subscription?pay=pending"

	xunhuType := "wechat"
	if req.PaymentMethod == "alipay" {
		xunhuType = "alipay"
	}

	params := map[string]string{
		"version":        "1.1",
		"appid":          operation_setting.XunhuPayAppId,
		"trade_order_id": tradeNo,
		"total_fee":      strconv.FormatFloat(plan.PriceAmount, 'f', 2, 64),
		"title":          fmt.Sprintf("订阅:%s", plan.Title),
		"time":           strconv.FormatInt(time.Now().Unix(), 10),
		"notify_url":     notifyUrl,
		"return_url":     returnUrl,
		"nonce_str":      common.GetRandomString(32),
		"type":           xunhuType,
		"wap_name":       "NewAPI",
	}
	params["hash"] = xunhuSign(params, operation_setting.XunhuPayAppSecret)

	formData := url.Values{}
	for k, v := range params {
		formData.Set(k, v)
	}

	resp, err := http.PostForm(operation_setting.XunhuPayApiUrl, formData)
	if err != nil {
		log.Printf("虎皮椒订阅下单请求失败: %v", err)
		common.ApiErrorMsg(c, "支付请求失败")
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		common.ApiErrorMsg(c, "读取支付响应失败")
		return
	}

	var result map[string]interface{}
	if err := common.Unmarshal(body, &result); err != nil {
		log.Printf("虎皮椒订阅响应解析失败: %s", string(body))
		common.ApiErrorMsg(c, "支付响应解析失败")
		return
	}

	errcode, _ := result["errcode"].(float64)
	if int(errcode) != 0 {
		errmsg, _ := result["errmsg"].(string)
		log.Printf("虎皮椒订阅下单失败: %v", result)
		common.ApiErrorMsg(c, fmt.Sprintf("支付失败: %s", errmsg))
		return
	}

	order := &model.SubscriptionOrder{
		UserId:        userId,
		PlanId:        plan.Id,
		Money:         plan.PriceAmount,
		TradeNo:       tradeNo,
		PaymentMethod: req.PaymentMethod,
		CreateTime:    time.Now().Unix(),
		Status:        common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}

	payUrl, _ := result["url"].(string)
	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data":    payUrl,
	})
}

func SubscriptionXunhuNotify(c *gin.Context) {
	if err := c.Request.ParseForm(); err != nil {
		log.Println("虎皮椒订阅回调解析失败:", err)
		c.String(200, "fail")
		return
	}

	params := make(map[string]string)
	for k, v := range c.Request.Form {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}

	if len(params) == 0 {
		c.String(200, "fail")
		return
	}

	hash := params["hash"]
	expectedHash := xunhuSign(params, operation_setting.XunhuPayAppSecret)
	if hash != expectedHash {
		log.Printf("虎皮椒订阅回调签名验证失败: got=%s expected=%s", hash, expectedHash)
		c.String(200, "fail")
		return
	}

	if params["status"] != "OD" {
		log.Printf("虎皮椒订阅回调非成功状态: %s", params["status"])
		c.String(200, "success")
		return
	}

	tradeNo := params["trade_order_id"]
	if tradeNo == "" {
		c.String(200, "fail")
		return
	}

	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)

	if err := model.CompleteSubscriptionOrder(tradeNo, common.GetJsonString(params)); err != nil {
		log.Printf("虎皮椒订阅回调完成订单失败: tradeNo=%s err=%v", tradeNo, err)
		c.String(200, "fail")
		return
	}

	c.String(200, "success")
}
