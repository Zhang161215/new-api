/**
 * Synai996 额度抽奖 · UI 预览
 *
 * 对接约定：
 *   转盘  GET /api/lottery          POST /api/lottery/draw
 *   记录  GET /api/lottery/history  GET /api/lottery/tickets
 *   管理  /api/lottery/admin/*
 *   额度奖从奖品库提取兑换码发放，不直接改 users.quota
 *   无后端时回退 mock（localStorage）
 */

const STORAGE_KEY = 'synai996.lottery.v5';
const CATALOG_CACHE_KEY = 'synai996.lottery.catalog.v1';
const YOU = '你';

const WINWHEEL_PALETTE = [
  { fill: '#FCE9C4', ink: '#35507a' },
  { fill: '#C8F3E4', ink: '#35507a' },
  { fill: '#D0D6FC', ink: '#35507a' },
  { fill: '#E3D0F4', ink: '#35507a' },
  { fill: '#FDE1B6', ink: '#35507a' },
  { fill: '#BFE4FC', ink: '#35507a' },
  { fill: '#B8F0EA', ink: '#35507a' },
  { fill: '#D4E8FC', ink: '#35507a' },
];

const DEFAULT_PRIZES = [
  {
    id: 'q01',
    label: '$0.50',
    short: '0.50',
    hint: '额度',
    weight: 38,
    tier: 'common',
    fill: '#1e3a5f',
    ink: '#f4e6c1',
    quota: 0.5,
  },
  {
    id: 'thanks',
    label: '未中奖',
    short: '未中',
    hint: '再接再厉',
    weight: 37,
    tier: 'miss',
    fill: '#efe6d2',
    ink: '#1a2744',
    quota: 0,
  },
  {
    id: 'q1',
    label: '$1.00',
    short: '1.00',
    hint: '额度',
    weight: 14,
    tier: 'uncommon',
    fill: '#efe6d2',
    ink: '#1a2744',
    quota: 1,
  },
  {
    id: 'again',
    label: '再抽一次',
    short: '+1次',
    hint: '次数返还',
    weight: 8,
    tier: 'uncommon',
    fill: '#1e3a5f',
    ink: '#f4e6c1',
    quota: 0,
    extraTicket: true,
  },
  {
    id: 'q3',
    label: '$3.00',
    short: '3.00',
    hint: '额度',
    weight: 2,
    tier: 'rare',
    fill: '#efe6d2',
    ink: '#1a2744',
    quota: 3,
  },
  {
    id: 'q10',
    label: '$10.00',
    short: '$10',
    hint: '大奖',
    weight: 1,
    tier: 'legend',
    fill: '#1e3a5f',
    ink: '#f4e6c1',
    quota: 10,
  },
];

const PRIZE_COLORS = ['#0e7490', '#0891b2', '#047857', '#6d28d9', '#b45309', '#be123c'];

function makePrize(index, patch = {}) {
  return {
    id: `p${Date.now()}-${index}`,
    label: '$1.00',
    hint: `奖项 ${index + 1}`,
    seats: 1,
    quota: 1,
    ink: PRIZE_COLORS[index % PRIZE_COLORS.length],
    ...patch,
  };
}

const DEFAULT_TIMED_PRIZES = [
  { id: 't1', label: '$10.00', hint: '一等奖', seats: 1, quota: 10, ink: '#0e7490' },
  { id: 't2', label: '$5.00', hint: '二等奖', seats: 2, quota: 5, ink: '#6d28d9' },
  { id: 't3', label: '$1.00', hint: '三等奖', seats: 5, quota: 1, ink: '#047857' },
];

const NAME_SEEDS = [
  '北*舟',
  'K*ro',
  '阿*码',
  'C*dex',
  '晚*风',
  '7*7',
  '青*石',
  'M*x',
  '林*野',
  'Z*ed',
  '沈*舟',
  'H*lo',
  '顾*白',
  'N*va',
  '叶*舟',
  'R*in',
  '宋*川',
  'P*x',
];

const MOCK_FEED = [
  ['北*舟', '$0.50'],
  ['K*ro', '$1.00'],
  ['阿*码', '未中奖'],
  ['C*dex', '$0.50'],
  ['晚*风', '$2.00'],
  ['7*7', '再抽一次'],
  ['青*石', '$0.50'],
  ['M*x', '$5.00'],
];

const $ = (id) => document.getElementById(id);
const PAGE = document.body?.dataset?.page || 'join';
const PAGE_SIZE = 10;
const ADMIN_PAGE_SIZE = 20;
let adminUserPage = 1;
let adminWalletPage = 1;
let adminDrawPage = 1;
let adminCodePage = 1;
let adminTicketPage = 1;
let adminSelectedUserId = '';
let adminUserTab = 'summary';
let dashPeriod = 'today';
let dashDrawPage = 1;
let pendingCodeFiles = [];
let histDrawPage = 1;
let histLedgerPage = 1;

function debounce(fn, wait = 280) {
  let t = 0;
  return (...args) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), wait);
  };
}

function adminPager(total, page) {
  return {
    total: total || 0,
    pages: Math.max(1, Math.ceil((total || 0) / ADMIN_PAGE_SIZE)),
    current: page || 1,
  };
}

function on(id, type, handler) {
  const el = $(id);
  if (el) el.addEventListener(type, handler);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const pad = (n) => String(n).padStart(2, '0');

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function defaultDrawAt() {
  return Date.now() + 10 * 60 * 1000;
}

function seedTicketLog() {
  const t1 = Date.now() - 86400000;
  const t2 = Date.now() - 3600000;
  return [
    {
      id: 'pay-demo-2',
      delta: 1,
      reason: 'payment_grant',
      refType: 'topup',
      refId: 'TOPUP-1002',
      balanceAfter: 2,
      at: t2,
    },
    {
      id: 'pay-demo-1',
      delta: 1,
      reason: 'payment_grant',
      refType: 'topup',
      refId: 'TOPUP-1001',
      balanceAfter: 1,
      at: t1,
    },
  ];
}

function seedPublicFeed() {
  const wins = DEFAULT_PRIZES.filter((item) => item.quota > 0);
  return wins.map((prize, i) => ({
    who: NAME_SEEDS[i % NAME_SEEDS.length],
    label: prize.label,
    quota: prize.quota,
    at: Date.now() - (i + 1) * 97_000,
  }));
}

function emptyTimed() {
  return {
    name: '周末额度抽奖',
    drawAt: defaultDrawAt(),
    baseCount: 47,
    joined: false,
    joinedAt: 0,
    opened: false,
    winners: [],
    prizes: DEFAULT_TIMED_PRIZES.map((item) => ({ ...item })),
  };
}

function defaultCatalog() {
  return DEFAULT_PRIZES.map((item) => ({ ...item, enabled: true }));
}

function seedAdminDraws() {
  return Array.from({ length: 28 }, (_, i) => {
    const prize = DEFAULT_PRIZES[i % DEFAULT_PRIZES.length];
    return {
      userId: 1020 + (i % 7),
      username: NAME_SEEDS[(i + 4) % NAME_SEEDS.length],
      prizeId: prize.id,
      label: prize.label,
      quota: prize.quota || 0,
      win: Boolean(prize.quota || prize.extraTicket),
      extraTicket: Boolean(prize.extraTicket),
      at: Date.now() - (i + 1) * 5 * 3600000,
    };
  });
}

function emptyState() {
  const catalog = defaultCatalog();
  return {
    tickets: 2,
    payments: 2,
    ticketsPerPayment: 1,
    lotteryEnabled: true,
    soldOut: false,
    history: [],
    ticketLog: seedTicketLog(),
    publicFeed: seedPublicFeed(),
    prizeCatalog: catalog,
    adminDraws: seedAdminDraws(),
    today: todayKey(),
    todayDraws: 0,
    totalQuota: 0,
    rotation: 0,
    view: 'timed',
    weights: Object.fromEntries(catalog.map((item) => [item.id, item.weight])),
    timed: emptyTimed(),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    const base = emptyState();
    const timed = { ...base.timed, ...(parsed.timed || {}) };
    if (!Array.isArray(timed.prizes) || !timed.prizes.length) {
      timed.prizes = emptyTimed().prizes;
    }
    const state = {
      ...base,
      ...parsed,
      weights: { ...base.weights, ...(parsed.weights || {}) },
      ticketLog: Array.isArray(parsed.ticketLog) ? parsed.ticketLog : base.ticketLog,
      publicFeed: Array.isArray(parsed.publicFeed) ? parsed.publicFeed : base.publicFeed,
      prizeCatalog:
        Array.isArray(parsed.prizeCatalog) && parsed.prizeCatalog.length
          ? parsed.prizeCatalog
          : base.prizeCatalog,
      adminDraws: Array.isArray(parsed.adminDraws) ? parsed.adminDraws : base.adminDraws,
      timed,
    };
    if (!Array.isArray(state.prizeCatalog) || !state.prizeCatalog.length) {
      state.prizeCatalog = defaultCatalog();
    }
    state.lotteryEnabled = state.lotteryEnabled !== false;
    state.weights = Object.fromEntries(state.prizeCatalog.map((item) => [item.id, item.weight]));
    state.ticketsPerPayment = Math.max(1, Math.min(10, Number(state.ticketsPerPayment) || 1));
    if (state.today !== todayKey()) {
      state.today = todayKey();
      state.todayDraws = 0;
    }
    return state;
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function rememberPrizeCatalog(catalog) {
  try {
    if (Array.isArray(catalog) && catalog.length) {
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog));
    }
  } catch {
    /* private mode */
  }
}

function restorePrizeCatalog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function prizes() {
  const catalog =
    (LotteryClient.mode === 'api' && apiState?.prizeCatalog?.length
      ? apiState.prizeCatalog
      : null) ||
    restorePrizeCatalog() ||
    loadState().prizeCatalog;
  const list = Array.isArray(catalog) && catalog.length ? catalog : defaultCatalog();
  return list
    .filter((item) => item.enabled !== false)
    .map((item, index) => {
      const tone = WINWHEEL_PALETTE[index % WINWHEEL_PALETTE.length];
      return {
        ...item,
        weight: Math.max(0, Number(item.weight) || 0),
        fill: item.fill || tone.fill,
        ink: item.ink || tone.ink,
      };
    });
}

function totalWeight(list) {
  return list.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
}

function oddsPercent(weight, list) {
  const total = totalWeight(list);
  if (!total) return '0%';
  return `${((Math.max(0, weight) / total) * 100).toFixed(1)}%`;
}

function pickWeighted(items) {
  const live = items.filter((item) => item.weight > 0);
  const total = totalWeight(live);
  if (!total) return null;
  let roll = Math.random() * total;
  for (const item of live) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return live[live.length - 1];
}

function formatMoney(n) {
  return `$${Number(n).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function mockName(i) {
  const base = NAME_SEEDS[i % NAME_SEEDS.length];
  const batch = Math.floor(i / NAME_SEEDS.length);
  return batch ? `${base}·${batch + 1}` : base;
}

function participantNames(state) {
  const names = Array.from({ length: Math.max(0, Number(state.timed.baseCount) || 0) }, (_, i) =>
    mockName(i),
  );
  if (state.timed.joined) names.push(YOU);
  return names;
}

function seatTotal(state) {
  return state.timed.prizes.reduce((sum, item) => sum + Math.max(0, Number(item.seats) || 0), 0);
}

function shuffle(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let apiState = null;

function lotteryUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

function lotteryUserId() {
  return Number(lotteryUser()?.id) || -1;
}

function lotteryHeaders() {
  const headers = { 'Cache-Control': 'no-store' };
  const user = lotteryUser();
  const id = Number(user?.id) || 0;
  if (id > 0) {
    headers['New-Api-User'] = String(id);
    headers['New-API-User'] = String(id);
  }
  if (user?.token) {
    headers.Authorization = `Bearer ${user.token}`;
  } else if (user?.access_token) {
    headers.Authorization = `Bearer ${user.access_token}`;
  }
  return headers;
}

function inConsoleIframe() {
  try {
    return (
      window.parent !== window &&
      typeof window.parent.__newapiLotteryRequest === 'function'
    );
  } catch {
    return false;
  }
}

function parentLotteryRequest() {
  try {
    const fn = window.parent?.__newapiLotteryRequest;
    return typeof fn === 'function' ? fn : null;
  } catch {
    return null;
  }
}

async function waitForParentLotteryRequest(ms = 2000) {
  if (!inConsoleIframe()) return null;
  const start = Date.now();
  while (Date.now() - start < ms) {
    const fn = parentLotteryRequest();
    if (fn) return fn;
    await wait(40);
  }
  return parentLotteryRequest();
}

function applyEmbedChrome() {
  if (!new URLSearchParams(location.search).has('embed')) return;
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/console') || href === '/' || href.startsWith('/login')) {
      a.setAttribute('target', '_parent');
    }
  });
}

function siteLogo() {
  try {
    return localStorage.getItem('logo') || '/logo.png';
  } catch {
    return '/logo.png';
  }
}

function siteName() {
  try {
    return localStorage.getItem('system_name') || 'New API';
  } catch {
    return 'New API';
  }
}

function applySiteBrand() {
  const name = siteName();
  const logo = siteLogo();
  document.querySelectorAll('.lz-w-logo').forEach((el) => {
    el.setAttribute('aria-label', `返回 ${name} 首页`);
    const img = el.querySelector('.lz-w-logo-img');
    const text = el.querySelector('.lz-w-logo-name');
    if (img) {
      img.src = logo;
      img.alt = name;
    }
    if (text) text.textContent = name;
  });
  document.querySelectorAll('.lz-ad-brand').forEach((el) => {
    el.setAttribute('aria-label', `返回 ${name} 首页`);
    const img = el.querySelector('.lz-ad-brand-logo');
    const text = el.querySelector('.lz-ad-brand-name');
    if (img) {
      img.src = logo;
      img.alt = name;
    }
    if (text) text.textContent = name;
  });
  if (PAGE === 'wheel') document.title = `额度抽奖 · ${name}`;
  if (PAGE === 'history') document.title = `抽奖记录 · ${name}`;
  if (PAGE === 'admin' || PAGE === 'settings') document.title = `抽奖管理 · ${name}`;
}

async function refreshSiteBrand() {
  applySiteBrand();
  try {
    const res = await fetch('/api/status', { credentials: 'include' });
    const body = await res.json();
    if (!body?.success || !body.data) return;
    if (body.data.logo) localStorage.setItem('logo', body.data.logo);
    if (body.data.system_name) localStorage.setItem('system_name', body.data.system_name);
    applySiteBrand();
  } catch {
    /* ignore */
  }
}

async function hydrateNewApiSession() {
  if (lotteryUserId() <= 0) return false;
  try {
    const { status, body } = await lotteryTransport('/api/user/self');
    if (status === 401 || !body?.success || !body.data) return false;
    localStorage.setItem('user', JSON.stringify(body.data));
    return true;
  } catch {
    return false;
  }
}

function mapPrize(row) {
  return {
    id: row.id || row.code,
    dbId: row.db_id,
    label: row.label,
    short: row.short,
    hint: row.hint,
    weight: Number(row.weight) || 0,
    quota: Number(row.quota ?? row.quota_amount) || 0,
    extraTicket: Boolean(row.extraTicket || row.extra_ticket),
    enabled: row.enabled !== false,
    fill: row.fill,
    ink: row.ink,
    tier: row.tier,
    redemptionName: row.redemption_name || row.redemptionName || '',
    stock: Number(row.stock) || 0,
    used: Number(row.used) || 0,
  };
}

function mapDraw(row) {
  return {
    id: row.prize_code || row.prizeId || row.id,
    drawId: row.draw_id || row.drawId,
    userId: row.user_id,
    username: row.username,
    prizeId: row.prize_code || row.prizeId || row.id,
    label: row.label || row.prize_label,
    quota: Number(row.quota ?? row.quota_awarded) || 0,
    win: Boolean(row.win || row.is_win),
    extraTicket: Boolean(row.extraTicket || row.extra_ticket),
    redemptionKey: row.redemption_key || row.redemptionKey || '',
    at: Number(row.at) || Date.now(),
  };
}

function mapLog(row) {
  return {
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    refType: row.ref_type || row.refType,
    refId: row.ref_id || row.refId,
    balanceAfter: row.balance_after ?? row.balanceAfter,
    at: Number(row.at) || Date.now(),
  };
}

function mapAdminLog(row) {
  const top = row.topup || null;
  return {
    ...mapLog(row),
    username: row.username || '',
    userId: row.user_id || row.userId || 0,
    topup: top
      ? {
          tradeNo: top.trade_no || top.tradeNo || '',
          money: Number(top.money) || 0,
          paymentMethod: top.payment_method || top.paymentMethod || '',
          status: top.status || '',
          kind: top.kind || '',
        }
      : null,
  };
}

function mapApiState(data) {
  const catalog = (data.prizes || []).map(mapPrize);
  rememberPrizeCatalog(catalog);
  return {
    tickets: data.tickets || 0,
    payments: data.payments || 0,
    ticketsPerPayment: data.tickets_per_payment || data.ticketsPerPayment || 1,
    lotteryEnabled: (data.draw_enabled ?? data.drawEnabled ?? data.enabled) !== false,
    soldOut: Boolean(data.sold_out || data.soldOut),
    todayDraws: data.today_draws || data.todayDraws || 0,
    totalQuota: Number(data.total_quota ?? data.totalQuota) || 0,
    history: (data.history || []).map(mapDraw),
    ticketLog: (data.ticket_log || data.ticketLog || []).map(mapLog),
    publicFeed: data.public_feed || data.publicFeed || [],
    prizeCatalog: catalog,
    prizes: catalog,
    loggedIn: Boolean(data.logged_in),
    isAdmin: Boolean(data.is_admin || data.isAdmin),
    username: data.username || '',
    adminDraws: apiState?.adminDraws || [],
    overview: apiState?.overview || null,
  };
}

function readState() {
  if (LotteryClient.mode === 'api' && apiState) return apiState;
  return loadState();
}

async function parentApiRequest(url, options = {}) {
  const req = parentLotteryRequest() || (await waitForParentLotteryRequest());
  if (typeof req !== 'function') return null;
  const method = (options.method || 'GET').toUpperCase();
  const config = {
    url,
    method,
    headers: lotteryHeaders(),
    skipErrorHandler: true,
    withCredentials: true,
  };
  if (options.body) {
    config.data =
      typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
  }
  const res = await req(config);
  return {
    status: res?.status || 200,
    body: res?.data || null,
  };
}

async function lotteryTransport(url, options = {}) {
  const embedded = inConsoleIframe();
  try {
    const bridged = await parentApiRequest(url, options);
    if (bridged) return bridged;
  } catch (err) {
    const status = err?.response?.status || 0;
    if (status === 401 || embedded) {
      const need = new Error('NEED_LOGIN');
      need.status = status || 401;
      throw need;
    }
  }
  const res = await fetch(url, {
    credentials: 'include',
    mode: 'cors',
    ...options,
    headers: {
      ...lotteryHeaders(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function lotteryRequest(url, options = {}) {
  const { status, body } = await lotteryTransport(url, options);
  if (status === 401) {
    const err = new Error('NEED_LOGIN');
    err.status = 401;
    throw err;
  }
  if (!body || body.success === false) {
    throw new Error(body?.message || `REQUEST_FAILED_${status}`);
  }
  return body.data;
}

const LotteryClient = {
  mode: 'mock',
  async connect() {
    try {
      const { status, body } = await lotteryTransport('/api/lottery');
      if (status === 404) {
        this.mode = 'mock';
        return this.mode;
      }
      this.mode = 'api';
      if (body && body.success) {
        apiState = mapApiState(body.data || {});
        if (!apiState.loggedIn && lotteryUserId() > 0 && (await hydrateNewApiSession())) {
          try {
            const again = await lotteryRequest('/api/lottery');
            apiState = mapApiState(again || {});
          } catch {
            /* still guest */
          }
        }
        return this.mode;
      }
      apiState = mapApiState((body && body.data) || { logged_in: false, prizes: [] });
      return this.mode;
    } catch {
      this.mode = 'api';
      apiState = mapApiState({ logged_in: false, prizes: [] });
      return this.mode;
    }
  },
  async getState() {
    if (this.mode !== 'api') {
      const local = loadState();
      return {
        ...local,
        prizes: prizes(),
      };
    }
    const data = await lotteryRequest('/api/lottery');
    apiState = mapApiState(data || {});
    return apiState;
  },
  async grantFromPayment() {
    if (this.mode !== 'api') {
      await wait(180);
      const local = loadState();
      const per = Math.max(1, Number(local.ticketsPerPayment) || 1);
      const refId = `TOPUP-${Date.now().toString().slice(-8)}`;
      local.tickets += per;
      local.payments = (local.payments || 0) + 1;
      local.ticketLog = local.ticketLog || [];
      local.ticketLog.unshift({
        id: `pay-${Date.now()}`,
        delta: per,
        reason: 'payment_grant',
        refType: 'topup',
        refId,
        balanceAfter: local.tickets,
        at: Date.now(),
      });
      saveState(local);
      return { tickets: local.tickets, refId };
    }
    const data = await lotteryRequest('/api/lottery/admin/grant-tickets', {
      method: 'POST',
      body: JSON.stringify({ tickets: 1, as_payment: true }),
    });
    await this.getState();
    return { tickets: data.tickets, refId: 'admin-grant' };
  },
  async grantTickets(userId, tickets) {
    const n = Math.max(1, Math.min(100, Number(tickets) || 1));
    const uid = Math.max(0, Number(userId) || 0);
    if (this.mode !== 'api') {
      const local = loadState();
      local.tickets += n;
      local.ticketLog = local.ticketLog || [];
      local.ticketLog.unshift({
        id: `adj-${Date.now()}`,
        userId: uid,
        delta: n,
        reason: 'admin_adjust',
        refType: 'admin',
        refId: `manual-${uid}-${Date.now()}`,
        balanceAfter: local.tickets,
        at: Date.now(),
      });
      saveState(local);
      return { tickets: local.tickets, user_id: uid };
    }
    const data = await lotteryRequest('/api/lottery/admin/grant-tickets', {
      method: 'POST',
      body: JSON.stringify({ user_id: uid, tickets: n, as_payment: false }),
    });
    return { tickets: data.tickets, user_id: data.user_id || uid, username: data.username || '' };
  },
  async draw() {
    if (this.mode !== 'api') {
      await wait(280);
      const local = loadState();
      if (local.tickets < 1) throw new Error('NO_TICKETS');
      const pool = prizes();
      if (isSoldOut(local)) throw new Error('有奖品库存不足，请联系站长补货');
      const prize = pickDemoPrize(pool) || pickWeighted(pool);
      if (!prize) throw new Error('NO_PRIZE');
      const drawId = `d${Date.now()}`;
      local.tickets -= 1;
      local.ticketLog = local.ticketLog || [];
      local.ticketLog.unshift({
        id: `c-${drawId}`,
        delta: -1,
        reason: 'draw_consume',
        refType: 'draw',
        refId: drawId,
        balanceAfter: local.tickets,
        at: Date.now(),
      });
      if (prize.extraTicket) {
        local.tickets += 1;
        local.ticketLog.unshift({
          id: `r-${drawId}`,
          delta: 1,
          reason: 'prize_return',
          refType: 'draw',
          refId: drawId,
          balanceAfter: local.tickets,
          at: Date.now(),
        });
      }
      local.todayDraws += 1;
      local.totalQuota = Number((local.totalQuota + (prize.quota || 0)).toFixed(2));
      const row = {
        id: prize.id,
        drawId,
        label: prize.label,
        quota: prize.quota || 0,
        win: Boolean(prize.quota || prize.extraTicket),
        extraTicket: Boolean(prize.extraTicket),
        at: Date.now(),
      };
      local.history.unshift(row);
      local.history = local.history.slice(0, 50);
      local.adminDraws = local.adminDraws || [];
      local.adminDraws.unshift({
        userId: 1,
        username: YOU,
        prizeId: prize.id,
        label: prize.label,
        quota: prize.quota || 0,
        win: row.win,
        extraTicket: row.extraTicket,
        at: row.at,
      });
      local.adminDraws = local.adminDraws.slice(0, 200);
      if (row.win) {
        local.publicFeed = local.publicFeed || [];
        local.publicFeed.unshift({ who: YOU, label: prize.label, quota: prize.quota || 0, at: row.at });
        local.publicFeed = local.publicFeed.slice(0, 30);
      }
      saveState(local);
      return { prizeId: prize.id, tickets: local.tickets, awardedQuota: prize.quota || 0 };
    }
    const data = await lotteryRequest('/api/lottery/draw', { method: 'POST' });
    return {
      prizeId: data.prizeId || data.prize_code,
      tickets: data.tickets,
      awardedQuota: data.awardedQuota || data.quota_awarded || 0,
      extraTicket: Boolean(data.extraTicket || data.extra_ticket),
      redemptionKey: data.redemption_key || data.redemptionKey || '',
    };
  },
  async listDraws({ page = 1, filter = 'all', prize = '', from = '', to = '' } = {}) {
    if (this.mode !== 'api') return null;
    const q = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      filter,
      prize,
      from,
      to,
    });
    const data = await lotteryRequest(`/api/lottery/history?${q}`);
    return { items: (data.items || []).map(mapDraw), total: data.total || 0, page: data.page || page };
  },
  async listLedger({ page = 1, filter = 'all', from = '', to = '' } = {}) {
    if (this.mode !== 'api') return null;
    const q = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      filter,
      from,
      to,
    });
    const data = await lotteryRequest(`/api/lottery/tickets?${q}`);
    return { items: (data.items || []).map(mapLog), total: data.total || 0, page: data.page || page };
  },
  async loadAdmin() {
    const data = await lotteryRequest('/api/lottery/admin/overview');
    const catalog = (data.prizes || []).map(mapPrize);
    apiState = {
      ...(apiState || emptyState()),
      prizeCatalog: catalog,
      lotteryEnabled: (data.config?.draw_enabled ?? data.config?.enabled) !== false,
      ticketsPerPayment: data.config?.tickets_per_payment || 1,
      overview: data.overview,
    };
    return apiState;
  },
  async savePrize(prize) {
    const payload = {
      code: prize.id,
      label: prize.label,
      short: prize.short,
      hint: prize.hint,
      weight: prize.weight,
      quota: prize.quota,
      extra_ticket: Boolean(prize.extraTicket),
      enabled: prize.enabled !== false,
      fill: prize.fill,
      ink: prize.ink,
      tier: prize.tier,
    };
    if (prize.dbId) {
      const data = await lotteryRequest(`/api/lottery/admin/prizes/${prize.dbId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      return mapPrize(data);
    }
    const data = await lotteryRequest('/api/lottery/admin/prizes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapPrize(data);
  },
  async deletePrize(id) {
    await lotteryRequest(`/api/lottery/admin/prizes/${id}`, { method: 'DELETE' });
  },
  async generateStock(id, keys = []) {
    return lotteryRequest(`/api/lottery/admin/prizes/${id}/stock`, {
      method: 'POST',
      body: JSON.stringify({ keys }),
    });
  },
  async listCodes({ page = 1, prizeId = '', status = 'all', q = '' } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(ADMIN_PAGE_SIZE),
      prize_id: prizeId ? String(prizeId) : '',
      status,
      q,
    });
    return lotteryRequest(`/api/lottery/admin/codes?${params}`);
  },
  async deleteCode(id) {
    await lotteryRequest(`/api/lottery/admin/codes/${id}`, { method: 'DELETE' });
  },
  async saveConfig(enabled, ticketsPerPayment) {
    const data = await lotteryRequest('/api/lottery/admin/config', {
      method: 'PUT',
      body: JSON.stringify({ enabled, tickets_per_payment: ticketsPerPayment }),
    });
    if (apiState) {
      apiState.lotteryEnabled = enabled;
      apiState.ticketsPerPayment = ticketsPerPayment;
    }
    return data;
  },
  async listAdminUsers(page = 1, q = '') {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(ADMIN_PAGE_SIZE),
      q,
    });
    const data = await lotteryRequest(`/api/lottery/admin/users?${params}`);
    return { items: data.items || [], total: data.total || 0, page: data.page || page };
  },
  async lookupWallets({ page = 1, q = '' } = {}) {
    if (this.mode !== 'api') {
      const local = loadState();
      const row = {
        user_id: 1,
        username: local.username || YOU,
        tickets: local.tickets || 0,
        total_draws: local.todayDraws || 0,
        total_won_quota: local.totalQuota || 0,
      };
      const kw = String(q || '').trim();
      const hit = !kw || String(row.user_id) === kw || String(row.username).includes(kw);
      return { items: hit ? [row] : [], total: hit ? 1 : 0, page: 1 };
    }
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(ADMIN_PAGE_SIZE),
      q,
    });
    const data = await lotteryRequest(`/api/lottery/admin/wallets?${params}`);
    return { items: data.items || [], total: data.total || 0, page: data.page || page };
  },
  async listAdminDraws({ page = 1, q = '', filter = 'all', prize = '', from = '', to = '', pageSize = ADMIN_PAGE_SIZE } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      q,
      filter,
      prize,
      from,
      to,
    });
    const data = await lotteryRequest(`/api/lottery/admin/draws?${params}`);
    return { items: (data.items || []).map(mapDraw), total: data.total || 0, page: data.page || page };
  },
  async listAdminTickets({ page = 1, q = '', filter = 'all', from = '', to = '' } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(ADMIN_PAGE_SIZE),
      q,
      filter,
      from,
      to,
    });
    const data = await lotteryRequest(`/api/lottery/admin/tickets?${params}`);
    return {
      items: (data.items || []).map(mapAdminLog),
      total: data.total || 0,
      page: data.page || page,
    };
  },
  async login(username, password) {
    const res = await fetch('/api/user/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json();
    if (!body?.success) throw new Error(body?.message || '登录失败');
    if (body.data?.require_2fa) throw new Error('该账号已开启 2FA，请先在控制台登录');
    localStorage.setItem('user', JSON.stringify(body.data));
    await this.connect();
    return body.data;
  },
  async joinRound() {
    const local = loadState();
    if (local.timed.opened) throw new Error('ALREADY_OPENED');
    if (Date.now() >= local.timed.drawAt) throw new Error('TOO_LATE');
    local.timed.joined = true;
    local.timed.joinedAt = Date.now();
    saveState(local);
    return local;
  },
  async leaveRound() {
    const local = loadState();
    if (local.timed.opened) throw new Error('ALREADY_OPENED');
    local.timed.joined = false;
    local.timed.joinedAt = 0;
    saveState(local);
    return local;
  },
};

