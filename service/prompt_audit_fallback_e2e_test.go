package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
)

// fakeAuditNode 造一个 OpenAI 兼容的假审核节点。
// mode 决定它的行为，用来复现线上遇到的各类失败。
func fakeAuditNode(mode string, hits *int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits != nil {
			atomic.AddInt32(hits, 1)
		}
		reply := func(content string) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{"message": map[string]string{"content": content}},
				},
			})
		}
		switch mode {
		case "verdict_clean":
			reply(`{"confidence": 0.00, "reason": ""}`)
		case "verdict_hit":
			reply(`{"confidence": 0.95, "reason": "色情角色扮演请求"}`)
		// 小米 mimo 实测行为：HTTP 200，拒答文本放在 content 里
		case "moderation_200":
			reply("The request was rejected because it was considered high risk")
		// 部分网关风控时返回 4xx + JSON
		case "moderation_400":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"内容审核不通过","type":"content_filter"}}`))
		case "rate_limited":
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"Too many requests"}}`))
		case "server_error":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":{"message":"internal"}}`))
		// 审核模型被待审内容劫持，输出了任务结果而不是裁决
		case "hijacked":
			reply(`{"id": 5688, "name": "常熟开关/塑壳断路器", "reason": "匹配类目"}`)
		case "truncated":
			reply(`{"confidence": 0.9`)
		default:
			reply(`{"confidence": 0.00, "reason": ""}`)
		}
	}))
}

func e2eCfg(primaryURL string) *operation_setting.PromptAuditSetting {
	return &operation_setting.PromptAuditSetting{
		BaseURL:     primaryURL + "/v1",
		APIKey:      "sk-test",
		Model:       "primary-model",
		Threshold:   0.6,
		TimeoutMs:   5000,
		CacheTTLSec: 0, // 关缓存，避免用例间互相污染
	}
}

func TestFallback_ModerationRefusalIsClassified(t *testing.T) {
	ResetPromptAuditFallbackStats()
	// 无备用节点时，风控拒答必须能被上层识别出来（中间件据此拒绝而非放行）
	for _, mode := range []string{"moderation_200", "moderation_400"} {
		srv := fakeAuditNode(mode, nil)
		defer srv.Close()
		_, _, err := RunPromptAudit(context.Background(), e2eCfg(srv.URL), "任意内容")
		assert.Error(t, err, mode)
		assert.True(t, IsPromptAuditModerationRefusal(err),
			"%s 应被判定为风控拒答，否则会被 fail-open 放行", mode)
	}
}

func TestFallback_TransportFailuresAreNotModeration(t *testing.T) {
	// 超时/限流/5xx 与内容无关，不能误判成风控拒答，否则正常抖动会变成拒绝用户
	for _, mode := range []string{"rate_limited", "server_error"} {
		srv := fakeAuditNode(mode, nil)
		defer srv.Close()
		_, _, err := RunPromptAudit(context.Background(), e2eCfg(srv.URL), "任意内容")
		assert.Error(t, err, mode)
		assert.False(t, IsPromptAuditModerationRefusal(err), "%s 不应算风控拒答", mode)
		assert.Equal(t, PromptAuditFailTransport, PromptAuditFailKindOf(err), mode)
	}
}

func TestFallback_UnparsableClassified(t *testing.T) {
	// 被劫持与被截断都属于「拿到响应但没有裁决」，应归为 unparsable 而非风控拒答
	for _, mode := range []string{"hijacked", "truncated"} {
		srv := fakeAuditNode(mode, nil)
		defer srv.Close()
		_, _, err := RunPromptAudit(context.Background(), e2eCfg(srv.URL), "任意内容")
		assert.Error(t, err, mode)
		assert.Equal(t, PromptAuditFailUnparsable, PromptAuditFailKindOf(err), mode)
		assert.False(t, IsPromptAuditModerationRefusal(err), mode)
	}
}

