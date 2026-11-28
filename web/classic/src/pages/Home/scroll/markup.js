export const SCROLL_HOME_MARKUP = `
    <div class="top-glow" aria-hidden="true"></div>
    <div class="arch-grid" aria-hidden="true"></div>
    <div class="film-grain" aria-hidden="true"></div>

    <!-- 右侧 3 页翻页导航条 -->
    <aside class="pager-rail" aria-label="章节翻页导航">
      <button type="button" class="pager-arrow" id="sx-pg-prev" title="上一页 (PageUp)">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10l4-4 4 4"/></svg>
      </button>
      <button type="button" class="pager-dot active" data-sec="0"><span class="pager-tip">01 · 运行历时与网关</span></button>
      <button type="button" class="pager-dot" data-sec="1"><span class="pager-tip">02 · 实时流式演练</span></button>
      <button type="button" class="pager-dot" data-sec="2"><span class="pager-tip">03 · 计费与幸运转盘</span></button>
      <button type="button" class="pager-arrow" id="sx-pg-next" title="下一页 (PageDown)">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <span class="pager-idx mono" id="sx-pager-idx">01/03</span>
    </aside>

    <!-- 顶部导航栏 -->
    <header class="nav-bar">
      <div class="sx-container nav-inner">
        <div class="nav-brand-group">
          <a href="#sx-sec-0" class="brand-link">
            <img id="sx-brand-logo" class="brand-logo-img" src="/synai-logo.png" alt="Synai996" />
            <span id="sx-brand-name" class="brand-name">Synai996</span>
          </a>
          <span class="uptime-pill mono">
            <span class="live-dot"></span>
            ONLINE <span id="sx-nav-days">360</span>D
          </span>
        </div>

        <nav class="nav-links" aria-label="主页导航">
          <a href="/pricing" data-nav="/pricing">模型广场</a>
          <a id="sx-nav-docs" href="https://doc.synai996.space/" target="_blank" rel="noopener noreferrer">接入文档 ↗</a>
        </nav>

        <div class="nav-actions">
          <button id="sx-theme-toggle" type="button" class="icon-toggle" title="切换曜石深空 / 极昼陶瓷主题">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="12" cy="12" r="4"></circle>
              <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"></path>
            </svg>
            <span id="sx-theme-text">切极昼陶瓷</span>
          </button>
          <a href="/console" data-nav="/console" class="mag-btn sm">
            <span>进入控制台</span>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8h9M8.5 4.5 12.5 8 8.5 11.5"/></svg>
          </a>
        </div>
      </div>
    </header>

    <!-- PAGE 01：3D 机械翻页时钟 + 旗舰模型矩阵 Hero -->
    <section id="sx-sec-0" class="hero chapter-sec" data-chapter="0">
      <div class="sx-container">
        <div class="bento uptime-monument">
          <div class="um-meta">
            <div class="um-kicker mono">
              <span class="live-dot"></span>
              <span>CONTINUOUS OPERATION · SINCE 2025.12.03</span>
            </div>
            <div class="um-title">时间，是最好的答案。</div>
            <div class="um-sub">从上线第一天起持续维护与迭代，把稳定写进每一次日常调用。</div>
          </div>

          <div class="splitflap-board" id="sx-splitflap-board" aria-label="站点持续运行时间">
            <div class="sf-group" id="sx-sf-days-group">
              <div class="sf-card is-day" data-sf="d3" hidden></div>
              <div class="sf-card is-day" data-sf="d0"></div>
              <div class="sf-card is-day" data-sf="d1"></div>
              <div class="sf-card is-day" data-sf="d2"></div>
              <span class="sf-unit">天</span>
            </div>
            <div class="sf-group">
              <div class="sf-card" data-sf="h0"></div>
              <div class="sf-card" data-sf="h1"></div>
              <span class="sf-colon mono">:</span>
              <div class="sf-card" data-sf="m0"></div>
              <div class="sf-card" data-sf="m1"></div>
              <span class="sf-colon mono">:</span>
              <div class="sf-card is-sec" data-sf="s0"></div>
              <div class="sf-card is-sec" data-sf="s1"></div>
            </div>
          </div>
        </div>

        <div class="hero-grid">
          <div class="hero-left">
            <h1 class="hero-h1">
              单一算力网关，<br />
              <span class="grad-headline">全模态模型无界直连</span>
            </h1>

            <p class="hero-desc">
              一个 API Key 原生聚合 Claude、OpenAI GPT/Codex、Gemini 与高清生图。
              坚持 <strong>1:1 余额按量透明计费</strong>，彻底去掉订阅捆绑，支持原生缓存省费与阶梯幸运大转盘回馈。
            </p>

            <div class="hero-ctas">
              <a href="/console" data-nav="/console" class="mag-btn lg">
                <span>立即获取 API Key</span>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8h9M8.5 4.5 12.5 8 8.5 11.5"/></svg>
              </a>
              <a href="#sx-sec-1" class="ghost-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>实时流式演练</span>
              </a>
              <a href="#sx-sec-2" class="amber-btn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 3"/></svg>
                <span>充值抽 $10 头奖</span>
              </a>
            </div>

            <div class="kpi-grid">
              <div class="bento kpi-card">
                <div class="kpi-k">充值比例</div>
                <div class="kpi-v mono" style="color:var(--accent);">1 : 1</div>
                <div class="kpi-s">余额永不过期</div>
              </div>
              <div class="bento kpi-card">
                <div class="kpi-k">协议兼容</div>
                <div class="kpi-v mono" style="color:var(--ok);">全原生</div>
                <div class="kpi-s">Claude / GPT / Gemini</div>
              </div>
              <div class="bento kpi-card">
                <div class="kpi-k">邀请永久返利</div>
                <div class="kpi-v mono" style="color:var(--amber);">2% 终身</div>
                <div class="kpi-s">好友每笔充值</div>
              </div>
            </div>
          </div>

          <!-- 右侧：平铺齐整的旗舰实时模型矩阵面板 -->
          <div class="bento gw-panel">
            <div class="gw-top">
              <div class="gw-status mono">
                <span class="live-dot"></span>
                <span>UNIFIED GATEWAY · 全系在线</span>
              </div>
              <button type="button" class="gw-copy-pill mono" id="sx-hero-copy-endpoint" title="点击复制统一接口地址">
                <span id="sx-endpoint-host">api.synai996.space</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>

            <div class="gw-matrix" id="sx-gw-matrix">
              <button type="button" class="gw-model-card is-active" data-gm="0">
                <div class="gm-head">
                  <span class="gm-brand">
                    <span class="gm-ico claude mono">C</span>
                    <span class="gm-title" data-gm-title="0">Claude 5.5</span>
                  </span>
                  <span class="gm-ms mono">286ms</span>
                </div>
                <div class="gm-meta">
                  <span class="gm-sub-models mono" data-gm-sub="0">Opus 5.5 · Sonnet 5.5</span>
                  <span class="gm-tag">Prompt Cache</span>
                </div>
              </button>

              <button type="button" class="gw-model-card" data-gm="1">
                <div class="gm-head">
                  <span class="gm-brand">
                    <span class="gm-ico gpt mono">O</span>
                    <span class="gm-title" data-gm-title="1">GPT-6 / Codex</span>
                  </span>
                  <span class="gm-ms mono">264ms</span>
                </div>
                <div class="gm-meta">
                  <span class="gm-sub-models mono" data-gm-sub="1">gpt-6-luna · 5.6-sol</span>
                  <span class="gm-tag">原生推理流</span>
                </div>
              </button>

              <button type="button" class="gw-model-card" data-gm="2">
                <div class="gm-head">
                  <span class="gm-brand">
                    <span class="gm-ico gemini mono">G</span>
                    <span class="gm-title" data-gm-title="2">Gemini 3.8</span>
                  </span>
                  <span class="gm-ms mono">248ms</span>
                </div>
                <div class="gm-meta">
                  <span class="gm-sub-models mono" data-gm-sub="2">gemini-3.8-flash / pro</span>
                  <span class="gm-tag">超长上下文</span>
                </div>
              </button>

              <button type="button" class="gw-model-card" data-gm="3">
                <div class="gm-head">
                  <span class="gm-brand">
                    <span class="gm-ico ds mono">D</span>
                    <span class="gm-title" data-gm-title="3">DeepSeek V4 / 生图</span>
                  </span>
                  <span class="gm-ms mono">195ms</span>
                </div>
                <div class="gm-meta">
                  <span class="gm-sub-models mono" data-gm-sub="3">V4 · gpt-image-2.5</span>
                  <span class="gm-tag">高并发稳定</span>
                </div>
              </button>
            </div>

            <div class="gw-pulse-box">
              <div class="gw-pulse-head mono">
                <span style="font-weight:800; color:var(--ink);" id="sx-gw-pulse-title">Claude 5.5 · 近期首字响应波动</span>
                <span style="color:var(--ok); font-weight:800;" id="sx-gw-pulse-stat">平均 286ms · 缓存省 84%</span>
              </div>
              <div class="gw-bars" id="sx-gw-bars" aria-hidden="true"></div>
              <div class="gw-pulse-foot mono">
                <span id="sx-gw-pulse-note">Anthropic 原生协议无损透传 · 点击上方模型切换观察</span>
                <a href="#sx-sec-1" style="color:var(--accent); font-weight:700; text-decoration:none;" id="sx-gw-try-link">去演练台实测 →</a>
              </div>
            </div>

            <div class="gw-foot">
              <div class="gw-clients">
                <span>Claude Code</span>
                <span>Codex CLI</span>
                <span>Cursor</span>
                <span>Cherry Studio</span>
              </div>
              <a href="/pricing" data-nav="/pricing" class="mono" style="color:var(--accent); font-weight:800; text-decoration:none; white-space:nowrap;">
                模型广场 →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- PAGE 02：实时流式 API 演练台 -->
    <section id="sx-sec-1" class="sec reveal chapter-sec" data-chapter="1">
      <div class="sx-container">
        <div class="sec-head">
          <div>
            <div class="eyebrow mono">02 // LIVE API SIMULATOR</div>
            <h2 class="sec-h2">不用翻死文档，现场跑一遍请求</h2>
          </div>
          <div class="action-row">
            <button id="sx-btn-run-stream" type="button" class="run-btn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              <span>模拟流式调用</span>
            </button>
            <button id="sx-btn-run-retry" type="button" class="retry-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span>模拟异常自动恢复</span>
            </button>
          </div>
        </div>

        <div class="bento" style="overflow:hidden;">
          <div class="pg-topbar">
            <div class="pg-tabs" id="sx-pg-tabs">
              <button type="button" data-pg="claude" class="pg-tab active">Claude Code</button>
              <button type="button" data-pg="codex" class="pg-tab">Codex CLI</button>
              <button type="button" data-pg="openai" class="pg-tab">OpenAI SDK</button>
              <button type="button" data-pg="gemini" class="pg-tab">Gemini 原生</button>
            </div>
            <div class="pg-metrics mono">
              <span>TTFT<strong id="sx-pg-ttft" style="color:var(--ok);">286ms</strong></span>
              <span>速率<strong id="sx-pg-tps" style="color:var(--accent);">94 tok/s</strong></span>
              <span>缓存省费<strong id="sx-pg-cache" style="color:var(--amber);">-84%</strong></span>
            </div>
          </div>

          <div class="pg-split">
            <div class="pg-pane">
              <div class="pg-pane-head">
                <span id="sx-pg-file" class="pg-label mono">REQUEST · CLAUDE CODE</span>
                <button type="button" id="sx-pg-copy" class="mini-copy">复制代码</button>
              </div>
              <pre id="sx-pg-code" class="code-pre mono"></pre>
            </div>

            <div class="pg-pane pg-pane-right">
              <div>
                <div class="pg-pane-head">
                  <span class="pg-label mono" style="color:#38bdf8;">LIVE STREAM &amp; BILLING X-RAY</span>
                  <span id="sx-pg-status" class="status-chip mono">HTTP 200 · READY</span>
                </div>
                <div id="sx-pg-stream-out" class="stream-box mono"></div>
              </div>

              <div class="xray-bar mono">
                <div><div class="xk">非缓存输入</div><strong id="sx-xr-in" style="color:#f8fafc;">420</strong></div>
                <div><div class="xk">缓存读取</div><strong id="sx-xr-cache" style="color:#34d399;">18,400</strong></div>
                <div><div class="xk">输出 Token</div><strong id="sx-xr-out" style="color:#38bdf8;">128</strong></div>
                <div><div class="xk">本次实扣</div><strong id="sx-xr-cost" style="color:#fbbf24;">$0.0086</strong></div>
              </div>
            </div>
          </div>

          <div class="pg-guarantees">
            <div class="pg-g-item"><span class="pg-g-dot"></span><span>Prompt Cache 全口径透传</span></div>
            <div class="pg-g-item"><span class="pg-g-dot" style="background:var(--ok);"></span><span>空流 / 异常自动全额退预扣</span></div>
            <div class="pg-g-item"><span class="pg-g-dot" style="background:var(--amber);"></span><span>统一结构化错误契约</span></div>
            <div class="pg-g-item"><span class="pg-g-dot" style="background:#a78bfa;"></span><span>明细账单 &amp; 自助开具收据</span></div>
          </div>
        </div>
      </div>
    </section>

    <!-- PAGE 03：1:1 计费 & 交互式幸运大转盘 -->
    <section id="sx-sec-2" class="sec reveal chapter-sec" data-chapter="2">
      <div class="sx-container">
        <div class="sec-head">
          <div>
            <div class="eyebrow mono">03 // 1:1 PAY-AS-YOU-GO &amp; LUCKY WHEEL</div>
            <h2 class="sec-h2">无订阅套路：1:1 按量直充，再送幸运大转盘</h2>
          </div>
        </div>

        <div class="calc-grid">
          <div class="bento calc-main">
            <div>
              <div class="calc-top">
                <div>
                  <div style="font-size:12px; font-weight:700; color:var(--muted); margin-bottom:6px;">拖动滑块模拟单笔充值金额（人民币）</div>
                  <div style="display:flex; align-items:center; gap:12px;">
                    <span id="sx-calc-rmb" class="calc-amount mono">¥200</span>
                    <span class="calc-tag">1:1 实付即得 · 永不过期</span>
                  </div>
                </div>
                <span class="mono" style="font-size:12px; font-weight:800; color:var(--amber);" id="sx-tier-delta">再充 ¥300 升至 +10 次</span>
              </div>

              <div style="margin-top:18px;">
                <input id="sx-calc-slider" class="hw-slider" type="range" min="10" max="1000" step="10" value="200" />
              </div>

              <div class="tier-ladder mono" id="sx-tier-ladder">
                <button type="button" class="tier-step reached" data-amt="10"><span class="ts-amt">¥10</span><span class="ts-cnt">+1 次</span></button>
                <button type="button" class="tier-step reached" data-amt="50"><span class="ts-amt">¥50</span><span class="ts-cnt">+2 次</span></button>
                <button type="button" class="tier-step reached" data-amt="100"><span class="ts-amt">¥100</span><span class="ts-cnt">+3 次</span></button>
                <button type="button" class="tier-step reached current" data-amt="200"><span class="ts-amt">¥200</span><span class="ts-cnt">+5 次</span></button>
                <button type="button" class="tier-step" data-amt="500"><span class="ts-amt">¥500</span><span class="ts-cnt">+10 次</span></button>
                <button type="button" class="tier-step" data-amt="1000"><span class="ts-amt">¥1000</span><span class="ts-cnt">+20 次</span></button>
              </div>

              <div class="calc-trio" style="margin-top:16px;">
                <div class="trio-box">
                  <div class="trio-k">1:1 钱包入账</div>
                  <div id="sx-calc-credit" class="trio-v mono" style="color:var(--ink);">¥200.00</div>
                  <div class="trio-s">按量透明扣除 · 永不清零</div>
                </div>
                <div class="trio-box amber">
                  <div class="trio-k" style="color:var(--amber);">立赠转盘次数</div>
                  <div id="sx-calc-tickets" class="trio-v mono" style="color:var(--amber);">+5 次</div>
                  <div class="trio-s">24h 内累计可阶梯补差</div>
                </div>
                <div class="trio-box">
                  <div class="trio-k">转盘期望回血</div>
                  <div id="sx-calc-ev" class="trio-v mono" style="color:var(--ok);">+$2.65</div>
                  <div class="trio-s">中奖实时直充钱包余额</div>
                </div>
              </div>

              <div class="invite-strip" style="margin-top:14px;">
                <div>
                  <div style="font-size:13px; font-weight:800; color:var(--ink);">好友每笔充值永久返 2% · 每日签到领宝箱</div>
                  <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">支持自定义多组专属邀请码、零门槛转余额；每周一签到双倍奖励。</div>
                </div>
                <a href="/console/invite" data-nav="/console/invite" class="mono" style="font-size:12px; font-weight:800; color:var(--accent); text-decoration:none; white-space:nowrap;">
                  创建邀请码 →
                </a>
              </div>
            </div>

            <div class="calc-foot">
              <span style="font-size:12px; color:var(--muted);">计费公式：<code class="mono code-inline">官方定价 × 用量 × 分组倍率</code></span>
              <a href="/console/topup" data-nav="/console/topup" class="mag-btn sm" style="height:40px; padding:0 22px;">
                <span>立即 1:1 充值</span>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8h9M8.5 4.5 12.5 8 8.5 11.5"/></svg>
              </a>
            </div>
          </div>

          <div class="bento lottery-showcase">
            <div class="ls-head">
              <div>
                <span class="pill-badge amber">AI 算力幸运大转盘</span>
                <h3 style="font-size:21px; font-weight:900; margin:10px 0 4px; color:var(--ink);">真实库存秒入账 · 最高 $10.00 头奖</h3>
                <div style="font-size:12.5px; color:var(--muted);">概率全站公开透明，单档缺货自动暂停绝不空抽。</div>
              </div>
              <span class="pill-badge ok mono" id="sx-wheel-ticket-badge">本单可抽 +5 次</span>
            </div>

            <div class="mini-wheel-stage">
              <div class="wheel-shell">
                <svg class="wheel-pointer" width="24" height="28" viewBox="0 0 24 28" aria-hidden="true">
                  <path d="M12 27L2.5 8.5C1.5 5 4.2 1.5 8 1.5h8c3.8 0 6.5 3.5 5.5 7L12 27z" fill="#f59e0b" stroke="#fffbeb" stroke-width="2"/>
                  <circle cx="12" cy="8.5" r="3.2" fill="#fffbeb"/>
                </svg>
                <canvas id="mini-wheel-canvas" width="456" height="456"></canvas>
                <button type="button" class="wheel-center-btn mono" id="sx-demo-spin-btn" title="点击试转体验">试转<br />体验</button>
              </div>

              <div class="odds-panel mono" id="sx-odds-panel">
                <div class="odds-row jackpot">
                  <span class="odds-prize">$10.00 算力头奖</span>
                  <span class="odds-pct">概率 1%</span>
                </div>
                <div class="odds-row">
                  <span class="odds-prize">$5.00 幸运奖</span>
                  <span class="odds-pct">概率 3%</span>
                </div>
                <div class="odds-row">
                  <span class="odds-prize">$1.00 进阶奖</span>
                  <span class="odds-pct">概率 10%</span>
                </div>
                <div class="odds-row">
                  <span class="odds-prize">$0.50 常用奖</span>
                  <span class="odds-pct">概率 22%</span>
                </div>
                <div class="odds-row">
                  <span class="odds-prize">$0.25 体验奖</span>
                  <span class="odds-pct">概率 27%</span>
                </div>
              </div>
            </div>

            <div class="lottery-result-bar">
              <span id="sx-demo-spin-status">点击转盘中心「试转体验」，感受抽中自动入账流程（演示不扣次数）。</span>
              <span id="sx-win-rate-badge" class="mono" style="color:var(--ok); font-weight:800; white-space:nowrap;">综合中奖率 63%</span>
            </div>

            <div class="ls-actions">
              <button type="button" id="sx-demo-spin-btn-2" class="amber-btn" style="height:40px; padding:0 18px; font-size:13px;">
                <span>试转一次</span>
              </button>
              <a href="/lottery/wheel.html" class="mag-btn sm" style="height:40px; padding:0 20px; flex:1;">
                <span>前往完整 3D 幸运大转盘</span>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8h9M8.5 4.5 12.5 8 8.5 11.5"/></svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 简洁收尾页脚 -->
    <footer class="closing-wrap">
      <div class="sx-container">
        <div class="footer-meta">
          <span><strong id="sx-footer-brand" style="color:var(--ink-2);">Synai996</strong> · 开站计时展示运营历时，不代表无故障在线时长 · <span id="sx-footer-domain">synai996.space</span></span>
          <div class="footer-links">
            <a href="/console" data-nav="/console">控制台</a>
            <a href="/pricing" data-nav="/pricing">模型广场</a>
            <a href="/lottery/wheel.html">幸运大转盘</a>
            <a id="sx-footer-docs" href="https://doc.synai996.space/" target="_blank" rel="noopener noreferrer">接入文档 ↗</a>
          </div>
        </div>
      </div>
    </footer>

    <div id="sx-toast" hidden class="sx-toast mono"></div>
`;