let drawing = false;
let wheelAngle = 0;
let wheelBuiltKey = '';

function prizeIconSrc(prize, index = 0) {
  if (prize.tier === 'legend' || Number(prize.quota) >= 10) return './assets/ui/prize-grand.png';
  if (prize.extraTicket) {
    const text = `${prize.label || ''}${prize.short || ''}${prize.hint || ''}`;
    if (/再/.test(text)) return './assets/ui/prize-again.png';
    return index % 2 ? './assets/ui/prize-ticket.png' : './assets/ui/prize-extra.png';
  }
  if (prize.tier === 'miss' || !Number(prize.quota)) return './assets/ui/prize-thanks.png';
  return './assets/ui/prize-amount.png';
}

function prizeWheelText(prize) {
  if (prize.extraTicket) return '再来一次';
  if (prize.tier === 'miss' || !(Number(prize.quota) > 0)) return '谢谢参与';
  const q = Number(prize.quota);
  if (!Number.isFinite(q) || q <= 0) return String(prize.short || prize.label || '').slice(0, 6);
  if (Number.isInteger(q)) return `$${q}`;
  return `$${q.toFixed(2)}`;
}

function cssWheelGradient(list) {
  const n = Math.max(1, list.length);
  const slice = 360 / n;
  const gutter = Math.min(0.9, slice * 0.02);
  const parts = [];
  list.forEach((_, i) => {
    const fill = WINWHEEL_PALETTE[i % WINWHEEL_PALETTE.length].fill;
    const a0 = i * slice;
    const a1 = (i + 1) * slice;
    parts.push(`${fill} ${a0}deg ${a1 - gutter}deg`);
    parts.push(`#e8c05c ${a1 - gutter}deg ${a1}deg`);
  });
  return `conic-gradient(from 0deg, ${parts.join(', ')})`;
}

function matrixToDeg(transform) {
  if (!transform || transform === 'none') return 0;
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (!m) return wheelAngle;
  const [a, b] = m[1].split(',').map(Number);
  const deg = Math.atan2(b, a) * (180 / Math.PI);
  return ((deg % 360) + 360) % 360;
}

function wheelFace() {
  return $('wheel-face');
}

function freezeWheelFace() {
  const face = wheelFace();
  if (!face) return 0;
  const deg = matrixToDeg(getComputedStyle(face).transform);
  face.classList.remove('is-whirling');
  face.style.animation = 'none';
  face.style.transition = 'none';
  wheelAngle = deg;
  face.style.setProperty('--from', `${wheelAngle}deg`);
  face.style.transform = `rotate(${wheelAngle}deg)`;
  return deg;
}

function bumpDrawButton() {
  const art = document.querySelector('.lz-w-spin-art');
  if (!art) return;
  art.classList.remove('is-press');
  void art.offsetWidth;
  art.classList.add('is-press');
  window.setTimeout(() => art.classList.remove('is-press'), 320);
}

function syncWheelPrizes() {
  buildWheel();
}

function buildHalo(size) {
  const halo = $('wheel-halo');
  if (!halo) return;
  halo.style.setProperty('--halo-r', `${size / 2 + 16}px`);
  halo.replaceChildren(
    ...Array.from({ length: 24 }, (_, i) => {
      const node = document.createElement('i');
      node.style.setProperty('--i', String(i));
      return node;
    }),
  );
}

function placeWheelPin() {
  const pin = document.querySelector('.lz-w-pin');
  if (!pin || pin.closest('.lz-w-ornament')) return;
  const host = document.querySelector('.lz-w-wheel-stack') || $('lucky-wheel');
  if (!host) return;
  const wr = host.getBoundingClientRect();
  pin.style.left = `${wr.left + wr.width / 2}px`;
  pin.style.top = `${wr.top - 2}px`;
  if (pin.parentElement !== document.body) document.body.appendChild(pin);
}