func TestFallback_ModerationRefusalFallsBackAndGetsVerdict(t *testing.T) {
	ResetPromptAuditFallbackStats()
	var primaryHits, fbHits int32
	// 主节点风控拒答（模拟 mimo 对 CSAM 的反应），备用节点能给出判定
	primary := fakeAuditNode("moderation_200", &primaryHits)
	defer primary.Close()
	fb := fakeAuditNode("verdict_hit", &fbHits)
	defer fb.Close()

	cfg := e2eCfg(primary.URL)
	cfg.FallbackEnabled = true
	cfg.FallbackBaseURL = fb.URL + "/v1"
	cfg.FallbackAPIKey = "sk-fb"
	cfg.FallbackModel = "fallback-model"
	assert.True(t, cfg.FallbackReady())

	conf, reason, err := RunPromptAudit(context.Background(), cfg, "涉未成年人性内容")
	assert.NoError(t, err, "备用节点应救回判定，而不是让请求走 fail-open")
	assert.Equal(t, 0.95, conf)
	assert.Contains(t, reason, "色情")
	assert.Equal(t, int32(1), atomic.LoadInt32(&primaryHits))
	assert.Equal(t, int32(1), atomic.LoadInt32(&fbHits))

	total, mod, ok := GetPromptAuditFallbackStats()
	assert.Equal(t, int64(1), total)
	assert.Equal(t, int64(1), mod, "应记录为风控拒答触发的回退")
	assert.Equal(t, int64(1), ok)
	ResetPromptAuditFallbackStats()
}

func TestFallback_NotTriggeredWhenPrimarySucceeds(t *testing.T) {
	ResetPromptAuditFallbackStats()
	var primaryHits, fbHits int32
	primary := fakeAuditNode("verdict_clean", &primaryHits)
	defer primary.Close()
	fb := fakeAuditNode("verdict_hit", &fbHits)
	defer fb.Close()

	cfg := e2eCfg(primary.URL)
	cfg.FallbackEnabled = true
	cfg.FallbackBaseURL = fb.URL + "/v1"
	cfg.FallbackModel = "fallback-model"

	conf, _, err := RunPromptAudit(context.Background(), cfg, "正常开发内容")
	assert.NoError(t, err)
	assert.Equal(t, 0.0, conf)
	// 主节点成功时绝不能打备用节点，否则成本翻倍
	assert.Equal(t, int32(1), atomic.LoadInt32(&primaryHits))
	assert.Equal(t, int32(0), atomic.LoadInt32(&fbHits))
	total, _, _ := GetPromptAuditFallbackStats()
	assert.Equal(t, int64(0), total)
	ResetPromptAuditFallbackStats()
}

func TestFallback_BothFailKeepsModerationKind(t *testing.T) {
	ResetPromptAuditFallbackStats()
	// 主节点风控拒答、备用节点也拒答：分类必须仍是 moderation，
	// 否则中间件会退化成 fail-open 把最危险的内容放行
	primary := fakeAuditNode("moderation_200", nil)
	defer primary.Close()
	fb := fakeAuditNode("moderation_400", nil)
	defer fb.Close()

	cfg := e2eCfg(primary.URL)
	cfg.FallbackEnabled = true
	cfg.FallbackBaseURL = fb.URL + "/v1"
	cfg.FallbackModel = "fallback-model"

	_, _, err := RunPromptAudit(context.Background(), cfg, "极端违规内容")
	assert.Error(t, err)
	assert.True(t, IsPromptAuditModerationRefusal(err),
		"两级都拒答时仍应保持风控拒答分类")
	// 错误信息要能看出两级都失败，便于排障
	assert.Contains(t, err.Error(), "主节点失败")
	ResetPromptAuditFallbackStats()
}

func TestFallback_TransportFailureRecoveredByFallback(t *testing.T) {
	ResetPromptAuditFallbackStats()
	// 主节点限流，备用节点正常：应无损恢复
	primary := fakeAuditNode("rate_limited", nil)
	defer primary.Close()
	fb := fakeAuditNode("verdict_clean", nil)
	defer fb.Close()

	cfg := e2eCfg(primary.URL)
	cfg.FallbackEnabled = true
	cfg.FallbackBaseURL = fb.URL + "/v1"
	cfg.FallbackModel = "fallback-model"

	conf, _, err := RunPromptAudit(context.Background(), cfg, "正常内容")
	assert.NoError(t, err)
	assert.Equal(t, 0.0, conf)

	total, mod, ok := GetPromptAuditFallbackStats()
	assert.Equal(t, int64(1), total)
	assert.Equal(t, int64(0), mod, "传输失败不该计入风控拒答")
	assert.Equal(t, int64(1), ok)
	ResetPromptAuditFallbackStats()
}

