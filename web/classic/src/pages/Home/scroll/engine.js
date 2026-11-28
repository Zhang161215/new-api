/* Synai996 3-Page Homepage Engine (3D Split-Flap Clock, Dynamic Model Matrix, Live Simulator & Mini Wheel) */

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeHost(rawUrl, fallback = 'api.synai996.space') {
  try {
    const u = new URL(rawUrl);
    if (u.hostname && !['localhost', '127.0.0.1'].includes(u.hostname)) {
      return u.hostname;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function versionRank(name) {
  const nums = String(name || '').match(/\d+(?:\.\d+)?/g);
  if (!nums) return 0;
  return nums.reduce((acc, n, i) => acc + parseFloat(n) * Math.pow(100, Math.max(0, 2 - i)), 0);
}

function pickTopModels(names, matcher, limit = 2) {
  const matched = [...new Set(names.filter((n) => matcher(n.toLowerCase())))];
  matched.sort((a, b) => versionRank(b) - versionRank(a) || a.length - b.length);
  return matched.slice(0, limit);
}

export function mountScrollHome(root, opts = {}) {
  if (!root) return () => {};

  const cleanups = [];
  const intervals = [];
  const timeouts = [];
  let rafId = 0;
  let disposed = false;

  const addListener = (target, type, fn, options) => {
    if (!target) return;
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  const setTimer = (fn, ms) => {
    const id = window.setTimeout(fn, ms);
    timeouts.push(id);
    return id;
  };

  const setTick = (fn, ms) => {
    const id = window.setInterval(fn, ms);
    intervals.push(id);
    return id;
  };

  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => Array.from(root.querySelectorAll(sel));

  // Brand, domain & links hydration
  const brandName = opts.systemName || 'Synai996';
  const docsUrl = opts.tutorialUrl || 'https://doc.synai996.space/';
  const apiHost = normalizeHost(opts.apiBaseUrl, 'api.synai996.space');
  const apiBase = `https://${apiHost}`;
  const siteDomain = normalizeHost(opts.siteUrl, 'synai996.space');

  const brandEl = q('#sx-brand-name');
  if (brandEl) brandEl.textContent = brandName;
  const footerBrand = q('#sx-footer-brand');
  if (footerBrand) footerBrand.textContent = brandName;
  const footerDomain = q('#sx-footer-domain');
  if (footerDomain) footerDomain.textContent = siteDomain;
  const endpointHostEl = q('#sx-endpoint-host');
  if (endpointHostEl) endpointHostEl.textContent = apiHost;
  const logoEl = q('#sx-brand-logo');
  if (logoEl && opts.logo) {
    logoEl.src = opts.logo;
    logoEl.alt = brandName;
    addListener(logoEl, 'error', () => {
      const span = document.createElement('span');
      span.className = 'brand-mark-fallback';
      span.textContent = brandName.slice(0, 1).toUpperCase();
      logoEl.replaceWith(span);
    });
  }
  ['#sx-nav-docs', '#sx-footer-docs'].forEach((id) => {
    const a = q(id);
    if (a) a.href = docsUrl;
  });

  // React Router internal navigation interception
  qa('a[data-nav]').forEach((a) => {
    addListener(a, 'click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const to = a.getAttribute('data-nav');
      if (to && typeof opts.navigate === 'function') {
        e.preventDefault();
        opts.navigate(to);
      }
    });
  });

  // Toast helper
  let toastTid = 0;
  const showToast = (msg) => {
    const el = q('#sx-toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    window.clearTimeout(toastTid);
    toastTid = setTimer(() => {
      el.hidden = true;
    }, 2200);
  };

  // Theme initialization & toggle
  const savedTheme = (() => {
    try {
      return localStorage.getItem('synai_home_theme') || 'dark';
    } catch {
      return 'dark';
    }
  })();
  const applyTheme = (theme) => {
    const isLight = theme === 'light';
    root.dataset.theme = isLight ? 'light' : 'dark';
    const txt = q('#sx-theme-text');
    if (txt) txt.textContent = isLight ? '切曜石深空' : '切极昼陶瓷';
    try {
      localStorage.setItem('synai_home_theme', isLight ? 'light' : 'dark');
    } catch {
      /* ignore */
    }
  };
  applyTheme(savedTheme);
  addListener(q('#sx-theme-toggle'), 'click', () => {
    applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
  });

  /* =====================================================================
     1. 3D MECHANICAL SPLIT-FLAP CLOCK ENGINE (WITH CASCADE FLIP-IN)
     ===================================================================== */
  const launchMs = Date.parse(opts.launchedAt || '2025-12-03T00:00:00+08:00');
  const flapRegistry = {};

  const mountFlapCard = (el, initialChar) => {
    el.innerHTML = `
      <div class="sf-half sf-top"><span class="val-top-s">${initialChar}</span></div>
      <div class="sf-half sf-bot"><span class="val-bot-s">${initialChar}</span></div>
      <div class="sf-half sf-top sf-flap-top"><span class="val-top-f">${initialChar}</span></div>
      <div class="sf-half sf-bot sf-flap-bot"><span class="val-bot-f">${initialChar}</span></div>
      <div class="sf-crease"></div>
    `;
    return {
      el,
      cur: initialChar,
      topS: el.querySelector('.val-top-s'),
      botS: el.querySelector('.val-bot-s'),
      topF: el.querySelector('.val-top-f'),
      botF: el.querySelector('.val-bot-f'),
      timer: 0,
    };
  };

  const flipTo = (key, nextChar) => {
    const f = flapRegistry[key];
    if (!f || f.cur === nextChar) return;
    const oldChar = f.cur;
    f.cur = nextChar;
    f.el.classList.remove('flipping');
    void f.el.offsetWidth;
    f.topS.textContent = nextChar;
    f.botS.textContent = oldChar;
    f.topF.textContent = oldChar;
    f.botF.textContent = nextChar;
    f.el.classList.add('flipping');
    window.clearTimeout(f.timer);
    f.timer = setTimer(() => {
      f.botS.textContent = nextChar;
      f.topF.textContent = nextChar;
      f.el.classList.remove('flipping');
    }, 510);
  };

  const getClockChars = () => {
    const sec = Math.max(0, Math.floor((Date.now() - launchMs) / 1000));
    const totalDays = Math.floor(sec / 86400);
    const navDays = q('#sx-nav-days');
    if (navDays) navDays.textContent = String(totalDays);
    const d3Card = q('[data-sf="d3"]');
    const has4Digits = totalDays >= 1000;
    if (d3Card) d3Card.hidden = !has4Digits;
    const dStr = String(totalDays).padStart(has4Digits ? 4 : 3, '0');
    const hStr = String(Math.floor(sec / 3600) % 24).padStart(2, '0');
    const mStr = String(Math.floor(sec / 60) % 60).padStart(2, '0');
    const sStr = String(sec % 60).padStart(2, '0');
    return {
      d3: has4Digits ? dStr[0] : '0',
      d0: has4Digits ? dStr[1] : dStr[0],
      d1: has4Digits ? dStr[2] : dStr[1],
      d2: has4Digits ? dStr[3] : dStr[2],
      h0: hStr[0],
      h1: hStr[1],
      m0: mStr[0],
      m1: mStr[1],
      s0: sStr[0],
      s1: sStr[1],
    };
  };

  const keysOrder = ['d3', 'd0', 'd1', 'd2', 'h0', 'h1', 'm0', 'm1', 's0', 's1'];
  keysOrder.forEach((k) => {
    const el = q(`[data-sf="${k}"]`);
    if (el) flapRegistry[k] = mountFlapCard(el, '0');
  });
  const initChars = getClockChars();
  keysOrder.forEach((k, idx) => {
    setTimer(() => flipTo(k, initChars[k]), 100 + idx * 65);
  });
  setTick(() => {
    const chars = getClockChars();
    keysOrder.forEach((k) => flipTo(k, chars[k]));
  }, 1000);

  /* =====================================================================
     2. 3-PAGE CHAPTER PAGING RAIL
     ===================================================================== */
  const sections = qa('.chapter-sec');
  const dots = qa('.pager-dot');
  const idxLabel = q('#sx-pager-idx');
  let currentSec = 0;

  const setActiveDot = (i) => {
    currentSec = Math.max(0, Math.min(sections.length - 1, i));
    dots.forEach((d, idx) => d.classList.toggle('active', idx === currentSec));
    if (idxLabel) idxLabel.textContent = `0${currentSec + 1}/0${sections.length}`;
  };

  const goSection = (i) => {
    const target = Math.max(0, Math.min(sections.length - 1, i));
    setActiveDot(target);
    sections[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  dots.forEach((d) => addListener(d, 'click', () => goSection(Number(d.dataset.sec))));
  qa('a[href^="#sx-sec-"]').forEach((a) => {
    addListener(a, 'click', (e) => {
      const m = (a.getAttribute('href') || '').match(/^#sx-sec-(\d+)$/);
      if (!m) return;
      e.preventDefault();
      goSection(Number(m[1]));
    });
  });
  addListener(q('#sx-pg-prev'), 'click', () => goSection(currentSec - 1));
  addListener(q('#sx-pg-next'), 'click', () => goSection(currentSec + 1));
  addListener(window, 'keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'PageDown') {
      e.preventDefault();
      goSection(currentSec + 1);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      goSection(currentSec - 1);
    }
  });

  const secObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) setActiveDot(Number(en.target.dataset.chapter));
      });
    },
    { threshold: 0.42 },
  );
  sections.forEach((s) => secObs.observe(s));
  cleanups.push(() => secObs.disconnect());

  /* =====================================================================
     3. LIVE STREAMING API SIMULATOR
     ===================================================================== */
  const PG_DATA = {
    claude: {
      file: 'REQUEST · CLAUDE CODE (ANTHROPIC)',
      raw: `export ANTHROPIC_BASE_URL="${apiBase}"\nexport ANTHROPIC_AUTH_TOKEN="sk-synai996-live-..."\n\n# 原生协议直通，完整保留 Prompt Cache\nclaude -p "排查并发扣费行锁并输出 Go 修复补丁"`,
      reply: `✓ 已命中 Prompt Cache（18,400 tokens，输入费用立省 84%）\n\n1. 在扣减用户余额前，对目标账户行加 FOR UPDATE 行锁；\n2. 结算扣费与日志落库解耦，避免长事务阻塞高并发请求；\n3. 流式中断或空流自动退回预扣额度，确保账单零误差。`,
      ttft: '286ms',
      tps: '94 tok/s',
      cache: '-84%',
      inTok: 420,
      cacheTok: 18400,
      outTok: 128,
      cost: 0.0086,
    },
    codex: {
      file: 'REQUEST · CODEX CLI (RESPONSES API)',
      raw: `export OPENAI_BASE_URL="${apiBase}/v1"\nexport OPENAI_API_KEY="sk-synai996-live-..."\n\n# 原生 Responses 流与工具调用无损透传\ncodex --model gpt-5.6-sol "重构前端路由并补齐单测"`,
      reply: `✓ OpenAI Responses 原生通道已连接\n\n已完成 4 个组件拆分与类型检查：\n• 移除冗余轮询，接口负载下降 78%\n• 全部 Vitest 回归测试通过（16/16 passed）。`,
      ttft: '264ms',
      tps: '116 tok/s',
      cache: '-62%',
      inTok: 510,
      cacheTok: 9600,
      outTok: 104,
      cost: 0.0054,
    },
    openai: {
      file: 'REQUEST · OPENAI PYTHON SDK',
      raw: `from openai import OpenAI\n\nclient = OpenAI(\n  base_url="${apiBase}/v1",\n  api_key="sk-synai996-live-..."\n)\nresp = client.chat.completions.create(\n  model="gpt-6-luna", stream=True,\n  messages=[{"role": "user", "content": "优化慢查询索引"}]\n)`,
      reply: `✓ 已连接高可用 OpenAI 原生通道\n\n建议为 logs(user_id, created_at DESC) 建立覆盖索引：\n- 看板近 24 小时统计扫描行数减少 96%\n- 配合冷热表分离，生产库查询稳定在 15ms 内。`,
      ttft: '272ms',
      tps: '118 tok/s',
      cache: '-54%',
      inTok: 310,
      cacheTok: 4200,
      outTok: 96,
      cost: 0.0042,
    },
    gemini: {
      file: 'REQUEST · GEMINI NATIVE API',
      raw: `curl "${apiBase}/v1beta/models/gemini-3.8-flash:streamGenerateContent" \\\n  -H "x-goog-api-key: sk-synai996-live-..." \\\n  -d '{"contents":[{"parts":[{"text":"提炼 200 页架构文档要点"}]}]}'`,
      reply: `✓ Gemini 3.8 原生多模态通道已连接\n\n核心架构亮点提炼完毕：\n• 蓝绿平滑发布 + 自动探活切换\n• 网关统一错误契约（category + retryable）\n• 全链路高稳定连接与边缘缓存加速。`,
      ttft: '248ms',
      tps: '142 tok/s',
      cache: '-68%',
      inTok: 1240,
      cacheTok: 64000,
      outTok: 108,
      cost: 0.0078,
    },
  };

  const highlightCode = (src) =>
    escapeHtml(src)
      .replace(/(#.*)$/gm, '<span class="syn-cm">$1</span>')
      .replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="syn-str">$1</span>')
      .replace(/\b(export|from|import|curl|claude|codex|True|False)\b/g, '<span class="syn-kw">$1</span>')
      .replace(
        /\b(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|OPENAI_BASE_URL|OPENAI_API_KEY|base_url|api_key|model|stream)\b/g,
        '<span class="syn-var">$1</span>',
      );

  let curPg = 'claude';
  let streamTimer = 0;

  const updateXray = (inT, cacheT, outT, costVal) => {
    const setT = (id, v) => {
      const el = q(id);
      if (el) el.textContent = v;
    };
    setT('#sx-xr-in', inT.toLocaleString());
    setT('#sx-xr-cache', cacheT.toLocaleString());
    setT('#sx-xr-out', outT.toLocaleString());
    setT('#sx-xr-cost', `$${costVal.toFixed(4)}`);
  };

  const runStream = (text, statusLabel, isWarn, metrics) => {
    window.clearInterval(streamTimer);
    const out = q('#sx-pg-stream-out');
    const st = q('#sx-pg-status');
    if (!out || !st) return;
    st.textContent = statusLabel;
    st.className = `status-chip mono${isWarn ? ' warn' : ''}`;
    let i = 0;
    out.innerHTML = '<span class="term-cursor"></span>';
    if (metrics) updateXray(metrics.inTok, metrics.cacheTok, 0, 0);
    streamTimer = setTick(() => {
      i += 3;
      const prog = Math.min(1, i / text.length);
      if (metrics) {
        updateXray(metrics.inTok, metrics.cacheTok, Math.round(metrics.outTok * prog), metrics.cost * prog);
      }
      if (i >= text.length) {
        out.textContent = text;
        st.textContent = isWarn ? 'HTTP 200 · AUTO RECOVERED' : 'HTTP 200 · COMPLETED';
        st.className = 'status-chip mono';
        window.clearInterval(streamTimer);
      } else {
        out.innerHTML = `${escapeHtml(text.slice(0, i))}<span class="term-cursor"></span>`;
      }
    }, 20);
  };

  const selectPg = (k, autoRun = false) => {
    curPg = k;
    const d = PG_DATA[k];
    if (!d) return;
    const fileEl = q('#sx-pg-file');
    const codeEl = q('#sx-pg-code');
    if (fileEl) fileEl.textContent = d.file;
    if (codeEl) codeEl.innerHTML = highlightCode(d.raw);
    const setT = (id, v) => {
      const el = q(id);
      if (el) el.textContent = v;
    };
    setT('#sx-pg-ttft', d.ttft);
    setT('#sx-pg-tps', d.tps);
    setT('#sx-pg-cache', d.cache);
    qa('#sx-pg-tabs .pg-tab').forEach((b) => b.classList.toggle('active', b.dataset.pg === k));
    if (autoRun) {
      runStream(d.reply, 'HTTP 200 · STREAMING', false, d);
    } else {
      window.clearInterval(streamTimer);
      const out = q('#sx-pg-stream-out');
      const st = q('#sx-pg-status');
      if (out) out.textContent = d.reply;
      if (st) {
        st.textContent = 'HTTP 200 · OK';
        st.className = 'status-chip mono';
      }
      updateXray(d.inTok, d.cacheTok, d.outTok, d.cost);
    }
  };

  qa('#sx-pg-tabs .pg-tab').forEach((b) => addListener(b, 'click', () => selectPg(b.dataset.pg, true)));
  addListener(q('#sx-btn-run-stream'), 'click', () => selectPg(curPg, true));
  addListener(q('#sx-btn-run-retry'), 'click', () => {
    const demo = `[00:00.14] 上游节点 #1 返回 HTTP 429 (category="rate_limited", retryable=true)\n[00:00.18] 网关层自动切换至健康节点 #2，失败不重复扣费\n[00:00.42] ✓ HTTP 200 OK · 客户端流式连接零感知恢复！\n\n// 标准化结构化错误契约示例：\n{"error":{"category":"upstream_error","retryable":true,"message":"..."}}`;
    runStream(demo, 'AUTO RECOVERY · REROUTING', true, {
      inTok: 420,
      cacheTok: 18400,
      outTok: 92,
      cost: 0.0068,
    });
  });
  addListener(q('#sx-pg-copy'), 'click', () => {
    navigator.clipboard?.writeText(PG_DATA[curPg].raw).catch(() => {});
    showToast('✓ 接入代码已复制到剪贴板');
  });
  selectPg('claude', false);

  /* =====================================================================
     4. HERO LIVE MODEL MATRIX & 28-BAR RESPONSE PULSE + /api/pricing HYDRATION
     ===================================================================== */
  const barsWrap = q('#sx-gw-bars');
  const barEls = [];
  if (barsWrap) {
    for (let i = 0; i < 28; i += 1) {
      const s = document.createElement('span');
      s.style.height = '40%';
      barsWrap.appendChild(s);
      barEls.push(s);
    }
  }

  const MODELS = [
    {
      pg: 'claude',
      title: 'Claude 5.5 · 近期首字响应波动',
      stat: '平均 286ms · 缓存省 84%',
      note: '支持 Opus 5.5 / Sonnet 5.5 / Fable 5 · 适配 Claude Code',
      base: 44,
      spread: 24,
    },
    {
      pg: 'codex',
      title: 'GPT-6 / Codex · 近期首字响应波动',
      stat: '平均 264ms · 速率 116 tok/s',
      note: '支持 gpt-6-luna / gpt-5.6-sol · Responses 原生直通',
      base: 38,
      spread: 22,
    },
    {
      pg: 'gemini',
      title: 'Gemini 3.8 · 近期首字响应波动',
      stat: '平均 248ms · 超长上下文',
      note: '支持 gemini-3.8-flash / pro · 原生多模态流式输出',
      base: 42,
      spread: 20,
    },
    {
      pg: 'openai',
      title: 'DeepSeek V4 / 生图 · 近期首字响应波动',
      stat: '平均 195ms · 高并发池',
      note: '支持 deepseek-v4 与 gpt-image-2.5 / nano-banana-2',
      base: 30,
      spread: 18,
    },
  ];

  let activeIdx = 0;

  const renderBars = (seedShift = 0) => {
    const m = MODELS[activeIdx];
    barEls.forEach((el, i) => {
      const wave = Math.sin((i + seedShift) * 0.65) * 0.5 + Math.cos((i + seedShift) * 1.1) * 0.5;
      const pct = Math.max(20, Math.min(96, Math.round(m.base + wave * m.spread)));
      el.style.height = `${pct}%`;
    });
  };

  const focusModel = (idx) => {
    activeIdx = idx;
    const m = MODELS[idx];
    qa('#sx-gw-matrix .gw-model-card').forEach((el) => {
      el.classList.toggle('is-active', Number(el.dataset.gm) === idx);
    });
    const pt = q('#sx-gw-pulse-title');
    const ps = q('#sx-gw-pulse-stat');
    const pn = q('#sx-gw-pulse-note');
    if (pt) pt.textContent = m.title;
    if (ps) ps.textContent = m.stat;
    if (pn) pn.textContent = m.note;
    renderBars(idx * 3.1);
  };

  qa('#sx-gw-matrix .gw-model-card').forEach((btn) => {
    addListener(btn, 'click', () => focusModel(Number(btn.dataset.gm)));
  });
  addListener(q('#sx-gw-try-link'), 'click', () => selectPg(MODELS[activeIdx].pg, true));
  focusModel(0);
  let barStep = 0;
  setTick(() => {
    barStep += 0.7;
    renderBars(barStep);
  }, 2400);

  // Dynamically hydrate latest live model names from /api/pricing so matrix never goes stale
  fetch('/api/pricing', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (disposed || !body?.success || !Array.isArray(body.data) || !body.data.length) return;
      const names = body.data.map((m) => String(m.model_name || '')).filter(Boolean);
      const claudeTop = pickTopModels(names, (s) => s.includes('claude'), 2);
      const gptTop = pickTopModels(names, (s) => (s.startsWith('gpt-') || s.includes('codex')) && !s.includes('image'), 2);
      const gemTop = pickTopModels(names, (s) => s.includes('gemini'), 2);
      const dsImgTop = [
        ...pickTopModels(names, (s) => s.includes('deepseek'), 1),
        ...pickTopModels(names, (s) => s.includes('image') || s.includes('banana'), 1),
      ];
      const patches = [
        { idx: 0, items: claudeTop, prefix: '支持 ', suffix: ' · 适配 Claude Code' },
        { idx: 1, items: gptTop, prefix: '支持 ', suffix: ' · Responses 原生直通' },
        { idx: 2, items: gemTop, prefix: '支持 ', suffix: ' · 原生多模态流式输出' },
        { idx: 3, items: dsImgTop, prefix: '支持 ', suffix: ' · 高并发稳定直通' },
      ];
      patches.forEach(({ idx, items, prefix, suffix }) => {
        if (!items.length) return;
        const subEl = q(`[data-gm-sub="${idx}"]`);
        if (subEl) subEl.textContent = items.join(' · ');
        MODELS[idx].note = `${prefix}${items.join(' / ')}${suffix}`;
      });
      focusModel(activeIdx);
    })
    .catch(() => {});

  /* =====================================================================
     5. 1:1 CALCULATOR + LIVE INTERACTIVE MINI 3D LUCKY WHEEL
     ===================================================================== */
  const LOTTERY_TIERS = [
    [1000, 20],
    [500, 10],
    [200, 5],
    [100, 3],
    [50, 2],
    [10, 1],
  ];
  const ASC_TIERS = [...LOTTERY_TIERS].reverse();

  const updateCalc = (val) => {
    const rmb = Math.max(10, Math.min(1000, Number(val) || 10));
    let tickets = 0;
    let hitMin = 10;
    for (const [min, t] of LOTTERY_TIERS) {
      if (rmb >= min) {
        tickets = t;
        hitMin = min;
        break;
      }
    }
    const ev = tickets * 0.53;
    const setT = (id, v) => {
      const el = q(id);
      if (el) el.textContent = v;
    };
    setT('#sx-calc-rmb', `¥${rmb}`);
    setT('#sx-calc-credit', `¥${rmb.toFixed(2)}`);
    setT('#sx-calc-tickets', `+${tickets} 次`);
    setT('#sx-calc-ev', `+$${ev.toFixed(2)}`);
    setT('#sx-wheel-ticket-badge', `本单可抽 +${tickets} 次`);

    let nextTier = null;
    for (const [min, t] of ASC_TIERS) {
      if (rmb < min) {
        nextTier = [min, t];
        break;
      }
    }
    setT(
      '#sx-tier-delta',
      nextTier ? `再充 ¥${nextTier[0] - rmb} 升至 +${nextTier[1]} 次` : '已达最高档位 +20 次',
    );
    qa('#sx-tier-ladder .tier-step').forEach((b) => {
      const amt = Number(b.dataset.amt);
      b.classList.toggle('reached', rmb >= amt);
      b.classList.toggle('current', amt === hitMin);
    });
  };

  addListener(q('#sx-calc-slider'), 'input', (e) => updateCalc(e.target.value));
  qa('#sx-tier-ladder .tier-step').forEach((b) => {
    addListener(b, 'click', () => {
      const slider = q('#sx-calc-slider');
      if (slider) slider.value = b.dataset.amt;
      updateCalc(b.dataset.amt);
    });
  });
  updateCalc(200);

  // Mini 3D Lucky Wheel Canvas
  const canvas = q('#mini-wheel-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const W = 456;
    const H = 456;
    const CX = W / 2;
    const CY = H / 2;

    const SLICES = [
      { label: '$10', full: '$10.00 算力头奖', fill: '#f59e0b', ink: '#1a1103', weight: 6 },
      { label: '$0.25', full: '$0.25 体验奖', fill: '#1e293b', ink: '#e2e8f0', weight: 28 },
      { label: '$1', full: '$1.00 进阶奖', fill: '#0284c7', ink: '#f8fafc', weight: 18 },
      { label: '谢谢', full: '谢谢参与（演示）', fill: '#0f172a', ink: '#94a3b8', weight: 16 },
      { label: '$5', full: '$5.00 幸运奖', fill: '#6366f1', ink: '#f8fafc', weight: 10 },
      { label: '$0.5', full: '$0.50 常用奖', fill: '#1e3a5f', ink: '#bae6fd', weight: 22 },
    ];

    let angle = 0;
    let spinning = false;
    let spinStart = 0;
    const spinDur = 3200;
    let startAngle = 0;
    let targetAngle = 0;
    let chosenIdx = 0;

    const drawWheel = (now) => {
      if (disposed) return;
      const ledTick = now * 0.004;
      if (spinning) {
        const p = Math.min(1, (now - spinStart) / spinDur);
        const ease = 1 - Math.pow(1 - p, 4);
        angle = startAngle + (targetAngle - startAngle) * ease;
        if (p >= 1) {
          spinning = false;
          const prize = SLICES[chosenIdx];
          const bar = q('#sx-demo-spin-status');
          if (bar) {
            bar.innerHTML =
              prize.label === '谢谢'
                ? '演示结果：<strong>谢谢参与</strong> — 正式转盘欢迎实测手气，再来一次！'
                : `演示抽中 <strong style="color:var(--amber);">${escapeHtml(prize.full)}</strong> — 正式站将自动兑换并秒充到钱包余额！`;
          }
          showToast(
            prize.label === '谢谢' ? '试转结果：谢谢参与，再试一次' : `✦ 试转抽中 ${prize.full}（演示）`,
          );
        }
      } else {
        angle += 0.0025;
      }

      ctx.clearRect(0, 0, W, H);
      const rimGrad = ctx.createLinearGradient(0, 0, W, H);
      rimGrad.addColorStop(0, '#fde68a');
      rimGrad.addColorStop(0.5, '#f59e0b');
      rimGrad.addColorStop(1, '#b45309');
      ctx.beginPath();
      ctx.arc(CX, CY, 214, 0, Math.PI * 2);
      ctx.fillStyle = rimGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(CX, CY, 192, 0, Math.PI * 2);
      ctx.fillStyle = '#090e1c';
      ctx.fill();

      for (let i = 0; i < 18; i += 1) {
        const a = (i / 18) * Math.PI * 2;
        const lx = CX + Math.cos(a) * 203;
        const ly = CY + Math.sin(a) * 203;
        const lit = (Math.floor(ledTick) + i) % 3 === 0;
        ctx.beginPath();
        ctx.arc(lx, ly, lit ? 5.2 : 4.2, 0, Math.PI * 2);
        ctx.fillStyle = lit ? '#ffffff' : 'rgba(255, 248, 220, 0.45)';
        if (lit) {
          ctx.shadowColor = '#fef08a';
          ctx.shadowBlur = 12;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      const sliceArc = (Math.PI * 2) / SLICES.length;
      ctx.save();
      ctx.translate(CX, CY);
      ctx.rotate(angle);
      SLICES.forEach((s, i) => {
        const a0 = i * sliceArc - Math.PI / 2;
        const a1 = a0 + sliceArc;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 186, a0, a1);
        ctx.closePath();
        ctx.fillStyle = s.fill;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.save();
        ctx.rotate(a0 + sliceArc / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '800 28px "Maple Mono NF CN", ui-monospace, sans-serif';
        ctx.fillStyle = s.ink;
        ctx.fillText(s.label, 162, 0);
        ctx.restore();
      });
      ctx.restore();

      const sheen = ctx.createRadialGradient(CX - 50, CY - 70, 20, CX, CY, 190);
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
      sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.beginPath();
      ctx.arc(CX, CY, 186, 0, Math.PI * 2);
      ctx.fillStyle = sheen;
      ctx.fill();

      rafId = window.requestAnimationFrame(drawWheel);
    };
    rafId = window.requestAnimationFrame(drawWheel);

    const triggerSpin = () => {
      if (spinning) return;
      spinning = true;
      const totalW = SLICES.reduce((s, x) => s + x.weight, 0);
      let r = Math.random() * totalW;
      chosenIdx = 0;
      for (let i = 0; i < SLICES.length; i += 1) {
        r -= SLICES[i].weight;
        if (r <= 0) {
          chosenIdx = i;
          break;
        }
      }
      const sliceArc = (Math.PI * 2) / SLICES.length;
      const desiredMod = (Math.PI * 2 - (((chosenIdx + 0.5) * sliceArc) % (Math.PI * 2))) % (Math.PI * 2);
      const curMod = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const delta = (desiredMod - curMod + Math.PI * 2) % (Math.PI * 2);
      startAngle = angle;
      targetAngle = angle + Math.PI * 2 * 5 + delta;
      spinStart = performance.now();
      const status = q('#sx-demo-spin-status');
      if (status) status.textContent = '转盘高速旋转中，正在开奖...';
    };

    addListener(q('#sx-demo-spin-btn'), 'click', triggerSpin);
    addListener(q('#sx-demo-spin-btn-2'), 'click', triggerSpin);
  }

  // Hydrate real prize odds from /api/lottery when available
  fetch('/api/lottery', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (disposed || !body?.success || !Array.isArray(body.data?.prizes)) return;
      const prizes = body.data.prizes.filter((p) => Number(p.quota) > 0 && Number(p.odds) > 0);
      if (!prizes.length) return;
      prizes.sort((a, b) => Number(b.quota) - Number(a.quota));
      const panel = q('#sx-odds-panel');
      if (panel) {
        panel.innerHTML = prizes
          .slice(0, 5)
          .map((p, idx) => {
            const val = Number(p.odds);
            const pct = Number.isInteger(val) ? val : Number(val.toFixed(1));
            return `<div class="odds-row${idx === 0 ? ' jackpot' : ''}"><span class="odds-prize">${escapeHtml(p.label || `$${p.quota}`)}</span><span class="odds-pct">概率 ${pct}%</span></div>`;
          })
          .join('');
      }
      const winRate = body.data.prizes
        .filter((p) => (Number(p.quota) > 0 || p.extra_ticket) && Number(p.odds) > 0)
        .reduce((sum, p) => sum + Number(p.odds), 0);
      const badge = q('#sx-win-rate-badge');
      if (badge && winRate > 0) {
        badge.textContent = `综合中奖率 ${Math.round(winRate)}%`;
      }
    })
    .catch(() => {});

  /* =====================================================================
     6. CURSOR SPOTLIGHT, MAGNETIC BUTTONS, REVEAL & ENDPOINT COPY
     ===================================================================== */
  const bentoCards = qa('.bento');
  addListener(
    document,
    'pointermove',
    (e) => {
      bentoCards.forEach((card) => {
        const r = card.getBoundingClientRect();
        const pad = 210;
        const near =
          e.clientX >= r.left - pad &&
          e.clientX <= r.right + pad &&
          e.clientY >= r.top - pad &&
          e.clientY <= r.bottom + pad;
        card.style.setProperty('--lit', near ? '1' : '0');
        if (near) {
          card.style.setProperty('--mx', `${e.clientX - r.left}px`);
          card.style.setProperty('--my', `${e.clientY - r.top}px`);
        }
      });
    },
    { passive: true },
  );

  qa('.mag-btn').forEach((btn) => {
    addListener(btn, 'pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) * 0.15;
      const dy = (e.clientY - (r.top + r.height / 2)) * 0.2;
      btn.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    });
    addListener(btn, 'pointerleave', () => {
      btn.style.transform = '';
    });
  });

  const revealObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) en.target.classList.add('is-in');
      });
    },
    { threshold: 0.1 },
  );
  qa('.reveal').forEach((el) => revealObs.observe(el));
  cleanups.push(() => revealObs.disconnect());

  addListener(q('#sx-hero-copy-endpoint'), 'click', () => {
    navigator.clipboard?.writeText(apiBase).catch(() => {});
    showToast(`✓ 已复制 ${apiBase}`);
  });

  return () => {
    disposed = true;
    window.cancelAnimationFrame(rafId);
    intervals.forEach((id) => window.clearInterval(id));
    timeouts.forEach((id) => window.clearTimeout(id));
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  };
}