function preloadPrizeIcons() {
  const srcs = [...new Set(prizes().map(prizeIconSrc))];
  return Promise.all(
    srcs.map(
      (src) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
}

function buildWheel() {
  const el = $('lucky-wheel');
  if (!el || PAGE !== 'wheel') return;
  if (wheelFace()?.classList.contains('is-whirling')) return;
  const list = prizes();
  const key = list.map((prize) => `${prize.id}:${prizeWheelText(prize)}:${prizeIconSrc(prize)}`).join('|');
  if (key === wheelBuiltKey && wheelFace()) {
    const face = wheelFace();
    face.style.background = cssWheelGradient(list);
    return;
  }
  const n = Math.max(1, list.length);
  wheelBuiltKey = key;
  el.classList.add('lz-w-css-wheel');
  el.replaceChildren();
  const face = document.createElement('div');
  face.className = 'lz-w-css-face';
  face.id = 'wheel-face';
  face.style.setProperty('--n', String(n));
  face.style.setProperty('--from', `${wheelAngle}deg`);
  face.style.background = cssWheelGradient(list);
  face.style.transform = `rotate(${wheelAngle}deg)`;
  list.forEach((prize, i) => {
    const node = document.createElement('div');
    const angle = (i + 0.5) * (360 / n);
    const flip = angle > 90 && angle < 270;
    node.className = 'lz-w-css-prize';
    if (flip) node.classList.add('is-flip');
    node.style.setProperty('--a', `${angle}deg`);
    node.style.setProperty('--flip', flip ? '180deg' : '0deg');
    const img = document.createElement('img');
    img.src = prizeIconSrc(prize, i);
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.loading = 'eager';
    const label = document.createElement('span');
    const text = prizeWheelText(prize);
    label.textContent = text;
    if (text.length > 3) label.classList.add('is-long');
    node.append(img, label);
    face.append(node);
  });
  el.append(face);
  placeWheelPin();
  if (!placeWheelPin.bound) {
    placeWheelPin.bound = true;
    window.addEventListener('scroll', placeWheelPin, { passive: true });
    window.addEventListener('resize', placeWheelPin, { passive: true });
  }
}

function renderPrizes() {
  const listEl = $('prize-list');
  if (!listEl || PAGE === 'wheel') return;
  const list = prizes();
  listEl.replaceChildren(
    ...list.map((prize) => {
      const li = document.createElement('li');
      const percent = Math.round((Math.max(0, prize.weight) / (totalWeight(list) || 1)) * 100);
      if (PAGE === 'wheel') {
        li.textContent = `${prize.short} ${percent}%`;
        return li;
      }
      li.innerHTML = `
        <span class="lz-dot" style="background:${prize.fill}"></span>
        <span class="lz-prize-name">${escapeHtml(prize.label)}</span>
        <span class="lz-odds">${percent}%</span>
      `;
      return li;
    }),
  );
}

function emptyBlock(title, hint) {
  const hintHtml = hint ? `<span class="lz-w-empty-hint">${hint}</span>` : '';
  return `<div class="lz-w-empty"><strong>${title}</strong>${hintHtml}</div>`;
}

function clock(ts) {
  const t = new Date(ts);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
}

function renderWinFeed(feed) {
  const list = $('win-feed');
  if (!list) return;
  const rows = (feed || []).slice(0, 16);
  if (!rows.length) {
    list.classList.remove('is-looping');
    list.innerHTML = `<li class="lz-empty">${emptyBlock('暂无中奖记录', '全站入账后会滚动显示')}</li>`;
    scheduleSidePanelSync();
    return;
  }
  list.classList.remove('is-looping');
  list.replaceChildren(
    ...rows.map((row) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="who">${escapeHtml(row.who)}</span><span class="prize">${escapeHtml(row.label)}</span><time datetime="${new Date(row.at).toISOString()}">${clock(row.at)}</time>`;
      return li;
    }),
  );
  scheduleSidePanelSync();
}

function scheduleSidePanelSync() {
  if (PAGE !== 'wheel') return;
  window.cancelAnimationFrame(scheduleSidePanelSync.fid);
  scheduleSidePanelSync.fid = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(syncSidePanels);
  });
}

function syncSidePanels() {
  const panels = [...document.querySelectorAll('.lz-w-panel-side')];
  if (panels.length < 2) return;
  const list = $('win-feed');
  list?.querySelectorAll('[data-clone="1"]').forEach((node) => node.remove());
  list?.classList.remove('is-looping');
  const left = panels[0];
  const right = panels[1];
  left.style.height = '';
  left.style.maxHeight = '';
  right.style.height = '';
  right.style.maxHeight = '';
  const h = left.offsetHeight;
  if (h > 0) {
    right.style.height = `${h}px`;
    right.style.maxHeight = `${h}px`;
  }
  if (list) setupFeedMarquee(list);
}

function setupFeedMarquee(list) {
  const viewport = list.closest('.lz-w-feed-viewport');
  if (!viewport) return;
  list.querySelectorAll('[data-clone="1"]').forEach((node) => node.remove());
  list.classList.remove('is-looping');
  if (list.querySelector('.lz-empty') || prefersReducedMotion()) return;
  const seeds = [...list.children];
  if (!seeds.length) return;
  const viewH = viewport.clientHeight;
  if (viewH < 40) return;
  let guard = 0;
  while (list.scrollHeight < viewH && list.children.length < 48 && guard < 12) {
    seeds.forEach((node) => {
      const clone = node.cloneNode(true);
      clone.dataset.clone = '1';
      clone.setAttribute('aria-hidden', 'true');
      list.append(clone);
    });
    guard += 1;
  }
  [...list.children].forEach((node) => {
    const clone = node.cloneNode(true);
    clone.dataset.clone = '1';
    clone.setAttribute('aria-hidden', 'true');
    list.append(clone);
  });
  list.classList.add('is-looping');
  list.style.setProperty('--feed-ms', `${Math.max(16, seeds.length * 2.4)}s`);
}

function renderPersonal(state) {
  const root = $('me-stats');
  const per = state.ticketsPerPayment || 1;
  if (root) {
    root.innerHTML = `
      <div class="lz-w-balance">
        <div>
          <p class="lz-w-balance-k">可抽次数</p>
          <p class="lz-w-balance-v"><strong>${state.tickets ?? 0}</strong><span>次</span></p>
          <p class="lz-w-balance-hint">成功支付 1 笔 = ${per} 次</p>
        </div>
      </div>
      <ul class="lz-w-meta">
        <li><span>今日已抽</span><strong>${state.todayDraws || 0}</strong></li>
        <li><span>成功支付</span><strong>${state.payments || 0}</strong></li>
        <li><span>累计入账</span><strong>${formatMoney(state.totalQuota)}</strong></li>
      </ul>
    `;
  }
  const note = $('dock-note-text');
  if (note) {
    note.textContent = `成功支付 1 笔，获得 ${per} 次抽奖；每次抽取消耗 1 次。奖项内容由后台配置。`;
  }
  scheduleSidePanelSync();
}

function isSoldOut(state = readState()) {
  if (state?.soldOut) return true;
  const catalog = state?.prizeCatalog || [];
  const bound = catalog.filter((item) => item.enabled !== false && item.redemptionName);
  return bound.some((item) => (Number(item.stock) || 0) <= 0);
}

function isActivityClosed(state = readState()) {
  return state?.lotteryEnabled === false;
}

function applyActivityStamp(state = readState()) {
  const closed = isActivityClosed(state);
  const sold = !closed && isSoldOut(state);
  const blocked = closed || sold;
  document.body.classList.toggle('is-closed', closed);
  document.body.classList.toggle('is-soldout', sold);
  document.querySelector('.lz-w-ornament')?.classList.toggle('is-soldout', blocked);
  const stamp = $('stock-stamp');
  if (stamp) stamp.hidden = !blocked;
  const tape = $('stamp-tape');
  const title = $('stamp-title');
  const sub = $('stamp-sub');
  const note = $('dock-note-text');
  if (closed) {
    if (tape) tape.textContent = '活动关闭';
    if (title) title.textContent = '活动已关闭';
    if (sub) {
      sub.innerHTML = state?.isAdmin
        ? '暂时不能转盘<br><a class="lz-w-stamp-admin" href="./admin.html">点这里重新开启</a>'
        : '暂时不能转盘<br>充值仍会送抽奖次数';
    }
    if (note) {
      note.textContent = state?.isAdmin
        ? '抽奖已关闭。点右上角「抽奖管理」即可重新开启。'
        : '抽奖已关闭，暂时不能抽。充值仍会送次数，已有次数会留着。';
    }
    return;
  }
  if (sold) {
    if (tape) tape.textContent = '库存不足';
    if (title) title.textContent = '请联系站长补货';
    if (sub) {
      sub.innerHTML = state?.isAdmin
        ? '有奖项兑换码用完了<br><a class="lz-w-stamp-admin" href="./admin.html">点这里去补库存</a>'
        : '有奖项兑换码用完了<br>补货后即可继续抽';
    }
    if (note) {
      note.textContent = state?.isAdmin
        ? '有奖品库存不足，转盘已暂停，避免缺货后其它奖概率被抬高。点右上角「抽奖管理」补兑换码。'
        : '有奖品库存不足，请联系站长补货。次数还在，补货后可继续抽。';
    }
  }
}

function syncSoldOutUI(state = readState()) {
  applyActivityStamp(state);
}

function setDrawStatus(text) {
  const el = $('draw-status');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function renderTicker() {}

function renderHistory(history) {
  const list = $('history-list');
  if (!list) return;
  if (!history.length) {
    list.innerHTML = `<li class="lz-empty">${emptyBlock(
      PAGE === 'wheel' ? '还没有抽取记录' : '还没有记录',
      PAGE === 'wheel' ? '抽奖结果会显示在这里' : '',
    )}</li>`;
    scheduleSidePanelSync();
    return;
  }
  list.replaceChildren(
    ...history.slice(0, PAGE === 'wheel' ? 30 : 20).map((row) => {
      const li = document.createElement('li');
      const t = new Date(row.at);
      const extra = PAGE === 'wheel'
        ? `<span class="label">${escapeHtml(row.label)}</span>${
            row.redemptionKey
              ? `<button type="button" class="lz-w-copy-code" data-copy="${escapeHtml(row.redemptionKey)}" title="点击复制兑换码"><code>${escapeHtml(row.redemptionKey)}</code></button>`
              : '<span class="lz-w-code-none">—</span>'
          }<time datetime="${t.toISOString()}">${clock(row.at)}</time>`
        : `<span>${escapeHtml(row.label)}</span><time datetime="${t.toISOString()}">${clock(row.at)}</time>`;
      li.innerHTML = extra;
      return li;
    }),
  );
  scheduleSidePanelSync();
}

function renderTicketPips(tickets) {
  const root = $('ticket-pips');
  if (!root) return;
  const count = Math.max(0, Number(tickets) || 0);
  root.replaceChildren(
    ...Array.from({ length: 5 }, (_, i) => {
      const pip = document.createElement('span');
      if (i < Math.min(count, 5)) pip.className = 'is-on';
      return pip;
    }),
  );
}

function renderStats(state) {
  setText('tickets-count', String(state.tickets));
  renderTicketPips(state.tickets);
  setText('stat-today', String(state.todayDraws));
  setText('stat-sum', formatMoney(state.totalQuota));
  setText('mode-label', LotteryClient.mode.toUpperCase());
  renderWinFeed(state.publicFeed);
  renderPersonal(state);
  syncSoldOutUI(state);
}

function setBusy(busy, tickets) {
  const btn = $('draw-btn');
  const label = $('draw-label');
  document.querySelector('.lz-w-ornament')?.classList.toggle('is-spinning', busy);
  if (!btn || !label) return;
  btn.classList.toggle('is-busy', busy);
  const idleLabel = PAGE === 'wheel' ? '立即抽奖' : '转一次';
  label.textContent = idleLabel;
  if (busy) {
    btn.disabled = true;
    setDrawStatus(PAGE === 'wheel' ? '开奖中…' : '正在转');
    return;
  }
  const live = readState();
  btn.disabled = isActivityClosed(live) || isSoldOut(live);
  if (PAGE === 'wheel') {
    setDrawStatus('');
    return;
  }
  if (totalWeight(prizes()) <= 0) {
    setDrawStatus('请先设置概率');
    return;
  }
  setDrawStatus('');
}

function showDrawHint(message) {
  const toast = $('draw-toast');
  if (!toast) {
    setDrawStatus(message);
    return;
  }
  toast.hidden = false;
  toast.textContent = message;
  window.clearTimeout(showDrawHint.tid);
  showDrawHint.tid = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function isDemoJackpot() {
  try {
    return new URLSearchParams(window.location.search).get('demo') === 'jackpot';
  } catch {
    return false;
  }
}

function pickDemoPrize(pool) {
  if (!isDemoJackpot() || !Array.isArray(pool)) return null;
  return pool.find((item) => Number(item.quota) >= 10) || pool.find((item) => isJackpotPrize(item)) || null;
}

function startWheelSpin() {
  if (!wheelFace()) buildWheel();
  const face = wheelFace();
  if (!face || prefersReducedMotion()) return false;
  freezeWheelFace();
  face.style.removeProperty('animation');
  void face.offsetWidth;
  face.classList.add('is-whirling');
  return true;
}

async function spinTo(prize, { alreadyPlaying = false } = {}) {
  const list = prizes();
  const index = Math.max(0, list.findIndex((item) => item.id === prize.id));
  if (!wheelFace()) buildWheel();
  const face = wheelFace();
  if (!face) return;
  const n = Math.max(1, list.length);
  const targetMod = ((-((index + 0.5) * (360 / n))) % 360 + 360) % 360;
  if (prefersReducedMotion()) {
    freezeWheelFace();
    wheelAngle = targetMod;
    face.style.setProperty('--from', `${wheelAngle}deg`);
    face.style.transform = `rotate(${wheelAngle}deg)`;
    return;
  }
  if (!alreadyPlaying) startWheelSpin();
  await wait(alreadyPlaying ? 280 : 160);
  freezeWheelFace();
  void face.offsetWidth;
  let delta = (targetMod - (wheelAngle % 360) + 360) % 360;
  if (delta < 45) delta += 360;
  const duration = isJackpotPrize(prize) ? 5600 : 4200;
  wheelAngle += 360 * (isJackpotPrize(prize) ? 8 : 6) + delta;
  face.style.transition = `transform ${duration}ms cubic-bezier(${isJackpotPrize(prize) ? '0.12, 0.72, 0.08, 1' : '0.33, 0.33, 0.12, 1'})`;
  face.style.setProperty('--from', `${wheelAngle}deg`);
  face.style.transform = `rotate(${wheelAngle}deg)`;
  await Promise.race([
    wait(duration + 60),
    new Promise((resolve) => {
      const onEnd = (event) => {
        if (event.target !== face || event.propertyName !== 'transform') return;
        face.removeEventListener('transitionend', onEnd);
        resolve();
      };
      face.addEventListener('transitionend', onEnd);
    }),
  ]);
  face.style.transition = 'none';
}

function dialogTone(prize) {
  if (isJackpotPrize(prize)) return 'is-jackpot';
  if (prize.tier === 'miss') return 'is-miss';
  return 'is-win';
}

function isJackpotPrize(prize) {
  if (!prize) return false;
  const quota = Number(prize.quota) || 0;
  const tier = String(prize.tier || '').toLowerCase();
  const id = String(prize.id || prize.code || '').toLowerCase();
  return quota >= 3 || tier === 'legend' || tier === 'epic' || tier === 'rare' || id === 'q10' || id === 'q3';
}

function ensureJackpotFx() {
  const root = $('jackpot-fx');
  if (!root || root.dataset.ready === '1') return root;
  root.innerHTML = `<i class="lz-w-jackpot-bloom"></i><i class="lz-w-jackpot-ring"></i><i class="lz-w-jackpot-ring is-late"></i>${
    Array.from({ length: 20 }, (_, i) => `<span class="lz-w-jackpot-spark" style="--a:${i * 18}deg"></span>`).join('')
  }`;
  root.dataset.ready = '1';
  return root;
}

function clearJackpotFx() {
  const root = $('jackpot-fx');
  if (root) root.hidden = true;
  document.querySelector('.lz-w-ornament')?.classList.remove('is-jackpot-burst');
}

async function playJackpotFx(prize) {
  if (prefersReducedMotion() || !isJackpotPrize(prize)) return;
  const root = ensureJackpotFx();
  if (!root) return;
  root.hidden = false;
  root.classList.toggle('is-mega', Number(prize.quota) >= 10);
  document.querySelector('.lz-w-ornament')?.classList.add('is-jackpot-burst');
  void root.offsetWidth;
  root.classList.remove('is-play');
  void root.offsetWidth;
  root.classList.add('is-play');
  await wait(Number(prize.quota) >= 10 ? 980 : 720);
}

function openResult(prize, result = {}) {
  const modal = $('result-modal');
  if (!modal) return;
  const dialog = modal.querySelector('.lz-dialog');
  dialog.classList.remove('is-win', 'is-miss', 'is-jackpot');
  dialog.classList.add(dialogTone(prize));
  const jackpot = isJackpotPrize(prize);
  const wheelText = prizeWheelText(prize);
  $('result-kicker').textContent = jackpot
    ? Number(prize.quota) >= 10
      ? '恭喜中大奖'
      : '抽中大奖'
    : prize.quota || prize.extraTicket
      ? '抽中了'
      : '这次没有中';
  $('result-title').textContent = wheelText;
  const icon = $('result-icon');
  if (icon) {
    icon.src = prizeIconSrc(prize);
    icon.alt = prize.label || '';
  }
  const chip = $('result-chip');
  if (chip) {
    chip.hidden = !jackpot;
    chip.textContent = Number(prize.quota) >= 10 ? '头奖' : '大奖';
  }
  const code = result.redemptionKey || '';
  const codeWrap = $('result-code-wrap');
  const codeBtn = $('result-code-btn');
  const codeText = $('result-code-text');
  if (codeWrap && codeBtn && codeText) {
    const showCode = Boolean(code);
    codeWrap.hidden = !showCode;
    codeBtn.dataset.copy = code;
    codeText.textContent = code;
    markCopied(codeBtn, false);
  }
  $('result-desc').textContent = prize.extraTicket
    ? '抽奖次数已返还 1 次，可继续抽取。'
      : code
      ? '请复制兑换码，到充值页「兑换」自行入账。抽中不会直接加额度。'
      : prize.quota
        ? LotteryClient.mode === 'api'
          ? '请到充值页用兑换码入账。'
          : '额度将在对接后通过兑换码入账。现在只是 UI 预览。'
        : '本次未中奖，次数已消耗。';
  modal.hidden = false;
  $('result-close').focus();
}

async function copyText(value) {
  const text = String(value || '');
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function markCopied(el, on) {
  if (!el) return;
  el.classList.toggle('is-copied', on);
  const tip = el.querySelector('.lz-w-copy-tip');
  if (tip) tip.textContent = on ? '已复制' : '复制';
  if (on) {
    window.clearTimeout(el._copyTid);
    el._copyTid = window.setTimeout(() => markCopied(el, false), 1400);
  }
}

async function onCopyClick(event) {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.getAttribute('data-copy');
  if (!text) return;
  event.preventDefault();
  const ok = await copyText(text);
  if (ok) markCopied(btn, true);
}

function closeResult() {
  const modal = $('result-modal');
  if (modal) modal.hidden = true;
  clearJackpotFx();
}

async function onDraw() {
  if (drawing) return;
  const snapshot = readState();
  if (isActivityClosed(snapshot)) {
    showDrawHint('活动未开启');
    setBusy(false, snapshot.tickets);
    return;
  }
  if (isSoldOut(snapshot)) {
    showDrawHint('有奖品库存不足，请联系站长补货');
    setBusy(false, snapshot.tickets);
    return;
  }
  if (LotteryClient.mode === 'api' && snapshot.loggedIn === false) {
    showDrawHint('请先登录');
    setBusy(false, snapshot.tickets);
    return;
  }
  if (snapshot.tickets < 1) {
    showDrawHint('次数不足');
    setBusy(false, snapshot.tickets);
    return;
  }
  if (LotteryClient.mode !== 'api' && totalWeight(prizes()) <= 0) {
    showDrawHint('请先设置概率');
    setBusy(false, snapshot.tickets);
    return;
  }
  drawing = true;
  const toast = $('draw-toast');
  if (toast) toast.hidden = true;
  bumpDrawButton();
  setBusy(true, snapshot.tickets);
  const spinning = startWheelSpin();
  try {
    const result = await LotteryClient.draw();
    const prize = prizes().find((item) => item.id === result.prizeId);
    if (!prize) throw new Error('NO_PRIZE');
    await spinTo(prize, { alreadyPlaying: spinning });
    await playJackpotFx(prize);
    const fresh = await LotteryClient.getState();
    syncWheelPrizes();
    renderStats(fresh);
    renderHistory(fresh.history);
    openResult(prize, result);
    setBusy(false, fresh.tickets);
  } catch (err) {
    if (spinning) freezeWheelFace();
    setBusy(false, readState().tickets);
    if (err.message === 'NO_TICKETS') {
      showDrawHint('次数不足');
    } else if (/补货|库存不足|已派完/.test(err.message)) {
      showDrawHint('有奖品库存不足，请联系站长补货');
      const live = readState();
      if (live) live.soldOut = true;
      syncSoldOutUI(live);
    } else if (/未开启/.test(err.message)) {
      showDrawHint('活动未开启');
      const live = readState();
      if (live) live.lotteryEnabled = false;
      syncSoldOutUI(live);
    } else if (err.message === 'NEED_LOGIN') {
      const hint = $('auth-hint');
      if (hint) {
        hint.hidden = false;
        hint.textContent = '请先登录后再抽奖';
      }
    } else if (err.message !== 'NO_TICKETS' && err.message !== 'NO_PRIZE') {
      const hint = $('auth-hint');
      if (hint) {
        hint.hidden = false;
        hint.textContent = err.message;
      }
      console.error(err);
    }
  } finally {
    drawing = false;
  }
}

function renderTimedPrizes(state) {
  const nameEl = $('event-name');
  if (nameEl) nameEl.textContent = state.timed.name;
  setText('event-code', 'Synai996');
  const listEl = $('timed-prize-list');
  if (!listEl) return;
  listEl.replaceChildren(
    ...state.timed.prizes.map((prize) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="lz-prize-hint">${escapeHtml(prize.hint || '奖项')}</span>
        <span class="lz-prize-name">${escapeHtml(prize.label || '待定')}</span>
        <span class="lz-odds">${prize.seats} 名</span>
      `;
      return li;
    }),
  );
}

function renderSteps(state) {
  const root = $('join-steps');
  if (!root) return;
  const remain = state.timed.drawAt - Date.now();
  let phase = 'join';
  if (state.timed.opened) phase = 'done';
  else if (state.timed.joined || remain <= 0) phase = 'wait';
  root.querySelectorAll('li').forEach((li) => {
    li.classList.remove('is-on', 'is-done');
    const step = li.dataset.step;
    if (phase === 'join' && step === 'join') li.classList.add('is-on');
    if (phase === 'wait') {
      if (step === 'join') li.classList.add('is-done');
      if (step === 'wait') li.classList.add('is-on');
    }
    if (phase === 'done') {
      if (step === 'done') li.classList.add('is-on');
      else li.classList.add('is-done');
    }
  });
}

function renderFaces(state) {
  const el = $('timed-faces');
  if (!el) return;
  if (state.timed.opened) {
    el.hidden = true;
    return;
  }
  const names = participantNames(state);
  if (!names.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const show = names.slice(-10).reverse();
  el.replaceChildren(
    ...show.map((name) => {
      const span = document.createElement('span');
      span.className = name === YOU ? 'lz-face is-you' : 'lz-face';
      span.textContent = name;
      return span;
    }),
  );
  if (names.length > 10) {
    const more = document.createElement('span');
    more.className = 'lz-face';
    more.textContent = `+${names.length - 10}`;
    el.append(more);
  }
}

function renderTimedBoard(state) {
  const board = $('timed-board');
  const card = $('result-board');
  if (!board) return;
  if (!state.timed.opened) {
    if (card) card.hidden = true;
    board.replaceChildren();
    return;
  }
  if (card) card.hidden = false;
  setText('board-title', '中奖名单');
  if (!state.timed.winners.length) {
    board.innerHTML = '<li class="lz-empty">本场没有抽出中奖者。</li>';
    return;
  }
  board.replaceChildren(
    ...state.timed.winners.map((row) => {
      const li = document.createElement('li');
      const you = row.who === YOU;
      li.innerHTML = `<span${you ? ' class="lz-win-you"' : ''}>${escapeHtml(row.who)}</span><span>${escapeHtml(row.hint)} ${escapeHtml(row.label)}</span>`;
      return li;
    }),
  );
}

function renderJoinControls(state) {
  const btn = $('join-btn');
  const label = $('join-label');
  const leave = $('leave-btn');
  const banner = $('result-me');
  if (!btn || !label) return;
  const remain = state.timed.drawAt - Date.now();
  btn.classList.remove('is-joined', 'is-done', 'is-busy');
  btn.hidden = false;
  btn.disabled = false;
  if (banner) {
    banner.hidden = true;
    banner.className = 'lz-banner';
    banner.innerHTML = '';
  }

  if (state.timed.opened) {
    const mine = state.timed.winners.find((row) => row.who === YOU);
    btn.hidden = true;
    if (leave) leave.hidden = true;
    if (banner) {
      banner.hidden = false;
      if (!state.timed.joined) {
        banner.innerHTML = '<strong>本场未参与</strong>开奖时你不在名单里。';
      } else if (mine) {
        banner.classList.add('is-win');
        banner.innerHTML = `<strong>你抽中了 ${escapeHtml(mine.hint)} ${escapeHtml(mine.label)}</strong>额度将在对接后入账。现在是预览。`;
      } else {
        banner.classList.add('is-miss');
        banner.innerHTML = '<strong>没有抽中</strong>谢谢参与，下一场再见。';
      }
    }
    setText('join-state', '');
    return;
  }

  if (remain <= 0) {
    btn.hidden = !!state.timed.joined;
    btn.disabled = true;
    btn.classList.add('is-busy');
    label.textContent = '正在开奖';
    if (leave) leave.hidden = true;
    setText('join-state', state.timed.joined ? '' : '到点了，正在从确认参与的用户里开奖。');
    return;
  }

  if (state.timed.joined) {
    btn.hidden = true;
    if (leave) leave.hidden = false;
    setText('join-state', '未到点之前可以取消参与。');
    return;
  }

  label.textContent = '确认参与本场';
  if (leave) leave.hidden = true;
  setText('join-state', '确认之后进入名单。没有确认的人，到点不会被抽。');
}

function renderCountdown(state) {
  const remain = Math.max(0, state.timed.drawAt - Date.now());
  const total = Math.floor(remain / 1000);
  const h = pad(Math.floor(total / 3600));
  const m = pad(Math.floor((total % 3600) / 60));
  const s = pad(total % 60);
  setText('cd-h', h);
  setText('cd-m', m);
  setText('cd-s', s);
  setText('wait-h', h);
  setText('wait-m', m);
  setText('wait-s', s);
  const opened = !!state.timed.opened;
  const waiting = !opened && state.timed.joined;
  const drawing = !opened && remain <= 0;
  document.body.classList.toggle('is-waiting', waiting && !drawing);
  document.body.classList.toggle('is-drawing', drawing);
  const clock = $('wait-clock');
  const badge = $('wait-badge');
  const caption = $('wait-caption');
  const compact = $('countdown-kicker');
  if (clock) clock.hidden = opened || (!state.timed.joined && remain > 0);
  if (badge) badge.hidden = !(waiting && !drawing);
  if (caption) {
    caption.hidden = opened || (!state.timed.joined && remain > 0);
    caption.textContent = drawing ? '正在开奖' : '距离开奖';
  }
  if (compact) compact.hidden = opened || waiting || drawing;
  setText('draw-at-line', `开奖时间 ${formatDateTime(state.timed.drawAt)}`);
}

function renderTimed() {
  if (PAGE !== 'join') return;
  const state = loadState();
  renderTimedPrizes(state);
  renderCountdown(state);
  renderJoinControls(state);
  renderFaces(state);
  renderTimedBoard(state);
  renderSteps(state);
  const joined = participantNames(state).length;
  setText('pool-count', String(joined));
  setText('stat-joined', String(joined));
  setText('stat-seats', String(seatTotal(state)));
}

function runTimedDraw(state) {
  const pool = shuffle(participantNames(state));
  const winners = [];
  for (const prize of state.timed.prizes) {
    const seats = Math.max(0, Number(prize.seats) || 0);
    for (let i = 0; i < seats; i += 1) {
      const who = pool.shift();
      if (!who) break;
      winners.push({
        who,
        prizeId: prize.id,
        label: prize.label,
        hint: prize.hint,
        quota: prize.quota || 0,
      });
    }
  }
  state.timed.opened = true;
  state.timed.winners = winners;
  const mine = winners.find((row) => row.who === YOU);
  if (mine) {
    state.totalQuota = Number((state.totalQuota + (mine.quota || 0)).toFixed(2));
    state.history.unshift({
      id: mine.prizeId,
      label: `定时 · ${mine.label}`,
      at: Date.now(),
    });
    state.history = state.history.slice(0, 20);
  }
  saveState(state);
}

let openingRound = false;

async function maybeOpenRound() {
  const state = loadState();
  if (state.timed.opened || openingRound) return;
  if (Date.now() < state.timed.drawAt) return;
  openingRound = true;
  renderTimed();
  if (!prefersReducedMotion()) await wait(1200);
  runTimedDraw(loadState());
  renderTimed();
  renderStats(loadState());
  renderHistory(loadState().history);
  openingRound = false;
}

function renderWeightEditor() {
  const root = $('weight-editor');
  if (!root) return;
  const list = prizes();
  root.replaceChildren(
    ...list.map((prize) => {
      const row = document.createElement('div');
      row.className = 'lz-weight-row';
      row.innerHTML = `
        <span class="lz-dot" style="background:${prize.fill}"></span>
        <label>
          <span class="lz-prize-name">${escapeHtml(prize.label)}</span>
          <input type="range" min="0" max="100" step="1" value="${prize.weight}" data-id="${prize.id}" aria-label="${escapeHtml(prize.label)} 权重" />
        </label>
        <input type="number" min="0" max="999" step="1" value="${prize.weight}" data-id="${prize.id}" aria-label="${escapeHtml(prize.label)} 权重数值" />
        <output>${oddsPercent(prize.weight, list)}</output>
      `;
      return row;
    }),
  );
}

function renderTimedPrizeEditor(state) {
  const root = $('timed-prize-editor');
  if (!root) return;
  root.replaceChildren(
    ...state.timed.prizes.map((prize, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'lz-prize-edit';
      wrap.innerHTML = `
        <div class="lz-prize-edit-grid">
          <label class="lz-field">
            <span>奖项名称</span>
            <input type="text" maxlength="16" data-index="${index}" data-field="hint" value="${escapeHtml(prize.hint)}" placeholder="一等奖" />
          </label>
          <label class="lz-field">
            <span>奖品内容</span>
            <input type="text" maxlength="24" data-index="${index}" data-field="label" value="${escapeHtml(prize.label)}" placeholder="$10.00 或 7天套餐" />
          </label>
          <label class="lz-field">
            <span>额度（数字，可空）</span>
            <input type="number" min="0" max="9999" step="0.01" data-index="${index}" data-field="quota" value="${prize.quota ?? ''}" />
          </label>
          <label class="lz-field">
            <span>名额</span>
            <input type="number" min="1" max="50" step="1" data-index="${index}" data-field="seats" value="${prize.seats}" />
          </label>
        </div>
        <button type="button" class="lz-remove" data-remove="${index}" ${state.timed.prizes.length <= 1 ? 'disabled' : ''}>删除这项</button>
      `;
      return wrap;
    }),
  );
}

function renderConfig() {
  const state = loadState();
  renderWeightEditor();
  const drawAt = $('cfg-draw-at');
  if (drawAt) drawAt.value = toLocalInput(state.timed.drawAt);
  const name = $('cfg-event-name');
  if (name) name.value = state.timed.name;
  const count = $('cfg-base-count');
  if (count) count.value = String(state.timed.baseCount);
  renderTimedPrizeEditor(state);
}

function openConfig() {
  renderConfig();
  const modal = $('config-modal');
  if (modal) {
    modal.hidden = false;
    $('config-close')?.focus();
  }
}

function closeConfig() {
  const modal = $('config-modal');
  if (modal) modal.hidden = true;
}

function setWeight(id, value) {
  const state = loadState();
  const weight = Math.max(0, Math.min(999, Number(value) || 0));
  state.weights[id] = weight;
  if (Array.isArray(state.prizeCatalog)) {
    const item = state.prizeCatalog.find((prize) => prize.id === id);
    if (item) item.weight = weight;
  }
  saveState(state);
  renderPrizes();
  syncWheelPrizes();
  setBusy(false, state.tickets);
  const list = prizes();
  const editor = $('weight-editor');
  if (!editor) return;
  editor.querySelectorAll('.lz-weight-row').forEach((row) => {
    const range = row.querySelector('input[type="range"]');
    const number = row.querySelector('input[type="number"]');
    const out = row.querySelector('output');
    const prize = list.find((item) => item.id === range.dataset.id);
    if (!prize) return;
    if (document.activeElement !== range) range.value = String(prize.weight);
    if (document.activeElement !== number) number.value = String(prize.weight);
    out.textContent = oddsPercent(prize.weight, list);
  });
}

function setDrawIn(seconds) {
  const state = loadState();
  state.timed.drawAt = Date.now() + seconds * 1000;
  state.timed.opened = false;
  state.timed.winners = [];
  saveState(state);
  renderConfig();
  renderTimed();
}

function forcePlayWheel() {
  return /[?&]play=1(?:&|$)/.test(location.search || '');
}

const BGM_STORAGE_KEY = 'synai996.lottery.bgm';
const BGM_SRC = './assets/bgm.mp3?v=b1';

function preferredBgmOn() {
  try {
    return localStorage.getItem(BGM_STORAGE_KEY) !== 'off';
  } catch (e) {
    return true;
  }
}

function persistBgm(on) {
  try {
    localStorage.setItem(BGM_STORAGE_KEY, on ? 'on' : 'off');
  } catch (e) {}
}

function bootBgm() {
  const btn = $('bgm-btn');
  if (!btn) return;
  const audio = new Audio(BGM_SRC);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.32;
  let wanted = preferredBgmOn();
  let unlocked = false;

  const sync = () => {
    const playing = !audio.paused && !audio.ended;
    btn.classList.toggle('is-off', !wanted);
    btn.classList.toggle('is-waiting', wanted && !playing);
    btn.setAttribute('aria-pressed', wanted ? 'true' : 'false');
    btn.setAttribute('aria-label', wanted ? '关闭背景音乐' : '开启背景音乐');
    btn.title = wanted ? (playing ? '关闭背景音乐' : '点击页面后播放') : '开启背景音乐';
  };

  const playIfWanted = async () => {
    if (!wanted) {
      audio.pause();
      sync();
      return;
    }
    try {
      await audio.play();
      unlocked = true;
    } catch (e) {
      unlocked = false;
    }
    sync();
  };

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (wanted && audio.paused) {
      void playIfWanted();
      return;
    }
    wanted = !wanted;
    persistBgm(wanted);
    if (!wanted) audio.pause();
    else void playIfWanted();
    sync();
  });
  const unlockOnce = (event) => {
    if (event.target && event.target.closest && event.target.closest('#bgm-btn')) return;
    if (wanted) void playIfWanted();
  };
  document.addEventListener('pointerdown', unlockOnce, { once: true });
  document.addEventListener('keydown', unlockOnce, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
    else if (wanted && unlocked) void playIfWanted();
  });
  audio.addEventListener('error', () => {
    btn.hidden = true;
  });
  audio.addEventListener('playing', sync);
  audio.addEventListener('pause', sync);
  sync();
  void playIfWanted();
}