func TestAudit_IgnoresCanceledParentContext(t *testing.T) {
	// 复现线上：Codex 取消连接后主备都 context canceled，再 fail-open。
	// 父 ctx 已取消时，审核仍应打到节点并拿到裁决。
	var hits int32
	srv := fakeAuditNode("verdict_clean", &hits)
	defer srv.Close()

	parent, cancel := context.WithCancel(context.Background())
	cancel()

	conf, _, err := RunPromptAudit(parent, e2eCfg(srv.URL), "正常开发内容")
	assert.NoError(t, err)
	assert.Equal(t, 0.0, conf)
	assert.Equal(t, int32(1), atomic.LoadInt32(&hits), "父 ctx 取消后仍应完成审核")
}

func TestFallback_WorksWhenParentCanceled(t *testing.T) {
	ResetPromptAuditFallbackStats()
	primary := fakeAuditNode("rate_limited", nil)
	defer primary.Close()
	var fbHits int32
	fb := fakeAuditNode("verdict_clean", &fbHits)
	defer fb.Close()

	cfg := e2eCfg(primary.URL)
	cfg.FallbackEnabled = true
	cfg.FallbackBaseURL = fb.URL + "/v1"
	cfg.FallbackModel = "fallback-model"

	parent, cancel := context.WithCancel(context.Background())
	cancel()

	conf, _, err := RunPromptAudit(parent, cfg, "正常内容")
	assert.NoError(t, err)
	assert.Equal(t, 0.0, conf)
	assert.Equal(t, int32(1), atomic.LoadInt32(&fbHits), "父 ctx 取消后备用节点仍应能救回")
	ResetPromptAuditFallbackStats()
}

func TestFallback_DisabledKeepsSingleNodeBehavior(t *testing.T) {
	ResetPromptAuditFallbackStats()
	var fbHits int32
	primary := fakeAuditNode("rate_limited", nil)
	defer primary.Close()
	fb := fakeAuditNode("verdict_clean", &fbHits)
	defer fb.Close()

	cfg := e2eCfg(primary.URL)
	// 开关关闭：即使填了备用节点也不能打过去（默认升级行为与旧版一致）
	cfg.FallbackEnabled = false
	cfg.FallbackBaseURL = fb.URL + "/v1"
	cfg.FallbackModel = "fallback-model"

	_, _, err := RunPromptAudit(context.Background(), cfg, "内容")
	assert.Error(t, err)
	assert.Equal(t, int32(0), atomic.LoadInt32(&fbHits))
	total, _, _ := GetPromptAuditFallbackStats()
	assert.Equal(t, int64(0), total)
	ResetPromptAuditFallbackStats()
}

func TestFallback_CacheStillWorksWithFallback(t *testing.T) {
	ResetPromptAuditFallbackStats()
	var primaryHits, fbHits int32
	primary := fakeAuditNode("moderation_200", &primaryHits)
	defer primary.Close()
	fb := fakeAuditNode("verdict_hit", &fbHits)
	defer fb.Close()

	cfg := e2eCfg(primary.URL)
	cfg.CacheTTLSec = 60
	cfg.FallbackEnabled = true
	cfg.FallbackBaseURL = fb.URL + "/v1"
	cfg.FallbackModel = "fallback-model"

	input := fmt.Sprintf("需要缓存的内容-%d", atomic.LoadInt32(&primaryHits))
	for i := 0; i < 3; i++ {
		conf, _, err := RunPromptAudit(context.Background(), cfg, input)
		assert.NoError(t, err)
		assert.Equal(t, 0.95, conf)
	}
	// 备用节点救回的判定同样要进缓存，否则每次都要打两个节点
	assert.Equal(t, int32(1), atomic.LoadInt32(&primaryHits), "后续请求应命中缓存")
	assert.Equal(t, int32(1), atomic.LoadInt32(&fbHits))
	ResetPromptAuditFallbackStats()
}
