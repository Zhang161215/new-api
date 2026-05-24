// Package service — Affiliate Rebate Auto-release Ticker
//
// Copyright (C) 2024 QuantumNous
// Licensed under the AGPL v3 License (see project LICENSE).
package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	affiliateRebateTickInterval = 1 * time.Minute
	affiliateRebateBatchSize    = 300
)

var (
	affiliateRebateOnce    sync.Once
	affiliateRebateRunning atomic.Bool
)

// StartAffiliateRebateTask 在 main 中调用，启动 pending → released 的定时任务。
// 只在 master node 启动，单实例环境下也安全（sync.Once）。
func StartAffiliateRebateTask() {
	affiliateRebateOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("affiliate rebate release task started: tick=%s", affiliateRebateTickInterval))
			ticker := time.NewTicker(affiliateRebateTickInterval)
			defer ticker.Stop()

			runAffiliateRebateOnce()
			for range ticker.C {
				runAffiliateRebateOnce()
			}
		})
	})
}

func runAffiliateRebateOnce() {
	if !affiliateRebateRunning.CompareAndSwap(false, true) {
		return
	}
	defer affiliateRebateRunning.Store(false)

	ctx := context.Background()
	total := 0
	for {
		n, err := model.ReleaseDueAffRebates(affiliateRebateBatchSize)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("affiliate rebate release task failed: %v", err))
			return
		}
		if n == 0 {
			break
		}
		total += n
		if n < affiliateRebateBatchSize {
			break
		}
	}
	if common.DebugEnabled && total > 0 {
		logger.LogDebug(ctx, "affiliate rebate released %d records", total)
	}
}