async function bootWheel() {
  await LotteryClient.connect();
  const preview =
    LotteryClient.mode === 'api' && apiState
      ? apiState
      : await LotteryClient.getState().catch(() => null);
  if (preview?.isAdmin && !forcePlayWheel()) {
    location.replace('./admin.html');
    return;
  }
  buildWheel();
  void preloadPrizeIcons();
  if (isDemoJackpot() && LotteryClient.mode !== 'api') {
    const local = loadState();
    local.lotteryEnabled = true;
    local.soldOut = false;
    if ((Number(local.tickets) || 0) < 8) local.tickets = 8;
    saveState(local);
  }
  const live =
    LotteryClient.mode === 'api' && apiState
      ? apiState
      : await LotteryClient.getState();
  buildWheel();
  renderPrizes();
  renderStats(live);
  renderHistory(live.history);
  syncAuthUI(live);
  setBusy(false, live.tickets);

  on('draw-btn', 'click', onDraw);
  on('stock-stamp', 'click', (event) => {
    if (event.target.closest('a')) return;
    const live = readState();
    showDrawHint(isActivityClosed(live) ? '活动未开启' : '有奖品库存不足，请联系站长补货');
  });
  on('result-close', 'click', closeResult);
  on('result-code-btn', 'click', onCopyClick);
  $('history-list')?.addEventListener('click', onCopyClick);
  window.addEventListener('resize', () => {
    window.clearTimeout(scheduleSidePanelSync.tid);
    scheduleSidePanelSync.tid = window.setTimeout(scheduleSidePanelSync, 180);
  });
  const resultModal = $('result-modal');
  if (resultModal) {
    resultModal.addEventListener('click', (event) => {
      if (event.target === resultModal) closeResult();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('result-modal') && !$('result-modal').hidden) closeResult();
  });
  bootBgm();
  $('lottery-login')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = $('login-msg');
    try {
      await LotteryClient.login($('login-username').value.trim(), $('login-password').value);
      const fresh = await LotteryClient.getState();
      if (fresh?.isAdmin && !forcePlayWheel()) {
        location.replace('./admin.html');
        return;
      }
      void preloadPrizeIcons();
      buildWheel();
      renderStats(fresh);
      renderHistory(fresh.history);
      syncAuthUI(fresh);
      setBusy(false, fresh.tickets);
    } catch (err) {
      if (msg) {
        msg.hidden = false;
        msg.textContent = err.message;
      }
    }
  });
}

