package service

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// 审核判定结果缓存。
//
// agent 类流量（Codex/Cursor 等）会把同一段上下文反复重发，实测线上 12,974 次审核里
// 只有 1,840 段不同内容——重复率 85.8%，其中「继续」两个字被审了 498 次。
// 按内容 hash 缓存判定结果属于**无损**优化：既不放过任何内容，又省掉重复的调用与延迟。

const promptAuditCacheKeyPrefix = "prompt_audit_verdict:"

// promptAuditCacheEntry 无 Redis 时的进程内缓存条目
type promptAuditCacheEntry struct {
	confidence float64
	reason     string
	expireAt   time.Time
}

var (
	promptAuditMemCache   sync.Map // key -> promptAuditCacheEntry
	promptAuditCacheOnce  sync.Once
	promptAuditCacheStats struct {
		sync.Mutex
		Hit  int64
		Miss int64
	}
)

// promptAuditRedisReady 判断此刻能否安全使用 Redis。
// common.RedisEnabled 默认就是 true，而 RDB 要等 InitRedisClient 之后才存在，
// 只看开关会在「配了 Redis 但尚未连上」时对 nil 客户端解引用而 panic。
func promptAuditRedisReady() bool {
	return common.RedisEnabled && common.RDB != nil
}

// promptAuditCacheKey 由「审核模型 + 系统提示词 + 送审内容」共同决定。
// 把模型与提示词纳入指纹，管理员改了任一项，旧判定立即失效而不必手工清缓存。
func promptAuditCacheKey(cfg *operation_setting.PromptAuditSetting, userInput string) string {
	h := sha256.New()
	h.Write([]byte(cfg.Model))
	h.Write([]byte{0})
	h.Write([]byte(cfg.GetPrompt()))
	h.Write([]byte{0})
	h.Write([]byte(userInput))
	return promptAuditCacheKeyPrefix + hex.EncodeToString(h.Sum(nil))[:32]
}

// startPromptAuditCacheGC 无 Redis 时定期清掉过期条目，避免 map 无限增长
func startPromptAuditCacheGC() {
	go func() {
		for {
			time.Sleep(10 * time.Minute)
			now := time.Now()
			promptAuditMemCache.Range(func(k, v any) bool {
				if e, ok := v.(promptAuditCacheEntry); ok && now.After(e.expireAt) {
					promptAuditMemCache.Delete(k)
				}
				return true
			})
		}
	}()
}

// getPromptAuditCache 查缓存，第三个返回值表示是否命中
func getPromptAuditCache(key string) (float64, string, bool) {
	if promptAuditRedisReady() {
		raw, err := common.RedisGet(key)
		if err != nil || raw == "" {
			return 0, "", false
		}
		return decodePromptAuditVerdict(raw)
	}
	promptAuditCacheOnce.Do(startPromptAuditCacheGC)
	v, ok := promptAuditMemCache.Load(key)
	if !ok {
		return 0, "", false
	}
	entry, ok := v.(promptAuditCacheEntry)
	if !ok || time.Now().After(entry.expireAt) {
		promptAuditMemCache.Delete(key)
		return 0, "", false
	}
	return entry.confidence, entry.reason, true
}

// setPromptAuditCache 写入判定结果；缓存失败只影响性能，不影响正确性，故忽略错误
func setPromptAuditCache(key string, confidence float64, reason string, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	if promptAuditRedisReady() {
		_ = common.RedisSet(key, encodePromptAuditVerdict(confidence, reason), ttl)
		return
	}
	promptAuditCacheOnce.Do(startPromptAuditCacheGC)
	promptAuditMemCache.Store(key, promptAuditCacheEntry{
		confidence: confidence,
		reason:     reason,
		expireAt:   time.Now().Add(ttl),
	})
}

// 判定结果在 Redis 里存成 "置信度|理由"。理由本身可能含 "|"，故只按首个分隔符切分。
func encodePromptAuditVerdict(confidence float64, reason string) string {
	return strconv.FormatFloat(confidence, 'f', -1, 64) + "|" + reason
}

func decodePromptAuditVerdict(raw string) (float64, string, bool) {
	idx := strings.Index(raw, "|")
	if idx < 0 {
		return 0, "", false
	}
	conf, err := strconv.ParseFloat(raw[:idx], 64)
	if err != nil {
		return 0, "", false
	}
	return conf, raw[idx+1:], true
}

func recordPromptAuditCacheStat(hit bool) {
	promptAuditCacheStats.Lock()
	defer promptAuditCacheStats.Unlock()
	if hit {
		promptAuditCacheStats.Hit++
	} else {
		promptAuditCacheStats.Miss++
	}
}

// GetPromptAuditCacheStats 返回缓存命中统计，供后台展示实际节省效果
func GetPromptAuditCacheStats() (hit int64, miss int64, hitRate float64) {
	promptAuditCacheStats.Lock()
	defer promptAuditCacheStats.Unlock()
	hit, miss = promptAuditCacheStats.Hit, promptAuditCacheStats.Miss
	if total := hit + miss; total > 0 {
		hitRate = float64(hit) / float64(total)
	}
	return
}

// ResetPromptAuditCacheStats 清零命中统计（后台手动重置用）
func ResetPromptAuditCacheStats() {
	promptAuditCacheStats.Lock()
	defer promptAuditCacheStats.Unlock()
	promptAuditCacheStats.Hit, promptAuditCacheStats.Miss = 0, 0
}
