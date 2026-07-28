package service

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestAutoBanCooldownOnlyGatesActionsNotJudgement(t *testing.T) {
	ResetPromptAuditAutoBanStats()
	const uid = 90001

	// 关键回归：冷却曾被放在「判定之前」，导致第 1 次命中（未达阈值）就占满冷却位，
	// 之后 5 分钟内即使越过阈值也封不上——攻击者持续发送即可永久逃脱。
	// 正确语义是：冷却只在「已达阈值、准备执行动作」时才判，未达阈值不占位。
	assert.True(t, autoBanActionAllowed(uid), "首次执行动作应允许")
	assert.False(t, autoBanActionAllowed(uid), "冷却期内重复动作应被抑制")

	// 冷却到期后可再次动作（干跑模式下会再发一封告警）
	promptAuditAutoBanInflight.Store(uid, time.Now().Add(-promptAuditAutoBanCooldown-time.Second))
	assert.True(t, autoBanActionAllowed(uid), "冷却到期后应放行")
	ResetPromptAuditAutoBanStats()
}

func TestAutoBanCooldownIsPerUser(t *testing.T) {
	ResetPromptAuditAutoBanStats()
	// 一个用户触发冷却，不能影响另一个用户的封禁判定
	assert.True(t, autoBanActionAllowed(90002))
	assert.True(t, autoBanActionAllowed(90003), "不同用户应各自独立冷却")
	assert.False(t, autoBanActionAllowed(90002))
	ResetPromptAuditAutoBanStats()
}

func TestAutoBanLockIsPerUserAndReusable(t *testing.T) {
	// 同一用户拿到同一把锁，不同用户拿到不同锁
	a1 := autoBanLockFor(90101)
	a2 := autoBanLockFor(90101)
	b := autoBanLockFor(90102)
	assert.Same(t, a1, a2, "同一用户必须复用同一把锁，否则并发保护失效")
	assert.NotSame(t, a1, b, "不同用户不该互相阻塞")
}

func TestAutoBanLockSerializesConcurrentChecks(t *testing.T) {
	// 并发拿同一把锁时必须串行，避免两个 goroutine 同时判定造成重复封禁与重复告警
	lock := autoBanLockFor(90103)
	var mu sync.Mutex
	concurrent := 0
	maxConcurrent := 0
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			lock.Lock()
			mu.Lock()
			concurrent++
			if concurrent > maxConcurrent {
				maxConcurrent = concurrent
			}
			mu.Unlock()
			time.Sleep(time.Millisecond)
			mu.Lock()
			concurrent--
			mu.Unlock()
			lock.Unlock()
		}()
	}
	wg.Wait()
	assert.Equal(t, 1, maxConcurrent, "同一用户的封号判定必须串行")
}

func TestAutoBanStatsCounters(t *testing.T) {
	ResetPromptAuditAutoBanStats()
	total, dry := GetPromptAuditAutoBanStats()
	assert.Equal(t, int64(0), total)
	assert.Equal(t, int64(0), dry)

	promptAuditAutoBanTotal.Add(1)
	promptAuditAutoBanDryRun.Add(2)
	total, dry = GetPromptAuditAutoBanStats()
	assert.Equal(t, int64(1), total, "实际封禁与干跑命中必须分开计数")
	assert.Equal(t, int64(2), dry)

	ResetPromptAuditAutoBanStats()
	total, dry = GetPromptAuditAutoBanStats()
	assert.Equal(t, int64(0), total)
	assert.Equal(t, int64(0), dry)
}

func TestAutoBanHTMLDistinguishesDryRun(t *testing.T) {
	ev := PromptAuditAutoBanEvent{
		UserId: 42, Username: "baduser", Group: "default",
		Hits: 5, Threshold: 3, WindowMin: 60,
		Confidence: 0.95, Reason: "游戏外挂逆向",
		ModelName: "gpt-5.6-sol", Ip: "1.2.3.4",
		CreatedAt: time.Now(),
	}

	ev.DryRun = false
	real := promptAuditAutoBanHTML(ev)
	assert.Contains(t, real, "已被置为禁用状态")
	assert.Contains(t, real, "baduser")
	assert.Contains(t, real, "5 次")
	assert.NotContains(t, real, "干跑模式，未修改")

	ev.DryRun = true
	dryHTML := promptAuditAutoBanHTML(ev)
	assert.Contains(t, dryHTML, "干跑模式")
	assert.Contains(t, dryHTML, "未修改用户状态")
	// 干跑邮件绝不能说"已被禁用"，否则管理员会误以为真封了
	assert.NotContains(t, dryHTML, "该用户已被置为禁用状态")
}

func TestAutoBanHTMLEscapesUntrustedFields(t *testing.T) {
	// 用户名与理由都来自不可信来源，必须转义后再进邮件
	ev := PromptAuditAutoBanEvent{
		UserId:   1,
		Username: `<img src=x onerror="alert(1)">`,
		Reason:   `<script>alert(2)</script>`,
		Ip:       "1.1.1.1",
	}
	out := promptAuditAutoBanHTML(ev)
	assert.NotContains(t, out, `onerror="`)
	assert.NotContains(t, out, "<script>")
	assert.Contains(t, out, "&lt;img")
}

func TestAutoBanHTMLSkipsEmptyRows(t *testing.T) {
	// 空字段不该渲染成空行，否则邮件里一堆空白项
	ev := PromptAuditAutoBanEvent{UserId: 1, Username: "u", Hits: 3, Threshold: 3}
	out := promptAuditAutoBanHTML(ev)
	assert.NotContains(t, out, "分组</td><td style=\"padding:4px 0\"></td>")
	assert.Equal(t, 0, strings.Count(out, "><td style=\"padding:4px 0\"></td>"))
}