function syncAuthUI(state) {
  const hint = $('auth-hint');
  const chip = $('user-chip');
  const form = $('lottery-login');
  const needLogin = LotteryClient.mode === 'api' && !state.loggedIn;
  const admin = $('admin-link') || document.querySelector('.lz-w-admin-link');
  if (admin) admin.hidden = !(LotteryClient.mode === 'api' && state?.isAdmin);
  if (chip) chip.classList.toggle('is-out', Boolean(needLogin));
  if (form) form.hidden = !needLogin;
  if (!hint) return;
  hint.hidden = false;
  if (LotteryClient.mode === 'mock') {
    hint.textContent = '本地预览';
    if (form) form.hidden = true;
    return;
  }
  if (needLogin) {
    hint.textContent = '未登录';
    return;
  }
  hint.textContent = state.username || '已登录';
}

function bindHostForm() {
  renderConfig();
  on('cfg-draw-at', 'change', (event) => {
    const ts = new Date(event.target.value).getTime();
    if (Number.isNaN(ts)) return;
    const next = loadState();
    next.timed.drawAt = ts;
    next.timed.opened = false;
    next.timed.winners = [];
    saveState(next);
  });
  on('cfg-event-name', 'input', (event) => {
    const next = loadState();
    next.timed.name = event.target.value.slice(0, 20) || '周末额度抽奖';
    saveState(next);
  });
  on('cfg-base-count', 'input', (event) => {
    const next = loadState();
    next.timed.baseCount = Math.max(0, Math.min(500, Number(event.target.value) || 0));
    saveState(next);
  });
  document.querySelector('.lz-quick')?.addEventListener('click', (event) => {
    const sec = Number(event.target.dataset.in);
    if (sec) setDrawIn(sec);
  });
  on('timed-prize-editor', 'input', (event) => {
    const index = Number(event.target.dataset.index);
    const field = event.target.dataset.field;
    if (Number.isNaN(index) || !field) return;
    const next = loadState();
    if (!next.timed.prizes[index]) return;
    if (field === 'seats') {
      next.timed.prizes[index].seats = Math.max(1, Math.min(50, Number(event.target.value) || 1));
    } else if (field === 'quota') {
      next.timed.prizes[index].quota = Math.max(0, Number(event.target.value) || 0);
    } else if (field === 'hint') {
      next.timed.prizes[index].hint = event.target.value.slice(0, 16) || `奖项 ${index + 1}`;
    } else if (field === 'label') {
      next.timed.prizes[index].label = event.target.value.slice(0, 24);
    }
    saveState(next);
  });
  on('timed-prize-editor', 'click', (event) => {
    const btn = event.target.closest('[data-remove]');
    if (!btn) return;
    const index = Number(btn.dataset.remove);
    const next = loadState();
    if (next.timed.prizes.length <= 1) return;
    next.timed.prizes.splice(index, 1);
    saveState(next);
    renderTimedPrizeEditor(next);
  });
  on('add-prize', 'click', () => {
    const next = loadState();
    next.timed.prizes.push(makePrize(next.timed.prizes.length));
    saveState(next);
    renderTimedPrizeEditor(next);
  });
  on('reset-round', 'click', () => {
    const next = loadState();
    const keep = {
      name: next.timed.name,
      drawAt: next.timed.drawAt,
      baseCount: next.timed.baseCount,
      prizes: next.timed.prizes,
    };
    next.timed = { ...emptyTimed(), ...keep, opened: false, winners: [], joined: false };
    saveState(next);
    renderConfig();
  });
}

async function bootHost() {
  bindHostForm();
}

async function bootJoin() {
  renderTimed();
  on('join-btn', 'click', async () => {
    try {
      await LotteryClient.joinRound();
    } catch (err) {
      if (err.message !== 'TOO_LATE' && err.message !== 'ALREADY_OPENED') console.error(err);
    }
    renderTimed();
  });
  on('leave-btn', 'click', async () => {
    await LotteryClient.leaveRound();
    renderTimed();
  });
  setInterval(() => {
    renderCountdown(loadState());
    maybeOpenRound();
  }, 250);
}

function reasonLabel(reason) {
  return (
    {
      payment_grant: '支付入账',
      draw_consume: '抽奖消耗',
      prize_return: '奖项返还',
      admin_adjust: '手动补发',
    }[reason] || reason
  );
}

function topupKindLabel(kind) {
  return (
    {
      wallet: '钱包充值',
      subscription: '订阅订单',
      simulated: '模拟入账',
      missing: '未匹配充值单',
    }[kind] || ''
  );
}

function payStatusLabel(status) {
  return (
    {
      success: '已支付',
      pending: '待支付',
      failed: '失败',
      expired: '已过期',
    }[status] || status || ''
  );
}

function renderTopupCell(row) {
  if (row.reason !== 'payment_grant') {
    return row.refId ? `<span class="lz-ad-ref-muted">${escapeHtml(row.refId)}</span>` : '—';
  }
  const top = row.topup;
  const trade = (top && top.tradeNo) || row.refId || '';
  if (!trade) return '—';
  const bits = [];
  if (top && (top.kind === 'wallet' || top.kind === 'subscription')) {
    bits.push(`${Number(top.money || 0).toFixed(2)} 元`);
    if (top.paymentMethod) bits.push(escapeHtml(top.paymentMethod));
    if (top.status) bits.push(payStatusLabel(top.status));
  }
  const kind = topupKindLabel(top?.kind);
  if (kind) bits.push(kind);
  return `<div class="lz-ad-topup"><code title="${escapeHtml(trade)}">${escapeHtml(trade)}</code>${
    bits.length ? `<span>${bits.join(' · ')}</span>` : ''
  }</div>`;
}

function dayClock(ts) {
  const t = new Date(ts);
  return `${t.getMonth() + 1}/${t.getDate()} ${clock(ts)}`;
}

function dayBound(value, end) {
  if (!value) return null;
  const t = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(t.getTime()) ? null : t.getTime();
}

function inDateRange(ts, fromId, toId) {
  const from = dayBound($(fromId)?.value, false);
  const to = dayBound($(toId)?.value, true);
  if (from != null && ts < from) return false;
  if (to != null && ts > to) return false;
  return true;
}

function pageSlice(rows, page, size = PAGE_SIZE) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const current = Math.min(Math.max(1, page), pages);
  return {
    items: rows.slice((current - 1) * size, current * size),
    total,
    pages,
    current,
  };
}

function renderPager(el, info, onChange) {
  if (!el) return;
  if (!info.total) {
    el.replaceChildren();
    return;
  }
  el.innerHTML = `
    <span>共 ${info.total} 条 · ${info.current}/${info.pages} 页</span>
    <button type="button" data-dir="-1"${info.current <= 1 ? ' disabled' : ''}>上一页</button>
    <button type="button" data-dir="1"${info.current >= info.pages ? ' disabled' : ''}>下一页</button>
  `;
  el.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => onChange(info.current + Number(btn.dataset.dir)));
  });
}

function fillPrizeOptions(selectId) {
  const el = $(selectId);
  if (!el) return;
  const keep = el.value;
  const catalog =
    (LotteryClient.mode === 'api' && apiState?.prizeCatalog) ||
    loadState().prizeCatalog ||
    defaultCatalog();
  el.replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: '全部奖项' }),
    ...catalog.map((prize) =>
      Object.assign(document.createElement('option'), {
        value: prize.id,
        textContent: prize.label,
      }),
    ),
  );
  if ([...el.options].some((opt) => opt.value === keep)) el.value = keep;
}

function resetFields(ids) {
  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
}

async function renderDrawTable() {
  const body = document.querySelector('#draw-table tbody');
  if (!body) return;
  const filter = $('hist-draw-filter')?.value || 'all';
  const prizeId = $('hist-prize-filter')?.value || '';
  const from = $('hist-draw-from')?.value || '';
  const to = $('hist-draw-to')?.value || '';
  let rows = [];
  let pageInfo = { total: 0, pages: 1, current: 1, items: [] };
  if (LotteryClient.mode === 'api') {
    let data;
    try {
      data = await LotteryClient.listDraws({
        page: histDrawPage,
        filter,
        prize: prizeId,
        from,
        to,
      });
    } catch (err) {
      body.innerHTML = `<tr><td class="lz-w-empty-td" colspan="4">${emptyBlock(
        '记录加载失败',
        err.message === 'NEED_LOGIN' || /登录/.test(err.message || '') ? '请先登录后再查看' : (err.message || '请刷新重试'),
      )}</td></tr>`;
      renderPager($('hist-draw-pager'), { total: 0, pages: 1, current: 1 }, () => {});
      return;
    }
    rows = data?.items || [];
    pageInfo = {
      total: data.total,
      pages: Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE)),
      current: data.page || 1,
      items: rows,
    };
    histDrawPage = pageInfo.current;
  } else {
    rows = loadState().history || [];
    if (filter === 'win') rows = rows.filter((row) => row.win);
    if (filter === 'miss') rows = rows.filter((row) => !row.win);
    if (prizeId) rows = rows.filter((row) => row.id === prizeId);
    rows = rows.filter((row) => inDateRange(row.at, 'hist-draw-from', 'hist-draw-to'));
    pageInfo = pageSlice(rows, histDrawPage);
    histDrawPage = pageInfo.current;
    rows = pageInfo.items;
  }
  if (!pageInfo.total && !rows.length) {
    body.innerHTML = `<tr><td class="lz-w-empty-td" colspan="4">${emptyBlock(
      '还没有记录',
      filter === 'win' ? '抽中额度后会显示在这里，也可切换为「全部抽取」' : '抽奖后会出现在这里',
    )}</td></tr>`;
    renderPager($('hist-draw-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  body.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      const result = row.win ? escapeHtml(row.label) : '未中奖';
      const quota = row.extraTicket ? '+1 次' : row.quota ? formatMoney(row.quota) : '—';
      const code = row.redemptionKey ? escapeHtml(row.redemptionKey) : '—';
      tr.innerHTML = `<td>${dayClock(row.at)}</td><td class="${row.win ? 'lz-w-win' : 'lz-w-miss'}">${result}</td><td>${quota}</td><td>${code}</td>`;
      return tr;
    }),
  );
  renderPager($('hist-draw-pager'), pageInfo, (next) => {
    histDrawPage = next;
    renderDrawTable();
  });
}

async function renderLedgerTable() {
  const body = document.querySelector('#ledger-table tbody');
  if (!body) return;
  const type = $('hist-ledger-filter')?.value || 'all';
  const from = $('hist-ledger-from')?.value || '';
  const to = $('hist-ledger-to')?.value || '';
  let rows = [];
  let pageInfo = { total: 0, pages: 1, current: 1, items: [] };
  if (LotteryClient.mode === 'api') {
    const data = await LotteryClient.listLedger({
      page: histLedgerPage,
      filter: type,
      from,
      to,
    });
    rows = data.items;
    pageInfo = {
      total: data.total,
      pages: Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE)),
      current: data.page || 1,
      items: rows,
    };
    histLedgerPage = pageInfo.current;
  } else {
    rows = loadState().ticketLog || [];
    if (type !== 'all') rows = rows.filter((row) => row.reason === type);
    rows = rows.filter((row) => inDateRange(row.at, 'hist-ledger-from', 'hist-ledger-to'));
    pageInfo = pageSlice(rows, histLedgerPage);
    histLedgerPage = pageInfo.current;
    rows = pageInfo.items;
  }
  if (!pageInfo.total && !rows.length) {
    body.innerHTML = `<tr><td class="lz-w-empty-td" colspan="5">${emptyBlock(
      '还没有流水',
      '支付入账和抽奖消耗会出现在这里',
    )}</td></tr>`;
    renderPager($('hist-ledger-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  body.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      const delta = row.delta > 0 ? `+${row.delta}` : String(row.delta);
      tr.innerHTML = `<td>${dayClock(row.at)}</td><td>${reasonLabel(row.reason)}</td><td>${delta}</td><td>${row.balanceAfter}</td><td>${escapeHtml(row.refId || '—')}</td>`;
      return tr;
    }),
  );
  renderPager($('hist-ledger-pager'), pageInfo, (next) => {
    histLedgerPage = next;
    renderLedgerTable();
  });
}

async function bootSettings() {
  renderWeightEditor();
  const state = loadState();
  const per = $('cfg-tickets-per');
  if (per) per.value = String(state.ticketsPerPayment || 1);
  setText('cfg-per-pay', String(state.ticketsPerPayment || 1));
  on('cfg-tickets-per', 'input', (event) => {
    const next = loadState();
    next.ticketsPerPayment = Math.max(1, Math.min(10, Number(event.target.value) || 1));
    saveState(next);
    setText('cfg-per-pay', String(next.ticketsPerPayment));
  });
  on('weight-editor', 'input', (event) => {
    const id = event.target.dataset.id;
    if (id) setWeight(id, event.target.value);
  });
  on('reset-weights', 'click', () => {
    const next = loadState();
    next.weights = emptyState().weights;
    saveState(next);
    renderWeightEditor();
  });
  on('mock-pay', 'click', async () => {
    const res = await LotteryClient.grantFromPayment();
    const msg = $('mock-pay-msg');
    if (msg) msg.textContent = `已入账 ${res.refId}，当前次数 ${res.tickets}`;
  });
}

async function bootHistory() {
  await LotteryClient.connect();
  fillPrizeOptions('hist-prize-filter');
  const applyDraws = () => {
    histDrawPage = 1;
    renderDrawTable();
  };
  const applyLedger = () => {
    histLedgerPage = 1;
    renderLedgerTable();
  };
  ['hist-draw-filter', 'hist-prize-filter', 'hist-draw-from', 'hist-draw-to'].forEach((id) => {
    on(id, 'change', applyDraws);
  });
  ['hist-ledger-filter', 'hist-ledger-from', 'hist-ledger-to'].forEach((id) => {
    on(id, 'change', applyLedger);
  });
  on('hist-draw-reset', 'click', () => {
    resetFields(['hist-draw-filter', 'hist-prize-filter', 'hist-draw-from', 'hist-draw-to']);
    applyDraws();
  });
  on('hist-ledger-reset', 'click', () => {
    resetFields(['hist-ledger-filter', 'hist-ledger-from', 'hist-ledger-to']);
    applyLedger();
  });
  renderDrawTable();
  renderLedgerTable();
  const live = await LotteryClient.getState().catch(() => readState());
  syncAuthUI(live);
}

function showAdminView(name) {
  document.querySelectorAll('.lz-ad-view').forEach((el) => {
    el.hidden = el.id !== `view-${name}`;
  });
  document.querySelectorAll('.lz-ad-nav button').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.view === name);
  });
}

function isoDay(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function todayISO() {
  return isoDay(new Date());
}

function weekStartISO() {
  const d = new Date();
  const wd = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (wd - 1));
  return isoDay(d);
}

function emptyPeriod() {
  return { draws: 0, wins: 0, users: 0, won_quota: 0 };
}

function localPeriodStats(fromMs) {
  const rows = (loadState().adminDraws || []).filter((row) => !fromMs || Number(row.at) >= fromMs);
  return {
    draws: rows.length,
    wins: rows.filter((row) => row.win).length,
    users: new Set(rows.map((row) => row.userId || row.username)).size,
    won_quota: rows.reduce((sum, row) => sum + (Number(row.quota) || 0), 0),
  };
}

function localPrizeStats(fromMs) {
  const map = new Map();
  (loadState().adminDraws || []).forEach((row) => {
    if (fromMs && Number(row.at) < fromMs) return;
    const code = row.prizeId || row.label || 'other';
    const cur = map.get(code) || { code, label: row.label || code, draws: 0, wins: 0, quota: 0 };
    cur.draws += 1;
    if (row.win) cur.wins += 1;
    cur.quota += Number(row.quota) || 0;
    map.set(code, cur);
  });
  return [...map.values()].sort((a, b) => b.quota - a.quota || b.draws - a.draws);
}

function periodFromOverview(key) {
  const o = apiState?.overview;
  if (o?.[key] && typeof o[key] === 'object') {
    return {
      draws: o[key].draws || 0,
      wins: o[key].wins || 0,
      users: o[key].users || 0,
      won_quota: o[key].won_quota || o[key].wonQuota || 0,
    };
  }
  if (key === 'today') return { ...emptyPeriod(), draws: o?.today_draws || 0 };
  if (key === 'all') {
    return {
      draws: o?.draws || 0,
      wins: 0,
      users: o?.users || 0,
      won_quota: o?.won_quota || 0,
    };
  }
  return emptyPeriod();
}

function paintPeriodKpis(stats) {
  const root = $('dash-kpis');
  if (!root) return;
  root.innerHTML = `
    <li><span>抽取</span><strong>${stats.draws || 0}</strong></li>
    <li><span>中奖</span><strong>${stats.wins || 0}</strong></li>
    <li><span>发放额度</span><strong>${formatMoney(stats.won_quota || 0)}</strong></li>
    <li><span>参与用户</span><strong>${stats.users || 0}</strong></li>
  `;
}

