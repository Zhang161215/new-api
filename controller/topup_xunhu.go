package controller

import (
	"crypto/md5"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// xunhuSign 虎皮椒签名算法
// 按参数名 ASCII 升序排列，拼接 key=value&，最后拼接 AppSecret，取 MD5
func xunhuSign(params map[string]string, appSecret string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "hash" || params[k] == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var buf strings.Builder
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte('&')
		}
		buf.WriteString(k)
		buf.WriteByte('=')
		buf.WriteString(params[k])
	}
	buf.WriteString(appSecret)

	h := md5.New()
	io.WriteString(h, buf.String())
	return fmt.Sprintf("%x", h.Sum(nil))
}

// RequestXunhuPay 虎皮椒下单
func RequestXunhuPay(c *gin.Context) {
	var req EpayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	if req.Amount < getMinTopup() {
		c.JSON(200, gin.H{"message": "error", "data": fmt.Sprintf("充值数量不能小于 %d", getMinTopup())})
		return
	}

	if operation_setting.XunhuPayAppId == "" || operation_setting.XunhuPayAppSecret == "" {
		c.JSON(200, gin.H{"message": "error", "data": "虎皮椒支付未配置"})
		return
	}

	// 虎皮椒只支持 wxpay/alipay
	if req.PaymentMethod != "wxpay" && req.PaymentMethod != "alipay" {
		c.JSON(200, gin.H{"message": "error", "data": "虎皮椒仅支持微信/支付宝"})
		return
	}

	id := c.GetInt("id")
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	payMoney := getPayMoney(req.Amount, group)
	if payMoney < 0.01 {
		c.JSON(200, gin.H{"message": "error", "data": "充值金额过低"})
		return
	}

	tradeNo := fmt.Sprintf("USR%dNO%s%d", id, common.GetRandomString(6), time.Now().Unix())
	callBackAddress := service.GetCallbackAddress()
	notifyUrl := callBackAddress + "/api/user/xunhu/notify"
	returnUrl := system_setting.ServerAddress + "/console/log"

	// 虎皮椒支付类型映射
	xunhuType := "wechat"
	if req.PaymentMethod == "alipay" {
		xunhuType = "alipay"
	}

	params := map[string]string{
		"version":        "1.1",
		"appid":          operation_setting.XunhuPayAppId,
		"trade_order_id": tradeNo,
		"total_fee":      strconv.FormatFloat(payMoney, 'f', 2, 64),
		"title":          fmt.Sprintf("充值%d额度", req.Amount),
		"time":           strconv.FormatInt(time.Now().Unix(), 10),
		"notify_url":     notifyUrl,
		"return_url":     returnUrl,
		"nonce_str":      common.GetRandomString(32),
		"type":           xunhuType,
		"wap_name":       "NewAPI",
	}
	params["hash"] = xunhuSign(params, operation_setting.XunhuPayAppSecret)

	// POST 到虎皮椒网关
	formData := url.Values{}
	for k, v := range params {
		formData.Set(k, v)
	}

	resp, err := http.PostForm(operation_setting.XunhuPayApiUrl, formData)
	if err != nil {
		log.Printf("虎皮椒下单请求失败: %v", err)
		c.JSON(200, gin.H{"message": "error", "data": "支付请求失败"})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "读取支付响应失败"})
		return
	}

	var result map[string]interface{}
	if err := common.Unmarshal(body, &result); err != nil {
		log.Printf("虎皮椒响应解析失败: %s", string(body))
		c.JSON(200, gin.H{"message": "error", "data": "支付响应解析失败"})
		return
	}

	errcode, _ := result["errcode"].(float64)
	if int(errcode) != 0 {
		errmsg, _ := result["errmsg"].(string)
		log.Printf("虎皮椒下单失败: %v", result)
		c.JSON(200, gin.H{"message": "error", "data": fmt.Sprintf("支付失败: %s", errmsg)})
		return
	}

	// 创建订单记录
	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount := decimal.NewFromInt(int64(amount))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		amount = dAmount.Div(dQuotaPerUnit).IntPart()
	}
	topUp := &model.TopUp{
		UserId:        id,
		Amount:        amount,
		Money:         payMoney,
		TradeNo:       tradeNo,
		PaymentMethod: req.PaymentMethod,
		CreateTime:    time.Now().Unix(),
		Status:        "pending",
	}
	if err := topUp.Insert(); err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	// 返回支付链接
	payUrl, _ := result["url"].(string)
	urlQrcode, _ := result["url_qrcode"].(string)

	c.JSON(200, gin.H{
		"message":    "success",
		"data":       payUrl,
		"url_qrcode": urlQrcode,
	})
}

// XunhuPayNotify 虎皮椒支付回调
func XunhuPayNotify(c *gin.Context) {
	if err := c.Request.ParseForm(); err != nil {
		log.Println("虎皮椒回调解析失败:", err)
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
		log.Println("虎皮椒回调参数为空")
		c.String(200, "fail")
		return
	}

	// 验签
	hash := params["hash"]
	expectedHash := xunhuSign(params, operation_setting.XunhuPayAppSecret)
	if hash != expectedHash {
		log.Printf("虎皮椒回调签名验证失败: got=%s expected=%s", hash, expectedHash)
		c.String(200, "fail")
		return
	}

	// 检查支付状态
	status := params["status"]
	if status != "OD" {
		log.Printf("虎皮椒回调非成功状态: %s", status)
		c.String(200, "success")
		return
	}

	tradeNo := params["trade_order_id"]
	if tradeNo == "" {
		log.Println("虎皮椒回调缺少 trade_order_id")
		c.String(200, "fail")
		return
	}

	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)

	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		log.Printf("虎皮椒回调未找到订单: %s", tradeNo)
		c.String(200, "fail")
		return
	}

	if topUp.Status == "pending" {
		topUp.Status = "success"
		if err := topUp.Update(); err != nil {
			log.Printf("虎皮椒回调更新订单失败: %v", topUp)
			c.String(200, "fail")
			return
		}

		dAmount := decimal.NewFromInt(int64(topUp.Amount))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd := int(dAmount.Mul(dQuotaPerUnit).IntPart())
		if err := model.IncreaseUserQuota(topUp.UserId, quotaToAdd, true); err != nil {
			log.Printf("虎皮椒回调更新用户额度失败: %v", topUp)
			c.String(200, "fail")
			return
		}
		log.Printf("虎皮椒回调充值成功: userId=%d, amount=%d, money=%.2f", topUp.UserId, topUp.Amount, topUp.Money)
		model.RecordLog(topUp.UserId, model.LogTypeTopup, fmt.Sprintf("使用虎皮椒在线充值成功，充值金额: %v，支付金额：%f", logger.LogQuota(quotaToAdd), topUp.Money))
		if completed := model.GetTopUpByTradeNo(tradeNo); completed != nil {
			model.FireAffiliateRebate(completed)
		}
	}

	c.String(200, "success")
}