function dashRange() {
  if (dashPeriod === 'week') return { from: weekStartISO(), to: todayISO(), label: '本周' };
  if (dashPeriod === 'all') return { from: '', to: '', label: '累计' };
  return { from: todayISO(), to: todayISO(), label: '今日' };
}

function dashPrizeRows() {
  const o = apiState?.overview || {};
  if (dashPeriod === 'week') return o.week_prizes || o.weekPrizes || [];
  if (dashPeriod === 'all') return o.all_prizes || o.allPrizes || [];
  return o.today_prizes || o.todayPrizes || [];
}

function hasPeriodStats(key) {
  const block = apiState?.overview?.[key];
  return Boolean(block && typeof block === 'object' && ('draws' in block || 'wins' in block));
}

function statsFromDraws(rows, total) {
  const list = rows || [];
  return {
    draws: total ?? list.length,
    wins: list.filter((row) => row.win).length,
    users: new Set(list.map((row) => row.userId || row.username)).size,
    won_quota: list.reduce((sum, row) => sum + (Number(row.quota) || 0), 0),
  };
}

function prizesFromDraws(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const code = row.prizeId || row.label || 'other';
    const cur = map.get(code) || { code, label: row.label || code, draws: 0, wins: 0, quota: 0 };
    cur.draws += 1;
    if (row.win) cur.wins += 1;
    cur.quota += Number(row.quota) || 0;
    map.set(code, cur);
  });
  return [...map.values()].sort((a, b) => b.quota - a.quota || b.draws - a.draws);
}

async function hydrateDashOverview() {
  if (LotteryClient.mode !== 'api' || hasPeriodStats('today')) return;
  const o = apiState?.overview || {};
  const today = await LotteryClient.listAdminDraws({ page: 1, from: todayISO(), to: todayISO(), pageSize: 100 });
  const week = await LotteryClient.listAdminDraws({ page: 1, from: weekStartISO(), to: todayISO(), pageSize: 100 });
  apiState.overview = {
    ...o,
    today: statsFromDraws(today.items, today.total),
    week: statsFromDraws(week.items, week.total),
    all: {
      draws: o.draws || 0,
      wins: 0,
      users: o.users || 0,
      won_quota: o.won_quota || 0,
    },
    today_prizes: prizesFromDraws(today.items),
    week_prizes: prizesFromDraws(week.items),
    all_prizes: prizesFromDraws([...(today.items || []), ...(week.items || [])]),
  };
}

function renderDashPeriods() {
  if (LotteryClient.mode === 'api' && apiState?.overview) {
    paintPeriodKpis(periodFromOverview(dashPeriod));
    return;
  }
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const wd = now.getDay() || 7;
  const weekStart = todayStart - (wd - 1) * 86400000;
  const fromMs = dashPeriod === 'all' ? 0 : dashPeriod === 'week' ? weekStart : todayStart;
  paintPeriodKpis(localPeriodStats(fromMs));
}

async function renderDashPrizeTable() {
  const body = document.querySelector('#dash-prize-table tbody');
  if (!body) return;
  let rows = [];
  if (LotteryClient.mode === 'api' && apiState?.overview) {
    rows = dashPrizeRows();
    if (!rows.length && dashPeriod === 'all') {
      const data = await LotteryClient.listAdminDraws({ page: 1, pageSize: 100 });
      rows = prizesFromDraws(data.items);
    }
  } else {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const wd = now.getDay() || 7;
    const fromMs = dashPeriod === 'all' ? 0 : dashPeriod === 'week' ? todayStart - (wd - 1) * 86400000 : todayStart;
    rows = localPrizeStats(fromMs);
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4">这段时间还没有抽取</td></tr>';
    return;
  }
  body.replaceChildren(...rows.map((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.label || row.code || '')}</td><td>${row.draws || 0}</td><td>${row.wins || 0}</td><td>${formatMoney(row.quota || 0)}</td>`;
    return tr;
  }));
}

async function renderDashDraws() {
  const body = document.querySelector('#dash-draw-table tbody');
  if (!body) return;
  const range = dashRange();
  const paint = (row) => {
    const tr = document.createElement('tr');
    const quota = row.extraTicket ? '+1 次' : row.quota ? formatMoney(row.quota) : '—';
    tr.innerHTML = `<td>${dayClock(row.at)}</td><td>${userWho(row.userId, row.username)}</td><td class="${row.win ? 'lz-ad-win' : 'lz-ad-miss'}">${escapeHtml(row.label || '')}</td><td>${quota}</td>`;
    return tr;
  };
  if (LotteryClient.mode === 'api') {
    const data = await LotteryClient.listAdminDraws({
      page: dashDrawPage,
      from: range.from,
      to: range.to,
    });
    const meta = $('dash-draw-meta');
    if (meta) meta.textContent = data.total ? `${range.label} ${data.total} 条` : '';
    if (!data.total) {
      body.innerHTML = '<tr><td colspan="4">这段时间还没有抽取</td></tr>';
      renderPager($('dash-draw-pager'), { total: 0, pages: 1, current: 1 }, () => {});
      return;
    }
    body.replaceChildren(...(data.items || []).map(paint));
    renderPager($('dash-draw-pager'), adminPager(data.total, data.page || 1), (next) => {
      dashDrawPage = next;
      renderDashDraws();
    });
    return;
  }
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const wd = now.getDay() || 7;
  const fromMs = dashPeriod === 'all' ? 0 : dashPeriod === 'week' ? todayStart - (wd - 1) * 86400000 : todayStart;
  const rows = (loadState().adminDraws || []).filter((row) => !fromMs || Number(row.at) >= fromMs);
  const meta = $('dash-draw-meta');
  if (meta) meta.textContent = rows.length ? `${range.label} ${rows.length} 条` : '';
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4">这段时间还没有抽取</td></tr>';
    renderPager($('dash-draw-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  const page = pageSlice(rows, dashDrawPage, ADMIN_PAGE_SIZE);
  dashDrawPage = page.current;
  body.replaceChildren(...page.items.map(paint));
  renderPager($('dash-draw-pager'), page, (next) => {
    dashDrawPage = next;
    renderDashDraws();
  });
}

function prizeRowsOf(key) {
  const o = apiState?.overview || {};
  if (key === 'week') return o.week_prizes || o.weekPrizes || [];
  if (key === 'all') return o.all_prizes || o.allPrizes || [];
  return o.today_prizes || o.todayPrizes || [];
}

function paintBarChart(id, rows) {
  const root = $(id);
  if (!root) return;
  if (!rows.length) {
    root.innerHTML = '<p class="lz-ad-chart-empty">暂无数据</p>';
    return;
  }
  const max = Math.max(1, ...rows.map((row) => Number(row.draws) || 0));
  root.innerHTML = rows.map((row) => {
    const n = Number(row.draws) || 0;
    const pct = n ? Math.max(8, Math.round((n / max) * 100)) : 0;
    const muted = /未中|再抽/.test(String(row.label || ''));
    return `<div class="lz-ad-bar${muted ? ' is-muted' : ''}"><span class="lz-ad-bar-name">${escapeHtml(row.label || row.code || '')}</span><div class="lz-ad-bar-track"><i style="width:${pct}%"></i></div><strong>${n}</strong></div>`;
  }).join('');
}

function renderDashCharts() {
  let today = [];
  let week = [];
  if (LotteryClient.mode === 'api' && apiState?.overview) {
    today = prizeRowsOf('today');
    week = prizeRowsOf('week');
  } else {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const wd = now.getDay() || 7;
    today = localPrizeStats(todayStart);
    week = localPrizeStats(todayStart - (wd - 1) * 86400000);
  }
  paintBarChart('dash-chart-today', today);
  paintBarChart('dash-chart-week', week);
}

async function renderAdminDashboard() {
  await hydrateDashOverview();
  renderDashPeriods();
  renderDashCharts();
  await renderDashPrizeTable();
  return renderDashDraws();
}

function renderAdminKpis() {
  renderDashPeriods();
}

function adminCatalog() {
  if (LotteryClient.mode === 'api' && apiState?.prizeCatalog) return apiState.prizeCatalog;
  return loadState().prizeCatalog || [];
}

function prizeKind(prize) {
  if (prize?.extraTicket) return 'again';
  if (Number(prize?.quota) > 0) return 'quota';
  return 'miss';
}

function applyPrizeKind(item, kind) {
  if (kind === 'again') {
    item.extraTicket = true;
    item.quota = 0;
    return;
  }
  item.extraTicket = false;
  if (kind === 'quota') {
    if (!(Number(item.quota) > 0)) item.quota = 1;
    return;
  }
  item.quota = 0;
}

function parseCardKeys(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseCodeFileText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].split(/[,;\t]/).map((cell) => cell.trim());
  const headerIdx = first.findIndex((cell) => /^(key|code|兑换码)$/i.test(cell));
  if (headerIdx >= 0) {
    return lines.slice(1).map((line) => {
      const cells = line.split(/[,;\t]/).map((cell) => cell.trim());
      return cells[headerIdx] || cells.find((cell) => /^[A-Za-z0-9_-]{4,32}$/.test(cell)) || '';
    }).filter(Boolean);
  }
  return parseCardKeys(raw);
}

function guessPrizeFromFilename(filename) {
  const prizes = adminCatalog().filter((prize) => prizeKind(prize) === 'quota' && prize.dbId);
  let base = String(filename || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  base = base.replace(/\s*\(\d+\)\s*$/, '').trim();
  const raw = base.toLowerCase().replace(/\$/g, '').replace(/,/g, '.').trim();
  if (!raw) return null;
  const byCode = prizes.find((prize) => String(prize.id || prize.code || '').toLowerCase() === raw);
  if (byCode) return byCode;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    const hit = prizes.find((prize) => Math.abs(Number(prize.quota) - num) < 0.001);
    if (hit) return hit;
  }
  return prizes.find((prize) => {
    const label = String(prize.label || '').toLowerCase().replace(/\$/g, '');
    return label === raw || label.startsWith(raw) || raw.startsWith(label);
  }) || null;
}

function codeCopyButton(key) {
  const raw = String(key || '').trim();
  if (!raw) return '—';
  const safe = escapeHtml(raw);
  return `<button type="button" class="lz-ad-code" data-copy="${safe}" title="点击复制">${safe}</button>`;
}

function userWho(id, username) {
  const name = escapeHtml(username || '');
  if (id) {
    return `<span class="lz-ad-user"><span class="lz-ad-id">${id}</span>${name ? `<strong>${name}</strong>` : ''}</span>`;
  }
  return name || '—';
}

function updateCodeKeysCount() {
  const n = parseCardKeys($('code-keys')?.value || '').length;
  const el = $('code-keys-count');
  if (el) el.textContent = n ? `将入库 ${n} 个` : '';
}

function updateDrawFocus() {
  const el = $('admin-draw-focus');
  const nameEl = $('admin-draw-focus-name');
  const q = ($('admin-user-q')?.value || '').trim();
  if (!el) return;
  if (!q && !adminSelectedUserId) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (nameEl) {
    nameEl.textContent = adminSelectedUserId && q && q !== adminSelectedUserId
      ? `${adminSelectedUserId} / ${q}`
      : (q || adminSelectedUserId);
  }
}

function fillDrawsFromUser(row) {
  const id = String(row.user_id || row.userId || '');
  const name = row.username || '';
  adminSelectedUserId = id;
  if ($('admin-user-q')) $('admin-user-q').value = name || id;
  updateDrawFocus();
  adminDrawPage = 1;
  document.querySelectorAll('#admin-user-table tbody tr').forEach((tr) => {
    tr.classList.toggle('is-on', tr.dataset.userId === id);
  });
  showUserTab('draws');
}

function showUserTab(name) {
  adminUserTab = name === 'draws' ? 'draws' : 'summary';
  document.querySelectorAll('[data-user-tab]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.userTab === adminUserTab);
  });
  const summary = $('user-tab-summary');
  const draws = $('user-tab-draws');
  if (summary) summary.hidden = adminUserTab !== 'summary';
  if (draws) draws.hidden = adminUserTab !== 'draws';
  if (adminUserTab === 'summary') renderAdminUsers();
  else renderAdminDraws();
}

function clearSelectedDrawUser() {
  adminSelectedUserId = '';
  if ($('admin-user-q')) $('admin-user-q').value = '';
  updateDrawFocus();
  adminDrawPage = 1;
  document.querySelectorAll('#admin-user-table tbody tr').forEach((tr) => tr.classList.remove('is-on'));
  renderAdminDraws();
}

function renderCodeStockChips() {
  const root = $('code-stock-chips');
  if (!root) return;
  const prizes = adminCatalog().filter((prize) => prizeKind(prize) === 'quota' && prize.dbId);
  const current = $('code-filter-prize')?.value || '';
  const nodes = [];
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `lz-ad-chip${!current ? ' is-on' : ''}`;
  allBtn.textContent = '全部奖项';
  allBtn.addEventListener('click', () => {
    if ($('code-filter-prize')) $('code-filter-prize').value = '';
    adminCodePage = 1;
    renderAdminCodes();
  });
  nodes.push(allBtn);
  prizes.forEach((prize) => {
    const btn = document.createElement('button');
    const id = String(prize.dbId);
    const empty = (prize.stock || 0) <= 0;
    btn.type = 'button';
    btn.className = `lz-ad-chip${id === current ? ' is-on' : ''}${empty ? ' is-empty' : ''}`;
    btn.textContent = `${prize.label} 未用 ${prize.stock || 0}`;
    btn.addEventListener('click', () => {
      const next = id === current ? '' : id;
      if ($('code-filter-prize')) $('code-filter-prize').value = next;
      if (next && $('code-prize')) $('code-prize').value = next;
      adminCodePage = 1;
      renderAdminCodes();
    });
    nodes.push(btn);
  });
  root.replaceChildren(...nodes);
}

function quotaPrizes() {
  return adminCatalog().filter((prize) => prizeKind(prize) === 'quota' && prize.dbId);
}

function renderCodeImportPreview() {
  const list = $('code-import-list');
  const allBtn = $('code-import-all');
  if (!list) return;
  if (!pendingCodeFiles.length) {
    list.hidden = true;
    list.replaceChildren();
    if (allBtn) allBtn.hidden = true;
    return;
  }
  const prizes = quotaPrizes();
  list.hidden = false;
  list.replaceChildren(
    ...pendingCodeFiles.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'lz-ad-import-row';
      const options = [
        '<option value="">选择额度奖</option>',
        ...prizes.map((prize) => {
          const selected = String(prize.dbId) === String(item.prizeId) ? ' selected' : '';
          return `<option value="${prize.dbId}"${selected}>${escapeHtml(prize.label)}</option>`;
        }),
      ].join('');
      row.innerHTML = `<strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span>${item.keys.length} 个</span><select data-import-prize="${index}">${options}</select>`;
      row.querySelector('select')?.addEventListener('change', (event) => {
        item.prizeId = event.target.value;
        const prize = prizes.find((p) => String(p.dbId) === String(item.prizeId));
        item.prizeLabel = prize?.label || '';
        if (pendingCodeFiles.length === 1 && item.prizeId && $('code-prize')) {
          $('code-prize').value = String(item.prizeId);
        }
        if (allBtn) allBtn.hidden = !pendingCodeFiles.some((file) => file.prizeId && file.keys.length);
      });
      return row;
    }),
  );
  if (allBtn) allBtn.hidden = !pendingCodeFiles.some((item) => item.prizeId && item.keys.length);
}

async function loadCodeFiles(fileList) {
  const files = [...(fileList || [])].filter((file) => file && file.size);
  if (!files.length) return;
  pendingCodeFiles = [];
  for (const file of files) {
    const text = await file.text();
    const keys = parseCodeFileText(text);
    const prize = guessPrizeFromFilename(file.name);
    pendingCodeFiles.push({
      name: file.name,
      keys,
      prizeId: prize?.dbId ? String(prize.dbId) : '',
      prizeLabel: prize?.label || '',
    });
  }
  renderCodeImportPreview();
  if (pendingCodeFiles.length === 1) {
    const item = pendingCodeFiles[0];
    if (item.prizeId && $('code-prize')) $('code-prize').value = String(item.prizeId);
    if ($('code-keys')) $('code-keys').value = item.keys.join('\n');
    updateCodeKeysCount();
  } else if ($('code-keys')) {
    $('code-keys').value = '';
    updateCodeKeysCount();
  }
  const msg = $('code-msg');
  if (msg) {
    msg.hidden = false;
    const named = pendingCodeFiles.filter((item) => item.prizeId).length;
    const empty = pendingCodeFiles.filter((item) => !item.keys.length).length;
    if (empty && !pendingCodeFiles.some((item) => item.keys.length)) {
      msg.textContent = '文件里没有读到兑换码';
    } else if (named === pendingCodeFiles.length) {
      msg.textContent = `已读取 ${pendingCodeFiles.length} 个文件，可点「按文件全部入库」`;
    } else {
      msg.textContent = '已读取文件。认不出额度奖的请手动选择后再入库。';
    }
  }
}

function codeMsg(text) {
  const msg = $('code-msg');
  if (!msg) return;
  msg.hidden = false;
  msg.textContent = text;
}

async function importPendingCodeFiles() {
  const ready = pendingCodeFiles.filter((item) => item.prizeId && item.keys.length);
  if (!ready.length) {
    codeMsg('请先为文件选择额度奖');
    return;
  }
  if (LotteryClient.mode !== 'api') {
    codeMsg('需要管理员登录后才能入库');
    return;
  }
  const ok = await askConfirm({
    title: '导入兑换码',
    text: `将按文件入库：${ready.map((item) => `${item.name} → ${item.prizeLabel || item.prizeId}（${item.keys.length} 个）`).join('；')}`,
    ok: '入库',
  });
  if (!ok) return;
  const btn = $('code-import-all');
  if (btn) btn.disabled = true;
  let added = 0;
  let lastPrize = '';
  try {
    for (const item of ready) {
      const res = await LotteryClient.generateStock(Number(item.prizeId), item.keys);
      added += res.count || item.keys.length;
      lastPrize = item.prizeId;
    }
    await LotteryClient.loadAdmin();
    renderAdminPrizes();
    pendingCodeFiles = [];
    renderCodeImportPreview();
    if ($('code-keys')) $('code-keys').value = '';
    updateCodeKeysCount();
    codeMsg(`已入库 ${added} 个。`);
    adminCodePage = 1;
    if (lastPrize && $('code-filter-prize')) $('code-filter-prize').value = String(lastPrize);
    renderAdminCodes();
  } catch (err) {
    codeMsg(err.message || '导入失败');
    await LotteryClient.loadAdmin();
    renderAdminPrizes();
    renderAdminCodes();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function askConfirm({ title = '确认删除', text = '确定删除吗？', ok = '删除' } = {}) {
  const modal = $('confirm-modal');
  const titleEl = $('confirm-title');
  const textEl = $('confirm-text');
  const okBtn = $('confirm-ok');
  const cancelBtn = $('confirm-cancel');
  if (!modal || !okBtn) return Promise.resolve(window.confirm(text));
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
  okBtn.textContent = ok;
  modal.hidden = false;
  okBtn.focus();
  return new Promise((resolve) => {
    const done = (value) => {
      modal.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onOverlay = (event) => {
      if (event.target.id === 'confirm-modal') done(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') done(false);
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

function fillQuotaPrizeOptions(selectId, { allLabel = '', value } = {}) {
  const el = $(selectId);
  if (!el) return;
  const keep = value != null ? String(value) : el.value;
  const prizes = adminCatalog().filter((prize) => prizeKind(prize) === 'quota' && prize.dbId);
  const nodes = [];
  if (allLabel) {
    nodes.push(Object.assign(document.createElement('option'), { value: '', textContent: allLabel }));
  }
  prizes.forEach((prize) => {
    nodes.push(Object.assign(document.createElement('option'), {
      value: String(prize.dbId),
      textContent: `${prize.label}（未用 ${prize.stock || 0}）`,
    }));
  });
  el.replaceChildren(...nodes);
  if ([...el.options].some((opt) => opt.value === keep)) el.value = keep;
}

function codeStatusLabel(status) {
  if (status === 'used') return '已兑换';
  if (status === 'pending') return '待兑换';
  if (status === 'disabled') return '已停用';
  if (status === 'expired') return '已过期';
  return '未发放';
}

function codeTimeMs(value) {
  const n = Number(value) || 0;
  if (!n) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function openCodesView(prizeDbId) {
  showAdminView('codes');
  fillQuotaPrizeOptions('code-prize');
  fillQuotaPrizeOptions('code-filter-prize', { allLabel: '全部额度奖' });
  if (prizeDbId) {
    if ($('code-prize')) $('code-prize').value = String(prizeDbId);
    if ($('code-filter-prize')) $('code-filter-prize').value = String(prizeDbId);
  }
  adminCodePage = 1;
  renderAdminCodes();
}

async function renderAdminCodes() {
  const body = document.querySelector('#admin-code-table tbody');
  if (!body) return;
  fillQuotaPrizeOptions('code-prize');
  fillQuotaPrizeOptions('code-filter-prize', { allLabel: '全部额度奖' });
  renderCodeStockChips();
  updateCodeKeysCount();
  if (LotteryClient.mode !== 'api') {
    body.innerHTML = '<tr><td colspan="7">需要管理员登录后才能管理兑换码</td></tr>';
    renderPager($('admin-code-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  const data = await LotteryClient.listCodes({
    page: adminCodePage,
    prizeId: $('code-filter-prize')?.value || '',
    status: $('code-filter-status')?.value || 'all',
    q: ($('code-filter-q')?.value || '').trim(),
  });
  const meta = $('code-meta');
  if (meta) meta.textContent = data.total ? `共 ${data.total} 个兑换码` : '';
  if (!data.total) {
    body.innerHTML = '<tr><td colspan="7">没有匹配的兑换码，可在右侧导入或粘贴入库</td></tr>';
    renderPager($('admin-code-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  body.replaceChildren(
    ...(data.items || []).map((row) => {
      const tr = document.createElement('tr');
      const status = row.status || 'unused';
      const when = codeTimeMs(status === 'used' ? row.redeemed_time : row.created_time);
      const issuedId = row.used_user_id || row.usedUserId;
      const issuedName = row.used_username || row.usedUsername || '';
      const del = row.can_delete
        ? `<button type="button" class="lz-ad-del" data-code-del="${row.id}">删除</button>`
        : '—';
      tr.innerHTML = `
        <td>${codeCopyButton(row.key)}</td>
        <td>${escapeHtml(row.prize_label || '—')}</td>
        <td>${row.quota_amount ? formatMoney(row.quota_amount) : '—'}</td>
        <td class="lz-ad-status-${status}">${codeStatusLabel(status)}</td>
        <td>${issuedId || issuedName ? userWho(issuedId, issuedName) : '—'}</td>
        <td>${when ? dayClock(when) : '—'}</td>
        <td>${del}</td>
      `;
      return tr;
    }),
  );
  renderPager($('admin-code-pager'), adminPager(data.total, data.page || 1), (next) => {
    adminCodePage = next;
    renderAdminCodes();
  });
}

function renderAdminPrizes() {
  const body = document.querySelector('#admin-prize-table tbody');
  if (!body) return;
  const list = adminCatalog();
  const live = list.filter((item) => item.enabled !== false);
  body.replaceChildren(
    ...list.map((prize, index) => {
      const tr = document.createElement('tr');
      const pct = prize.enabled === false ? '—' : oddsPercent(prize.weight, live);
      const kind = prizeKind(prize);
      const kindCell = `<select data-i="${index}" data-f="kind">
        <option value="miss"${kind === 'miss' ? ' selected' : ''}>谢谢参与</option>
        <option value="again"${kind === 'again' ? ' selected' : ''}>再来一次</option>
        <option value="quota"${kind === 'quota' ? ' selected' : ''}>额度奖</option>
      </select>`;
      const quotaDisabled = kind !== 'quota' ? 'disabled' : '';
      const stockCell = kind === 'quota'
        ? `<div class="lz-ad-stock"><strong>${prize.stock || 0}</strong> 未用 <button type="button" class="lz-ad-ghost" data-codes="${index}">管理</button></div>`
        : '—';
      tr.innerHTML = `
        <td><input type="text" data-i="${index}" data-f="label" value="${escapeHtml(prize.label)}" maxlength="16"></td>
        <td><input type="text" data-i="${index}" data-f="short" value="${escapeHtml(prize.short || '')}" maxlength="8"></td>
        <td>${kindCell}</td>
        <td><input type="number" data-i="${index}" data-f="quota" min="0" step="0.01" value="${prize.quota || 0}" ${quotaDisabled}></td>
        <td>${stockCell}</td>
        <td><input type="number" data-i="${index}" data-f="weight" min="0" max="999" value="${prize.weight}"></td>
        <td>${pct}</td>
        <td><input type="checkbox" data-i="${index}" data-f="enabled" ${prize.enabled !== false ? 'checked' : ''}></td>
        <td><button type="button" class="lz-ad-del" data-remove="${index}" ${list.length <= 1 ? 'disabled' : ''}>删除</button></td>
      `;
      return tr;
    }),
  );
}

let prizeSaveTimer = 0;
function patchAdminPrize(index, field, value, refresh) {
  if (LotteryClient.mode === 'api' && apiState?.prizeCatalog) {
    const item = apiState.prizeCatalog[index];
    if (!item) return;
    if (field === 'weight' || field === 'quota') item[field] = Math.max(0, Number(value) || 0);
    else if (field === 'kind') applyPrizeKind(item, value);
    else if (field === 'extraTicket' || field === 'enabled') item[field] = Boolean(value);
    else item[field] = String(value).slice(0, 32);
    if (field === 'quota' && Number(item.quota) > 0) item.extraTicket = false;
    if (refresh || field === 'kind' || field === 'quota') renderAdminPrizes();
    clearTimeout(prizeSaveTimer);
    prizeSaveTimer = setTimeout(() => {
      LotteryClient.savePrize(item).then((saved) => {
        apiState.prizeCatalog[index] = { ...item, ...saved };
        renderAdminPrizes();
      }).catch((err) => {
        const msg = $('mock-pay-msg');
        if (msg) msg.textContent = err.message;
      });
    }, 400);
    return;
  }
  const next = loadState();
  const item = next.prizeCatalog?.[index];
  if (!item) return;
  if (field === 'weight' || field === 'quota') item[field] = Math.max(0, Number(value) || 0);
  else if (field === 'kind') applyPrizeKind(item, value);
  else if (field === 'extraTicket' || field === 'enabled') item[field] = Boolean(value);
  else item[field] = String(value).slice(0, 32);
  if (field === 'quota' && Number(item.quota) > 0) item.extraTicket = false;
  saveState(next);
  if (refresh || field === 'kind' || field === 'quota') renderAdminPrizes();
}

async function renderAdminUsers() {
  const body = document.querySelector('#admin-user-table tbody');
  if (!body) return;
  const q = ($('admin-summary-q')?.value || '').trim();
  const meta = $('admin-user-meta');
  const paintRows = (items) => {
    body.replaceChildren(
      ...items.map((row) => {
        const tr = document.createElement('tr');
        const id = String(row.user_id || row.userId || '');
        tr.className = 'is-pick';
        tr.dataset.userId = id;
        if (adminSelectedUserId && id === adminSelectedUserId) tr.classList.add('is-on');
        tr.innerHTML = `<td class="lz-ad-id">${id || '—'}</td><td>${escapeHtml(row.username || '')}</td><td>${row.tickets ?? '—'}</td><td>${row.draws}</td><td>${row.wins}</td><td>${formatMoney(row.quota)}</td><td>${dayClock(row.last_at ? row.last_at * 1000 : (row.last || 0))}</td>`;
        tr.addEventListener('click', () => fillDrawsFromUser(row));
        return tr;
      }),
    );
  };
  if (LotteryClient.mode === 'api') {
    const data = await LotteryClient.listAdminUsers(adminUserPage, q);
    if (meta) meta.textContent = data.total ? `共 ${data.total} 人，点一行查看抽取明细` : (q ? '没有匹配用户' : '');
    if (!data.total) {
      body.innerHTML = `<tr><td colspan="7">${q ? '没有匹配用户' : '暂无用户记录。点一行可查看抽取明细。'}</td></tr>`;
      renderPager($('admin-user-pager'), { total: 0, pages: 1, current: 1 }, () => {});
      return;
    }
    paintRows(data.items || []);
    renderPager($('admin-user-pager'), adminPager(data.total, data.page || 1), (next) => {
      adminUserPage = next;
      renderAdminUsers();
    });
    return;
  }
  const map = new Map();
  (loadState().adminDraws || []).forEach((row) => {
    const cur = map.get(row.username) || { username: row.username, user_id: row.userId, draws: 0, wins: 0, quota: 0, last: 0 };
    cur.draws += 1;
    if (row.win) cur.wins += 1;
    cur.quota += Number(row.quota) || 0;
    cur.last = Math.max(cur.last, row.at);
    map.set(row.username, cur);
  });
  let rows = [...map.values()].sort((a, b) => b.last - a.last);
  if (q) {
    rows = rows.filter((row) => String(row.user_id || '') === q || String(row.username || '').includes(q));
  }
  if (meta) meta.textContent = rows.length ? `共 ${rows.length} 人，点一行查看抽取明细` : (q ? '没有匹配用户' : '');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7">${q ? '没有匹配用户' : '暂无用户记录'}</td></tr>`;
    renderPager($('admin-user-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  const page = pageSlice(rows, adminUserPage, ADMIN_PAGE_SIZE);
  adminUserPage = page.current;
  paintRows(page.items);
  renderPager($('admin-user-pager'), page, (next) => {
    adminUserPage = next;
    renderAdminUsers();
  });
}

function fillGrantFromWallet(row) {
  const idInput = $('grant-user-id');
  if (idInput) idInput.value = String(row.user_id || row.userId || '');
  document.querySelectorAll('#wallet-lookup-table tbody tr').forEach((tr) => {
    tr.classList.toggle('is-on', String(tr.dataset.userId) === String(row.user_id || row.userId));
  });
  const msg = $('grant-tickets-msg');
  if (msg) {
    const name = row.username || '';
    msg.textContent = `已选 ${row.user_id}${name ? ` / ${name}` : ''}，当前剩余 ${row.tickets ?? 0} 次。`;
  }
}

async function renderWalletLookup() {
  const body = document.querySelector('#wallet-lookup-table tbody');
  if (!body) return;
  const q = ($('wallet-q')?.value || '').trim();
  const data = await LotteryClient.lookupWallets({ page: adminWalletPage, q });
  const meta = $('wallet-lookup-meta');
  if (meta) {
    meta.textContent = data.total ? `共 ${data.total} 人` : (q ? '没有匹配用户' : '还没有抽奖次数记录');
  }
  if (!data.total) {
    body.innerHTML = `<tr><td colspan="5">${q ? '没有匹配用户' : '还没有抽奖次数记录'}</td></tr>`;
    renderPager($('wallet-lookup-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  body.replaceChildren(
    ...(data.items || []).map((row) => {
      const tr = document.createElement('tr');
      tr.className = 'is-pick';
      tr.dataset.userId = String(row.user_id || row.userId || '');
      tr.innerHTML = `<td class="lz-ad-id">${row.user_id || row.userId}</td><td>${escapeHtml(row.username || '')}</td><td>${row.tickets ?? 0}</td><td>${row.total_draws ?? row.totalDraws ?? 0}</td><td>${formatMoney(row.total_won_quota ?? row.totalWonQuota)}</td>`;
      tr.addEventListener('click', () => fillGrantFromWallet(row));
      return tr;
    }),
  );
  renderPager($('wallet-lookup-pager'), adminPager(data.total, data.page || 1), (next) => {
    adminWalletPage = next;
    renderWalletLookup();
  });
}

function filteredAdminDraws() {
  const q = ($('admin-user-q')?.value || '').trim();
  const filter = $('admin-draw-filter')?.value || 'all';
  const prizeId = $('admin-prize-filter')?.value || '';
  let rows = loadState().adminDraws || [];
  if (q) {
    rows = rows.filter((row) => String(row.username || '').includes(q) || String(row.userId || '') === q);
  }
  if (filter === 'win') rows = rows.filter((row) => row.win);
  if (filter === 'miss') rows = rows.filter((row) => !row.win);
  if (prizeId) rows = rows.filter((row) => row.prizeId === prizeId);
  return rows.filter((row) => inDateRange(row.at, 'admin-draw-from', 'admin-draw-to'));
}

async function renderAdminDraws() {
  const body = document.querySelector('#admin-draw-table tbody');
  if (!body) return;
  updateDrawFocus();
  const paintDraw = (row) => {
    const tr = document.createElement('tr');
    const quota = row.extraTicket ? '+1 次' : row.quota ? formatMoney(row.quota) : '—';
    tr.innerHTML = `<td>${dayClock(row.at)}</td><td>${userWho(row.userId, row.username)}</td><td class="${row.win ? 'lz-ad-win' : 'lz-ad-miss'}">${escapeHtml(row.label || '')}</td><td>${quota}</td><td>${codeCopyButton(row.redemptionKey)}</td>`;
    return tr;
  };
  if (LotteryClient.mode === 'api') {
    const data = await LotteryClient.listAdminDraws({
      page: adminDrawPage,
      q: ($('admin-user-q')?.value || '').trim(),
      filter: $('admin-draw-filter')?.value || 'all',
      prize: $('admin-prize-filter')?.value || '',
      from: $('admin-draw-from')?.value || '',
      to: $('admin-draw-to')?.value || '',
    });
    const meta = $('admin-draw-meta');
    if (meta) meta.textContent = data.total ? `筛选结果 ${data.total} 条` : '';
    if (!data.total) {
      body.innerHTML = '<tr><td colspan="5">没有匹配记录，点左侧用户可筛选</td></tr>';
      renderPager($('admin-draw-pager'), { total: 0, pages: 1, current: 1 }, () => {});
      return;
    }
    body.replaceChildren(...(data.items || []).map(paintDraw));
    renderPager($('admin-draw-pager'), adminPager(data.total, data.page || 1), (next) => {
      adminDrawPage = next;
      renderAdminDraws();
    });
    return;
  }
  const rows = filteredAdminDraws();
  const meta = $('admin-draw-meta');
  if (meta) meta.textContent = rows.length ? `筛选结果 ${rows.length} 条` : '';
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5">没有匹配记录，点左侧用户可筛选</td></tr>';
    renderPager($('admin-draw-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  const page = pageSlice(rows, adminDrawPage, ADMIN_PAGE_SIZE);
  adminDrawPage = page.current;
  body.replaceChildren(...page.items.map(paintDraw));
  renderPager($('admin-draw-pager'), page, (next) => {
    adminDrawPage = next;
    renderAdminDraws();
  });
}

async function renderAdminTickets() {
  const body = document.querySelector('#admin-ticket-table tbody');
  if (!body) return;
  const q = ($('admin-ticket-q')?.value || '').trim();
  const filter = $('admin-ticket-filter')?.value || 'all';
  const from = $('admin-ticket-from')?.value || '';
  const to = $('admin-ticket-to')?.value || '';
  let rows = [];
  let pageInfo = { total: 0, pages: 1, current: 1 };
  if (LotteryClient.mode === 'api') {
    const data = await LotteryClient.listAdminTickets({
      page: adminTicketPage,
      q,
      filter,
      from,
      to,
    });
    rows = data.items || [];
    pageInfo = adminPager(data.total, data.page || 1);
    adminTicketPage = pageInfo.current;
  } else {
    rows = (loadState().ticketLog || []).map((row) => ({
      ...row,
      username: YOU,
      topup: row.reason === 'payment_grant'
        ? { tradeNo: row.refId, money: 0, paymentMethod: '', status: '', kind: 'simulated' }
        : null,
    }));
    if (q) {
      rows = rows.filter((row) => String(row.username).includes(q) || String(row.refId || '').includes(q));
    }
    if (filter !== 'all') rows = rows.filter((row) => row.reason === filter);
    rows = rows.filter((row) => inDateRange(row.at, 'admin-ticket-from', 'admin-ticket-to'));
    pageInfo = pageSlice(rows, adminTicketPage, ADMIN_PAGE_SIZE);
    adminTicketPage = pageInfo.current;
    rows = pageInfo.items;
  }
  const meta = $('admin-ticket-meta');
  if (meta) meta.textContent = pageInfo.total ? `筛选结果 ${pageInfo.total} 条` : '';
  if (!pageInfo.total && !rows.length) {
    body.innerHTML = '<tr><td colspan="6">暂无次数流水</td></tr>';
    renderPager($('admin-ticket-pager'), { total: 0, pages: 1, current: 1 }, () => {});
    return;
  }
  body.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      const delta = row.delta > 0 ? `+${row.delta}` : String(row.delta);
      const deltaClass = row.delta > 0 ? 'lz-ad-win' : 'lz-ad-miss';
      tr.innerHTML = `<td>${dayClock(row.at)}</td><td>${escapeHtml(row.username || `#${row.userId || ''}`)}</td><td>${reasonLabel(row.reason)}</td><td class="${deltaClass}">${delta}</td><td>${row.balanceAfter ?? '—'}</td><td>${renderTopupCell(row)}</td>`;
      return tr;
    }),
  );
  renderPager($('admin-ticket-pager'), pageInfo, (next) => {
    adminTicketPage = next;
    renderAdminTickets();
  });
}

function syncEnabledControls(onFlag) {
  const value = onFlag ? '1' : '0';
  ['cfg-enabled', 'cfg-enabled-overview'].forEach((id) => {
    const el = $(id);
    if (el) el.value = value;
  });
  const label = $('cfg-enabled-label');
  if (label) label.textContent = onFlag ? '开启中' : '已关闭';
  document.querySelector('.lz-ad-activity')?.classList.toggle('is-off', !onFlag);
  document.querySelector('.lz-ad-hero-row')?.classList.toggle('is-off', !onFlag);
}

async function persistLotteryEnabled(onFlag) {
  const live = LotteryClient.mode === 'api' ? apiState : loadState();
  const prev = live?.lotteryEnabled !== false;
  if (onFlag === prev) {
    syncEnabledControls(onFlag);
    return;
  }
  if (!onFlag) {
    const ok = await askConfirm({
      title: '关闭抽奖',
      text: '关闭后用户暂时不能抽奖。充值仍会送次数，已有次数和已发出的兑换码不受影响。确定关闭？',
      ok: '关闭',
    });
    if (!ok) {
      syncEnabledControls(true);
      return;
    }
  }
  syncEnabledControls(onFlag);
  const msg = $('cfg-enabled-msg');
  try {
    if (LotteryClient.mode === 'api') {
      await LotteryClient.saveConfig(onFlag, Number($('cfg-tickets-per')?.value) || 1);
    } else {
      const next = loadState();
      next.lotteryEnabled = onFlag;
      saveState(next);
    }
    if (msg) msg.textContent = onFlag ? '抽奖已开启。' : '抽奖已关闭。充值仍会送次数。';
  } catch (err) {
    syncEnabledControls(prev);
    if (msg) msg.textContent = err.message || '保存失败';
  }
}

async function bootAdmin() {
  await LotteryClient.connect();
  if (LotteryClient.mode === 'api') {
    const state = apiState || (await LotteryClient.getState());
    if (!state?.isAdmin) {
      const main = document.querySelector('.lz-ad-main');
      if (main) {
        main.innerHTML = `<header class="lz-ad-hero"><h1>需要管理员登录</h1><p>抽奖管理仅管理员可见。请用管理员账号登录抽奖页后，点右上角「抽奖管理」进入。</p></header>`;
      }
      return;
    }
    try {
      await LotteryClient.loadAdmin();
    } catch (err) {
      const main = document.querySelector('.lz-ad-main');
      if (main) {
        main.innerHTML = `<header class="lz-ad-hero"><h1>需要管理员登录</h1><p>${escapeHtml(err.message)}</p><p>请用管理员账号登录抽奖页后，点右上角「抽奖管理」进入。</p></header>`;
      }
      return;
    }
  }
  const refreshUsers = () => {
    renderAdminUsers();
    renderAdminDraws();
  };
  renderAdminDashboard();
  renderAdminPrizes();
  const state = LotteryClient.mode === 'api' ? apiState : loadState();
  const per = $('cfg-tickets-per');
  syncEnabledControls(state.lotteryEnabled !== false);
  if (per) per.value = String(state.ticketsPerPayment || 1);
  fillPrizeOptions('admin-prize-filter');
  refreshUsers();

  document.querySelectorAll('.lz-ad-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      showAdminView(btn.dataset.view);
      if (btn.dataset.view === 'overview') renderAdminDashboard();
      if (btn.dataset.view === 'users') {
        showUserTab(adminUserTab);
        refreshUsers();
      }
      if (btn.dataset.view === 'codes') renderAdminCodes();
      if (btn.dataset.view === 'tickets') renderAdminTickets();
      if (btn.dataset.view === 'rules') renderWalletLookup();
    });
  });
  document.querySelectorAll('#dash-period-tabs [data-dash-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashPeriod = btn.dataset.dashPeriod === 'week' || btn.dataset.dashPeriod === 'all'
        ? btn.dataset.dashPeriod
        : 'today';
      dashDrawPage = 1;
      document.querySelectorAll('#dash-period-tabs [data-dash-period]').forEach((el) => {
        el.classList.toggle('is-on', el === btn);
      });
      renderAdminDashboard();
    });
  });
  on('dash-open-draws', 'click', () => {
    showAdminView('users');
    showUserTab('draws');
    refreshUsers();
  });
  on('add-prize', 'click', async () => {
    if (LotteryClient.mode === 'api') {
      await LotteryClient.savePrize({
        id: `p${Date.now()}`,
        label: '$1.00',
        short: '1.00',
        hint: '额度',
        weight: 10,
        quota: 1,
        extraTicket: false,
        enabled: true,
      });
      await LotteryClient.loadAdmin();
      renderAdminPrizes();
      fillPrizeOptions('admin-prize-filter');
      return;
    }
    const next = loadState();
    const tone = WINWHEEL_PALETTE[next.prizeCatalog.length % WINWHEEL_PALETTE.length];
    next.prizeCatalog.push({
      id: `p${Date.now()}`,
      label: '$1.00',
      short: '1.00',
      hint: '额度',
      weight: 10,
      quota: 1,
      extraTicket: false,
      enabled: true,
      fill: tone.fill,
      ink: tone.ink,
      tier: 'common',
    });
    saveState(next);
    renderAdminPrizes();
    fillPrizeOptions('admin-prize-filter');
  });
  on('reset-catalog', 'click', () => {
    if (LotteryClient.mode === 'api') return;
    const next = loadState();
    next.prizeCatalog = defaultCatalog();
    saveState(next);
    renderAdminPrizes();
    fillPrizeOptions('admin-prize-filter');
  });
  $('admin-prize-table')?.addEventListener('input', (event) => {
    const index = Number(event.target.dataset.i);
    const field = event.target.dataset.f;
    if (Number.isNaN(index) || !field || event.target.type === 'checkbox' || field === 'kind') return;
    patchAdminPrize(index, field, event.target.value, false);
  });
  $('admin-prize-table')?.addEventListener('change', (event) => {
    const index = Number(event.target.dataset.i);
    const field = event.target.dataset.f;
    if (Number.isNaN(index) || !field) return;
    if (event.target.type === 'checkbox') patchAdminPrize(index, field, event.target.checked, true);
    else if (field === 'kind') patchAdminPrize(index, field, event.target.value, true);
    else if (field === 'weight') renderAdminPrizes();
  });
  $('admin-prize-table')?.addEventListener('click', async (event) => {
    const codesBtn = event.target.closest('[data-codes]');
    if (codesBtn) {
      const prize = adminCatalog()[Number(codesBtn.dataset.codes)];
      openCodesView(prize?.dbId);
      return;
    }
    const btn = event.target.closest('[data-remove]');
    if (!btn) return;
    const index = Number(btn.dataset.remove);
    const prize = adminCatalog()[index];
    const unused = Number(prize?.stock) || 0;
    const extra = unused > 0 ? `还有 ${unused} 个未使用兑换码，删除奖项后仍可在「兑换码」页管理。` : '删除后转盘不再抽出该扇区。';
    const ok = await askConfirm({
      title: '删除奖项',
      text: `确定删除奖项「${prize?.label || ''}」？${extra}`,
    });
    if (!ok) return;
    if (LotteryClient.mode === 'api') {
      if (prize?.dbId) await LotteryClient.deletePrize(prize.dbId);
      await LotteryClient.loadAdmin();
      renderAdminPrizes();
      fillPrizeOptions('admin-prize-filter');
      return;
    }
    const next = loadState();
    if (next.prizeCatalog.length <= 1) return;
    next.prizeCatalog.splice(index, 1);
    saveState(next);
    renderAdminPrizes();
  });
  on('cfg-enabled', 'change', (event) => persistLotteryEnabled(event.target.value !== '0'));
  on('cfg-enabled-overview', 'change', (event) => persistLotteryEnabled(event.target.value !== '0'));
  on('cfg-tickets-per', 'input', async (event) => {
    const perPay = Math.max(1, Math.min(10, Number(event.target.value) || 1));
    const onFlag = ($('cfg-enabled-overview')?.value || $('cfg-enabled')?.value || '1') !== '0';
    if (LotteryClient.mode === 'api') {
      await LotteryClient.saveConfig(onFlag, perPay);
      return;
    }
    const next = loadState();
    next.ticketsPerPayment = perPay;
    saveState(next);
  });
  on('mock-pay', 'click', async () => {
    const res = await LotteryClient.grantFromPayment();
    const msg = $('mock-pay-msg');
    if (msg) msg.textContent = LotteryClient.mode === 'api'
      ? `已按支付入账补发，剩余 ${res.tickets} 次（不改余额）`
      : `已入账 ${res.refId}，当前次数 ${res.tickets}`;
    renderAdminTickets();
  });
  on('wallet-q-btn', 'click', () => {
    adminWalletPage = 1;
    renderWalletLookup();
  });
  on('wallet-q', 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    adminWalletPage = 1;
    renderWalletLookup();
  });
  on('grant-tickets-btn', 'click', async () => {
    const userId = Math.max(0, Number($('grant-user-id')?.value) || 0);
    const n = Math.max(1, Math.min(100, Number($('grant-tickets')?.value) || 1));
    const msg = $('grant-tickets-msg');
    if (userId < 1) {
      if (msg) msg.textContent = '请填写用户 ID';
      return;
    }
    const ok = await askConfirm({
      title: '确认补发',
      text: `给用户 ID ${userId} 补发 ${n} 次抽奖次数？只加次数，不改账户额度。`,
      ok: '补发',
    });
    if (!ok) return;
    try {
      const res = await LotteryClient.grantTickets(userId, n);
      const who = res.username ? `${userId} / ${res.username}` : String(userId);
      if (msg) msg.textContent = `已给用户 ${who} 补发 ${n} 次，当前剩余 ${res.tickets} 次。`;
      renderAdminTickets();
      renderWalletLookup();
    } catch (err) {
      if (msg) msg.textContent = err.message || '补发失败';
    }
  });
  const searchSummary = () => {
    adminUserPage = 1;
    renderAdminUsers();
  };
  document.querySelectorAll('[data-user-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showUserTab(btn.dataset.userTab));
  });
  on('admin-summary-q-btn', 'click', searchSummary);
  on('admin-summary-q', 'input', debounce(searchSummary));
  on('admin-summary-q', 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    searchSummary();
  });
  const resetDrawPage = () => {
    adminDrawPage = 1;
    updateDrawFocus();
    renderAdminDraws();
  };
  on('admin-user-q', 'input', debounce(resetDrawPage));
  on('admin-user-q', 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    resetDrawPage();
  });
  on('admin-draw-filter', 'change', resetDrawPage);
  on('admin-prize-filter', 'change', resetDrawPage);
  on('admin-draw-from', 'change', resetDrawPage);
  on('admin-draw-to', 'change', resetDrawPage);
  on('admin-draw-clear-user', 'click', clearSelectedDrawUser);
  on('admin-draw-reset', 'click', () => {
    adminSelectedUserId = '';
    resetFields(['admin-user-q', 'admin-draw-filter', 'admin-prize-filter', 'admin-draw-from', 'admin-draw-to']);
    document.querySelectorAll('#admin-user-table tbody tr').forEach((tr) => tr.classList.remove('is-on'));
    resetDrawPage();
  });
  $('admin-draw-table')?.addEventListener('click', onCopyClick);
  const resetTicketPage = () => {
    adminTicketPage = 1;
    renderAdminTickets();
  };
  on('admin-ticket-q', 'input', resetTicketPage);
  on('admin-ticket-filter', 'change', resetTicketPage);
  on('admin-ticket-from', 'change', resetTicketPage);
  on('admin-ticket-to', 'change', resetTicketPage);
  on('admin-ticket-reset', 'click', () => {
    resetFields(['admin-ticket-q', 'admin-ticket-filter', 'admin-ticket-from', 'admin-ticket-to']);
    resetTicketPage();
  });
  fillQuotaPrizeOptions('code-prize');
  fillQuotaPrizeOptions('code-filter-prize', { allLabel: '全部额度奖' });
  const resetCodePage = () => {
    adminCodePage = 1;
    renderAdminCodes();
  };
  on('code-filter-prize', 'change', () => {
    const prizeId = $('code-filter-prize')?.value || '';
    if (prizeId && $('code-prize')) $('code-prize').value = prizeId;
    resetCodePage();
  });
  on('code-filter-status', 'change', resetCodePage);
  on('code-filter-q', 'input', debounce(resetCodePage));
  on('code-filter-q', 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    resetCodePage();
  });
  on('code-keys', 'input', updateCodeKeysCount);
  on('code-file', 'change', async (event) => {
    await loadCodeFiles(event.target.files);
    event.target.value = '';
  });
  on('code-import-all', 'click', importPendingCodeFiles);
  const importCard = $('code-import-card');
  if (importCard) {
    importCard.addEventListener('dragover', (event) => {
      event.preventDefault();
      importCard.classList.add('is-drop');
    });
    importCard.addEventListener('dragleave', () => importCard.classList.remove('is-drop'));
    importCard.addEventListener('drop', async (event) => {
      event.preventDefault();
      importCard.classList.remove('is-drop');
      await loadCodeFiles(event.dataTransfer?.files);
    });
  }
  on('code-filter-reset', 'click', () => {
    if ($('code-filter-prize')) $('code-filter-prize').value = '';
    if ($('code-filter-status')) $('code-filter-status').value = 'all';
    if ($('code-filter-q')) $('code-filter-q').value = '';
    resetCodePage();
  });
  $('admin-code-table')?.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest('[data-copy]');
    if (copyBtn) {
      onCopyClick(event);
      return;
    }
    const delBtn = event.target.closest('[data-code-del]');
    if (!delBtn) return;
    const ok = await askConfirm({
      title: '删除兑换码',
      text: '确定删除这个未使用的兑换码？删除后不可恢复。',
    });
    if (!ok) return;
    try {
      await LotteryClient.deleteCode(Number(delBtn.dataset.codeDel));
      await LotteryClient.loadAdmin();
      renderAdminPrizes();
      renderAdminCodes();
    } catch (err) {
      const msg = $('code-msg');
      if (msg) {
        msg.hidden = false;
        msg.textContent = err.message || '删除失败';
      }
    }
  });
  on('code-submit', 'click', async () => {
    const msg = $('code-msg');
    const showMsg = (text) => {
      if (!msg) return;
      msg.hidden = false;
      msg.textContent = text;
    };
    const prizeId = Number($('code-prize')?.value);
    const keys = parseCardKeys($('code-keys')?.value || '');
    if (!prizeId) {
      showMsg('请先选择额度奖');
      return;
    }
    if (!keys.length) {
      showMsg('请粘贴要入库的兑换码');
      return;
    }
    if (LotteryClient.mode !== 'api') {
      showMsg('需要管理员登录后才能入库');
      return;
    }
    const submit = $('code-submit');
    if (submit) submit.disabled = true;
    try {
      const res = await LotteryClient.generateStock(prizeId, keys);
      await LotteryClient.loadAdmin();
      renderAdminPrizes();
      if ($('code-keys')) $('code-keys').value = '';
      showMsg(`已入库 ${res.count || keys.length} 个，当前未使用 ${res.stock ?? 0} 个。`);
      adminCodePage = 1;
      if ($('code-filter-prize')) $('code-filter-prize').value = String(prizeId);
      renderAdminCodes();
    } catch (err) {
      showMsg(err.message || '入库失败');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}



function lotteryUsesLight() {
  return document.body.classList.contains('lz-w-app') || document.body.classList.contains('lz-admin');
}

function syncTheme() {
  try {
    if (lotteryUsesLight()) {
      document.documentElement.classList.remove('dark');
      document.body.removeAttribute('theme-mode');
      return;
    }
    const mode = localStorage.getItem('theme-mode') || 'auto';
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = mode === 'dark' || (mode !== 'light' && systemDark);
    document.documentElement.classList.toggle('dark', dark);
    if (dark) document.body.setAttribute('theme-mode', 'dark');
    else document.body.removeAttribute('theme-mode');
  } catch {
    /* ignore */
  }
}

async function boot() {
  applyEmbedChrome();
  syncTheme();
  applySiteBrand();
  refreshSiteBrand();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
  if (PAGE === 'wheel') return bootWheel();
  if (PAGE === 'admin') return bootAdmin();
  if (PAGE === 'settings') return bootAdmin();
  if (PAGE === 'history') return bootHistory();
  if (PAGE === 'host') return bootHost();
  return bootJoin();
}

boot();
