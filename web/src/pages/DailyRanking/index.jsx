import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Button, DatePicker, Select, Space, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { IconCalendar, IconRefresh } from '@douyinfe/semi-icons';
import { VChart } from '@visactor/react-vchart';
import { useTranslation } from 'react-i18next';
import { API, convertUSDToCurrency } from '../../helpers';
import { DATE_RANGE_PRESETS } from '../../constants/console.constants';
import { PAYMENT_METHOD_MAP } from '../../constants/payment.constants';
import CostCard from './CostCard';
import { listOpsCosts } from './costApi';
import './ops.css';

const { Text } = Typography;

const QUICK_RANGES = [
  { key: 'today', label: '今日', text: '今天' },
  { key: 'week', label: '本周', text: '本周' },
  { key: 'month', label: '当月', text: '本月' },
];

const quickRangeDates = (text) => {
  const preset = DATE_RANGE_PRESETS.find((item) => item.text === text);
  return [preset.start(), preset.end()];
};

const SORT_OPTIONS = [
  { value: 'quota', label: '按金额' },
  { value: 'tokens', label: '按Token' },
  { value: 'requests', label: '按请求数' },
];

const MEDAL = ['🥇', '🥈', '🥉'];
const CHART_OPTION = { fallbacks: true };
const OPTIONAL_REQ = { skipErrorHandler: true };
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_PREFIX = 'ops-console:v6:';
const CHANNEL_COLORS = ['#286aff', '#0cb58a', '#ff9648', '#9166ee', '#12bde6'];

const memCache = new Map();
const inflight = new Map();

const cacheGet = (key) => {
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL) return mem.data;
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.at > CACHE_TTL) return null;
    memCache.set(key, parsed);
    return parsed.data;
  } catch {
    return null;
  }
};

const cacheSet = (key, data) => {
  const rec = { at: Date.now(), data };
  memCache.set(key, rec);
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(rec));
  } catch {
    /* ignore */
  }
};

const cachedGet = async (url, bypass = false) => {
  if (!bypass) {
    const hit = cacheGet(url);
    if (hit != null) return { data: hit };
    if (inflight.has(url)) return inflight.get(url);
  }
  const req = API.get(url, OPTIONAL_REQ)
    .then((res) => {
      if (res?.data) cacheSet(url, res.data);
      return res;
    })
    .catch(() => null)
    .finally(() => inflight.delete(url));
  inflight.set(url, req);
  return req;
};

const quotaToUsd = (quota) => {
  const per = parseFloat(localStorage.getItem('quota_per_unit') || '500000');
  return Number(quota || 0) / (per || 500000);
};

const renderMoney = (quota, digits = 2) =>
  convertUSDToCurrency(quotaToUsd(quota), digits);

const formatMoney = (amount, digits = 2) =>
  convertUSDToCurrency(Number(amount || 0), digits);

const formatTokens = (tokens) => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens || 0);
};

const SEMI_AVATAR = [
  'amber',
  'blue',
  'cyan',
  'green',
  'indigo',
  'lime',
  'orange',
  'pink',
  'purple',
  'red',
  'teal',
  'violet',
];

const stringToColor = (str) => {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SEMI_AVATAR[Math.abs(hash) % SEMI_AVATAR.length];
};

const shanghaiYmd = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: pick('year'), m: pick('month'), d: pick('day') };
};

const shanghaiDayFromTs = (ts) => {
  const { y, m, d } = shanghaiYmd(new Date(Number(ts || 0) * 1000));
  return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const formatDotDate = (ts) => {
  const { y, m, d } = shanghaiYmd(new Date(Number(ts || 0) * 1000));
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
};

const formatClock = (ts) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(Number(ts || 0) * 1000));

const shanghaiDayStartTs = (value) => {
  const { y, m, d } = shanghaiYmd(new Date(value));
  return Math.floor(
    new Date(
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+08:00`,
    ).getTime() / 1000,
  );
};

const defaultDateRange = () => [
  DATE_RANGE_PRESETS[0].start(),
  DATE_RANGE_PRESETS[0].end(),
];

const boundsFromDates = (range) => {
  const from = range?.[0] || defaultDateRange()[0];
  const to = range?.[1] || defaultDateRange()[1];
  let start = shanghaiDayStartTs(from);
  let end = shanghaiDayStartTs(to) + 86399;
  if (start > end) {
    const nextStart = shanghaiDayStartTs(to);
    end = start + 86399;
    start = nextStart;
  }
  return { start, end };
};

const sameDay = (a, b) => {
  const left = shanghaiYmd(new Date(a));
  const right = shanghaiYmd(new Date(b));
  return left.y === right.y && left.m === right.m && left.d === right.d;
};

const pad2 = (n) => String(n).padStart(2, '0');

const shanghaiMonthBounds = (monthOffset = 0) => {
  const { y, m } = shanghaiYmd(new Date());
  const index = y * 12 + (m - 1) + monthOffset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const start = shanghaiDayStartTs(
    new Date(`${year}-${pad2(month)}-01T12:00:00+08:00`),
  );
  const nextIndex = index + 1;
  const nextYear = Math.floor(nextIndex / 12);
  const nextMonth = (nextIndex % 12) + 1;
  const nextStart = shanghaiDayStartTs(
    new Date(`${nextYear}-${pad2(nextMonth)}-01T12:00:00+08:00`),
  );
  return { start, end: nextStart - 1 };
};

const formatRangeTrigger = (range) => {
  const from = shanghaiYmd(new Date(range?.[0] || Date.now()));
  const to = shanghaiYmd(new Date(range?.[1] || Date.now()));
  const left = `${from.y}.${pad2(from.m)}.${pad2(from.d)}`;
  const right =
    from.y === to.y
      ? `${pad2(to.m)}.${pad2(to.d)}`
      : `${to.y}.${pad2(to.m)}.${pad2(to.d)}`;
  return `${left} – ${right}`;
};

const datePresetLabel = (range) => {
  if (!range?.[0] || !range?.[1]) return '自定义';
  const hit = DATE_RANGE_PRESETS.find(
    (preset) =>
      sameDay(range[0], preset.start()) && sameDay(range[1], preset.end()),
  );
  return hit?.text || '自定义';
};

const previousBoundsFromRange = (range) => {
  const preset = datePresetLabel(range);
  const { start, end } = boundsFromDates(range);
  if (preset === '今天') {
    return { start: start - 86400, end: start - 1, text: '较昨日' };
  }
  if (preset === '本周') {
    return {
      start: start - 7 * 86400,
      end: end - 7 * 86400,
      text: '较上周',
    };
  }
  if (preset === '本月') {
    const { y, m } = shanghaiYmd(new Date(start * 1000));
    let py = y;
    let pm = m - 1;
    if (pm < 1) {
      pm = 12;
      py -= 1;
    }
    const prevStart = shanghaiDayStartTs(
      new Date(`${py}-${pad2(pm)}-01T12:00:00+08:00`),
    );
    return { start: prevStart, end: start - 1, text: '较上月' };
  }
  const days = Math.max(1, Math.round((end - start + 1) / 86400));
  return {
    start: start - days * 86400,
    end: start - 1,
    text: '较上期',
  };
};

const uniqueUserCount = (rows) => {
  const set = new Set();
  (rows || []).forEach((item) => {
    if (item.user_id) set.add(`id:${item.user_id}`);
    else if (item.username) set.add(`n:${item.username}`);
  });
  return set.size;
};

const MetricDelta = ({ value, oldValue, label }) => {
  const old = Number(oldValue);
  if (!Number.isFinite(old) || old === 0) {
    return (
      <div className='metric-compare'>
        <span className='delta muted'>—</span>
        <span>{label}</span>
      </div>
    );
  }
  const delta = ((Number(value || 0) - old) / old) * 100;
  return (
    <div className='metric-compare num'>
      <span className={`delta${delta < 0 ? ' down' : ''}`}>
        {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
      </span>
      <span>{label}</span>
    </div>
  );
};

const listDays = (start, end) => {
  const days = [];
  for (let ts = start; ts <= end; ts += 86400) {
    days.push({
      date: shanghaiDayFromTs(ts),
      start: ts,
      end: Math.min(ts + 86399, end),
    });
  }
  return days;
};

const mapLimit = async (items, limit, mapper) => {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(mapper))));
  }
  return out;
};

const isSubscriptionTopup = (record) => {
  const tradeNo = String(record?.trade_no || '').toLowerCase();
  return tradeNo.startsWith('sub');
};

const isPaidTopup = (record) => String(record?.status || '') === 'success';

const paidAt = (record) =>
  Number(record?.complete_time || record?.create_time || 0);

const channelLabel = (method, isSub = false) => {
  const key = String(method || '').trim();
  if (!key) return isSub ? '订阅' : '其他';
  return PAYMENT_METHOD_MAP[key] || PAYMENT_METHOD_MAP[key.toLowerCase()] || key;
};

const loadTopupItems = async (minStart, bypass = false) => {
  const cached = cacheGet('topups:items');
  if (!bypass && cached?.length) {
    const oldest = Math.min(...cached.map(paidAt));
    if (Number.isFinite(oldest) && oldest <= minStart) return cached;
  }
  const items = Array.isArray(cached) ? [...cached] : [];
  const seen = new Set(items.map((item) => item.id || item.trade_no));
  for (let page = 1; page <= 20; page++) {
    const res = await cachedGet(
      `/api/user/topup?p=${page}&page_size=100`,
      bypass,
    );
    if (!res?.data?.success) break;
    const payload = res.data.data || {};
    const batch = payload.items || [];
    if (!batch.length) break;
    batch.forEach((item) => {
      const key = item.id || item.trade_no;
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
      }
    });
    const oldest = Math.min(...batch.map(paidAt));
    if (Number.isFinite(oldest) && oldest < minStart) break;
    if (page * 100 >= Number(payload.total || 0)) break;
  }
  cacheSet('topups:items', items);
  return items;
};

const emptyDaily = (date) => ({
  date,
  topup: 0,
  subscription: 0,
  orders: 0,
});

const buildRevenue = (items, start, end, days) => {
  const byDay = new Map(days.map((day) => [day.date, emptyDaily(day.date)]));
  const payers = new Set();
  const channels = new Map();
  const orders = [];
  let topupAmount = 0;
  let subscriptionAmount = 0;
  let topupCount = 0;
  let subscriptionCount = 0;
  let pending = 0;
  let failed = 0;
  let paid = 0;
  let maxSingle = 0;
  let onlineAttempts = 0;
  let onlinePaid = 0;

  items.forEach((item) => {
    const ts = paidAt(item);
    if (ts < start || ts > end) return;
    const date = shanghaiDayFromTs(ts);
    if (!byDay.has(date)) byDay.set(date, emptyDaily(date));
    const isSub = isSubscriptionTopup(item);
    const money = Number(item.money || 0);
    const status = String(item.status || '');
    const method = String(item.payment_method || '').trim();
    const online = !isSub && method && method !== 'manual' && method !== 'admin';

    orders.push({
      trade_no: item.trade_no,
      type: isSub ? '订阅' : '充值',
      money,
      status,
      create_time: ts,
      username: item.username,
    });

    if (status === 'pending') pending += 1;
    if (status === 'failed' || status === 'expired') failed += 1;
    if (online) {
      onlineAttempts += 1;
      if (status === 'success') onlinePaid += 1;
    }
    if (!isPaidTopup(item)) return;

    paid += 1;
    if (item.user_id) payers.add(item.user_id);
    const bucket = byDay.get(date);
    bucket.orders += 1;
    if (isSub) {
      bucket.subscription += money;
      subscriptionAmount += money;
      subscriptionCount += 1;
    } else {
      bucket.topup += money;
      topupAmount += money;
      topupCount += 1;
      maxSingle = Math.max(maxSingle, money);
    }
    const name = channelLabel(method, isSub);
    const cur = channels.get(name) || { name, value: 0, count: 0 };
    cur.value += money;
    cur.count += 1;
    channels.set(name, cur);
  });

  orders.sort((a, b) => Number(b.create_time || 0) - Number(a.create_time || 0));

  return {
    topup_amount: topupAmount,
    subscription_amount: subscriptionAmount,
    topup_count: topupCount,
    subscription_count: subscriptionCount,
    payer_count: payers.size,
    pending,
    failed,
    paid,
    max_single: maxSingle,
    online_attempts: onlineAttempts,
    online_paid: onlinePaid,
    channels: [...channels.values()]
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({
        ...item,
        color: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
      })),
    orders: orders.slice(0, 8),
    order_total: orders.length,
    daily: days.map((day) => byDay.get(day.date) || emptyDaily(day.date)),
  };
};

const fillRankBilling = async (items, start, end, bypass = false) => {
  const extras = await mapLimit(items || [], 8, async (item) => {
    if (
      item.splitReady &&
      (Number(item.subscription_quota) > 0 ||
        Number(item.wallet_quota) > 0 ||
        Number(item.total_quota) === 0)
    ) {
      return item;
    }
    const name = item.username || item.user_name;
    if (!name) return { ...item, splitReady: false };
    const url = `/api/log/stat?type=2&start_timestamp=${start}&end_timestamp=${end}&username=${encodeURIComponent(name)}`;
    const res = await cachedGet(url, bypass);
    const s = res?.data?.success ? res.data.data : null;
    if (!s) return { ...item, splitReady: false };
    return {
      ...item,
      subscription_quota: Number(s.subscription_quota || 0),
      wallet_quota: Number(s.wallet_quota || 0),
      splitReady: true,
    };
  });
  return extras;
};

const moneyLabel = (value) => {
  const n = Number(value || 0);
  return n ? convertUSDToCurrency(n) : '';
};

const lineSpec = (values) => ({
  type: 'area',
  height: 220,
  autoFit: true,
  padding: { top: 24, right: 12, bottom: 28, left: 44 },
  data: [{ id: 'trend', values }],
  xField: 'date',
  yField: 'amount',
  seriesField: 'type',
  stack: false,
  color: ['#286aff', '#0cb58a'],
  legends: { visible: false },
  point: {
    visible: true,
    style: {
      size: values.length <= 4 ? 7 : 4.5,
      fill: '#fff',
      stroke: (datum) =>
        datum?.type === '到账金额' ? '#0cb58a' : '#286aff',
      lineWidth: 1.6,
    },
  },
  line: { style: { curveType: 'monotone', lineWidth: 2.2 } },
  area: {
    visible: true,
    style: {
      fillOpacity: (datum) => (datum?.type === '到账金额' ? 0.07 : 0.1),
    },
  },
  label: {
    visible: true,
    position: 'top',
    formatMethod: (text, datum) => moneyLabel(datum?.amount ?? text),
    style: { fontSize: 10, fontWeight: 600 },
    overlap: false,
  },
  axes: [
    { orient: 'bottom', type: 'band', trimPadding: true },
    { orient: 'left', type: 'linear', min: 0 },
  ],
});

const barSpec = (values) => ({
  type: 'bar',
  height: 220,
  autoFit: true,
  padding: { top: 24, right: 12, bottom: 28, left: 36 },
  data: [{ id: 'orders', values }],
  xField: 'date',
  yField: 'count',
  seriesField: 'type',
  color: ['#9b79ef'],
  legends: { visible: false },
  bar: { style: { cornerRadius: [3, 3, 0, 0], fill: '#9b79ef' } },
  label: {
    visible: true,
    position: 'top',
    style: { fontSize: 10, fontWeight: 600 },
  },
  axes: [
    { orient: 'bottom', type: 'band' },
    { orient: 'left', type: 'linear', min: 0 },
  ],
});

const fillConsumeDaily = (days, dataItems, periodQuota) => {
  const byDay = new Map(days.map((day) => [day.date, 0]));
  (dataItems || []).forEach((item) => {
    const date = shanghaiDayFromTs(Number(item.created_at || 0));
    if (!byDay.has(date)) return;
    byDay.set(date, byDay.get(date) + Number(item.quota || 0));
  });
  const rows = days.map((day) => ({
    date: day.date,
    quota: byDay.get(day.date) || 0,
  }));
  const sum = rows.reduce((total, item) => total + Number(item.quota || 0), 0);
  if (!sum && Number(periodQuota || 0) > 0 && rows.length) {
    rows[rows.length - 1].quota = Number(periodQuota);
  }
  return rows;
};

const emptyOverview = () => ({
  consume: {
    quota: 0,
    subscription_quota: 0,
    wallet_quota: 0,
    unmarked_quota: 0,
    requests: 0,
    users: 0,
  },
  models: [],
  consume_daily: [],
  revenue: buildRevenue([], 0, 0, []),
});

const normalizeDailyRevenue = (rows = []) =>
  (rows || []).map((item) => ({
    date: item.date,
    topup: Number(item.topup ?? item.topup_amount ?? 0),
    subscription: Number(item.subscription ?? item.subscription_amount ?? 0),
    orders: Number(item.orders ?? item.topup_count ?? 0) + Number(item.subscription_count || 0),
  }));

const percentText = (value, total, digits = 1) => {
  if (!total) return '—';
  const pct = (Number(value || 0) / total) * 100;
  if (pct > 0 && pct < 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(digits)}%`;
};

const orderStatus = (status) => {
  if (status === 'success') return { cls: 'paid', text: '已支付' };
  if (status === 'pending') return { cls: 'pending', text: '待支付' };
  return { cls: 'failed', text: status === 'expired' ? '已过期' : '支付失败' };
};

const Donut = ({ items, total, center, sub }) => {
  const size = 160;
  const r = 61;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const safeTotal = Number(total || 0);
  return (
    <div className='donut'>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden='true'>
        <circle
          cx='80'
          cy='80'
          r={r}
          fill='none'
          stroke='#f0f4fa'
          strokeWidth='17'
        />
        {items.map((item) => {
          const length = safeTotal ? (Number(item.value || 0) / safeTotal) * circ : 0;
          const gap = length > 2 ? 1.5 : 0;
          const dash = Math.max(0, length - gap);
          const node = (
            <circle
              key={item.name}
              cx='80'
              cy='80'
              r={r}
              fill='none'
              stroke={item.color}
              strokeWidth='17'
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return node;
        })}
      </svg>
      <div className='donut-center'>
        <strong className='num'>{center}</strong>
        <span>{sub}</span>
      </div>
    </div>
  );
};

const OpsLoader = ({ label }) =>
  createPortal(
    <div className='ops-loader-portal' role='status' aria-live='polite'>
      <div className='ops-loader-inner'>
        <div className='ops-loader-bars' aria-hidden='true'>
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className='ops-loader-text'>{label}</div>
      </div>
    </div>,
    document.body,
  );

const RatioCard = ({
  title,
  sub,
  pill,
  items,
  total,
  center,
  centerLabel,
  footLeft,
  footRight,
}) => (
  <article className='card ratio-card'>
    <div className='panel-head'>
      <div>
        <h2 className='panel-title'>{title}</h2>
        <p className='panel-sub'>{sub}</p>
      </div>
      <span className='ratio-pill'>{pill}</span>
    </div>
    <div className='ratio-content'>
      {items.some((item) => Number(item.value || 0) > 0) ? (
        <Donut items={items} total={total} center={center} sub={centerLabel} />
      ) : (
        <div className='empty-state'>暂无数据</div>
      )}
      <div className='ratio-legend'>
        {items.map((item) => (
          <div className='ratio-row' key={item.name}>
            <i className='dot' style={{ background: item.color }} />
            <span className='ratio-label'>{item.name}</span>
            <span className='ratio-value num'>{percentText(item.value, total)}</span>
            <span className='ratio-amount num'>
              {item.moneyText || formatMoney(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
    <div className='ratio-footer'>
      <span>{footLeft}</span>
      <strong>{footRight}</strong>
    </div>
  </article>
);

const DailyRanking = () => {
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState(defaultDateRange);
  const [mainTab, setMainTab] = useState('overview');
  const [sort, setSort] = useState('quota');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [myRank, setMyRank] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [overview, setOverview] = useState(null);
  const [costItems, setCostItems] = useState([]);
  const [previous, setPrevious] = useState(null);

  const loadCosts = useCallback(async () => {
    try {
      setCostItems(await listOpsCosts());
    } catch {
      setCostItems([]);
    }
  }, []);

  useEffect(() => {
    loadCosts();
  }, [loadCosts]);

  const persistPage = (page, pageKey) => {
    cacheSet(pageKey, page);
  };

  const applyPage = (page) => {
    setOverview(page.overview);
    setRows(page.rows || []);
    setMyRank(page.myRank || 0);
    setTotalUsers(page.totalUsers || 0);
    setPrevious(page.previous || null);
  };

  const loadData = useCallback(
    async (bypass = false) => {
      const { start, end } = boundsFromDates(dateRange);
      const prevBounds = previousBoundsFromRange(dateRange);
      const days = listDays(start, end);
      const pageKey = `page:${start}-${end}`;

      if (!bypass) {
        const cached = cacheGet(pageKey);
        if (cached?.overview) {
          applyPage(cached);
          setLoading(false);
          if (
            (cached.rows || []).some(
              (item) => !item.splitReady && Number(item.total_quota || 0) > 0,
            )
          ) {
            fillRankBilling(cached.rows, start, end, false).then((filled) => {
              const next = { ...cached, rows: filled };
              applyPage(next);
              persistPage(next, pageKey);
            });
          }
          return;
        }
      }

      setLoading(true);
      try {
        const skipOverview = cacheGet('overview-missing') === true;
        const [
          rankRes,
          overviewRes,
          statRes,
          dataRes,
          topupItems,
          prevStatRes,
          prevDataRes,
        ] = await Promise.all([
          cachedGet(
            `/api/analytics/daily-ranking?sort=quota&limit=50`,
            bypass,
          ),
          skipOverview
            ? Promise.resolve(null)
            : cachedGet(`/api/analytics/station-overview`, bypass),
          cachedGet(
            `/api/log/stat?type=2&start_timestamp=${start}&end_timestamp=${end}`,
            bypass,
          ),
          cachedGet(
            `/api/data/?start_timestamp=${start}&end_timestamp=${end}&default_time=day`,
            bypass,
          ),
          loadTopupItems(Math.min(start, prevBounds.start), bypass),
          cachedGet(
            `/api/log/stat?type=2&start_timestamp=${prevBounds.start}&end_timestamp=${prevBounds.end}`,
            bypass,
          ),
          cachedGet(
            `/api/data/?start_timestamp=${prevBounds.start}&end_timestamp=${prevBounds.end}&default_time=day`,
            bypass,
          ),
        ]);

        if (!skipOverview && overviewRes && !overviewRes?.data?.success) {
          cacheSet('overview-missing', true);
        }

        const next = emptyOverview();
        if (overviewRes?.data?.success && overviewRes.data.data) {
          const src = overviewRes.data.data;
          next.consume = { ...next.consume, ...(src.consume || {}) };
          next.revenue = { ...next.revenue, ...(src.revenue || {}) };
          next.models = src.models || [];
          next.consume_daily = src.consume_daily || [];
        }
        if (statRes?.data?.success && statRes.data.data) {
          const s = statRes.data.data;
          next.consume.quota = Number(s.quota || next.consume.quota || 0);
          next.consume.subscription_quota = Number(
            s.subscription_quota || next.consume.subscription_quota || 0,
          );
          next.consume.wallet_quota = Number(
            s.wallet_quota || next.consume.wallet_quota || 0,
          );
        }

        let rankItems = [];
        let nextMyRank = 0;
        let nextTotalUsers = 0;
        if (rankRes?.data?.success) {
          const payload = rankRes.data.data || {};
          rankItems = (
            Array.isArray(payload) ? payload : payload.items || []
          ).map((item) => ({
            ...item,
            splitReady: Boolean(
              Number(item.subscription_quota || 0) ||
                Number(item.wallet_quota || 0),
            ),
          }));
          nextMyRank = payload.my_rank || 0;
          nextTotalUsers = payload.total_users || 0;
          next.consume.requests =
            Number(next.consume.requests || 0) ||
            rankItems.reduce(
              (sum, item) => sum + Number(item.request_count || 0),
              0,
            );
          if (payload.total_users) next.consume.users = payload.total_users;
        }

        next.consume.unmarked_quota = Math.max(
          0,
          Number(next.consume.quota || 0) -
            Number(next.consume.subscription_quota || 0) -
            Number(next.consume.wallet_quota || 0),
        );

        const dataItems = dataRes?.data?.success ? dataRes.data.data || [] : [];
        if ((!next.models || !next.models.length) && dataItems.length) {
          const grouped = new Map();
          dataItems.forEach((item) => {
            const name = item.model_name || 'unknown';
            const cur = grouped.get(name) || { name, quota: 0, count: 0 };
            cur.quota += Number(item.quota || 0);
            cur.count += Number(item.count || 0);
            grouped.set(name, cur);
          });
          next.models = [...grouped.values()]
            .sort((a, b) => b.quota - a.quota)
            .slice(0, 12);
        }

        const extras = buildRevenue(topupItems, start, end, days);
        const revenueEmpty =
          !(next.revenue.daily || []).length &&
          !Number(next.revenue.topup_amount || 0) &&
          !Number(next.revenue.subscription_amount || 0);
        next.revenue = {
          ...(revenueEmpty ? extras : { ...next.revenue, ...extras }),
          daily: extras.daily,
          topup_amount: revenueEmpty
            ? extras.topup_amount
            : Number(next.revenue.topup_amount || extras.topup_amount || 0),
          subscription_amount: revenueEmpty
            ? extras.subscription_amount
            : Number(
                next.revenue.subscription_amount ||
                  extras.subscription_amount ||
                  0,
              ),
          topup_count: extras.topup_count,
          subscription_count: extras.subscription_count,
        };
        next.revenue.daily = normalizeDailyRevenue(next.revenue.daily);

        const existingDailyQuota = (next.consume_daily || []).some(
          (item) => Number(item.quota || 0) > 0,
        );
        if (!existingDailyQuota) {
          next.consume_daily = fillConsumeDaily(
            days,
            dataItems,
            next.consume.quota,
          );
        }

        const periodUsers = uniqueUserCount(dataItems);
        if (periodUsers) next.consume.users = periodUsers;

        const prevDays = listDays(prevBounds.start, prevBounds.end);
        const prevRevenue = buildRevenue(
          topupItems,
          prevBounds.start,
          prevBounds.end,
          prevDays,
        );
        const prevStat = prevStatRes?.data?.success ? prevStatRes.data.data : null;
        const prevDataItems = prevDataRes?.data?.success
          ? prevDataRes.data.data || []
          : [];
        const previousSummary = {
          consumeQuota: Number(prevStat?.quota || 0),
          income:
            Number(prevRevenue.topup_amount || 0) +
            Number(prevRevenue.subscription_amount || 0),
          paid: Number(prevRevenue.paid || 0),
          users: uniqueUserCount(prevDataItems) || 0,
          text: prevBounds.text,
        };

        const page = {
          overview: next,
          rows: rankItems,
          myRank: nextMyRank,
          totalUsers: nextTotalUsers,
          previous: previousSummary,
        };
        applyPage(page);
        persistPage(page, pageKey);
        setLoading(false);

        const jobs = [];
        if (rankItems.some((item) => !item.splitReady)) {
          jobs.push(
            fillRankBilling(rankItems, start, end, bypass).then((filled) => {
              rankItems = filled;
            }),
          );
        }
        if (jobs.length) {
          await Promise.all(jobs);
          const ready = {
            overview: { ...next },
            rows: rankItems,
            myRank: nextMyRank,
            totalUsers: nextTotalUsers,
            previous: previousSummary,
          };
          applyPage(ready);
          persistPage(ready, pageKey);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [dateRange],
  );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  const consume = overview?.consume || {};
  const revenue = overview?.revenue || {};
  const models = overview?.models || [];
  const users = Number(consume.users || totalUsers || 0);
  const income =
    Number(revenue.topup_amount || 0) + Number(revenue.subscription_amount || 0);
  const paidCount = Number(revenue.paid || 0);
  const { start, end } = boundsFromDates(dateRange);
  const rangeLabel = datePresetLabel(dateRange);
  const thisMonth = shanghaiMonthBounds(0);
  const lastMonth = shanghaiMonthBounds(-1);
  const monthCostTotal = costItems
    .filter((item) => {
      const ts = Number(item.occurred_at || 0);
      return ts >= thisMonth.start && ts <= thisMonth.end;
    })
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const lastMonthCostTotal = costItems
    .filter((item) => {
      const ts = Number(item.occurred_at || 0);
      return ts >= lastMonth.start && ts <= lastMonth.end;
    })
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const prevBounds = previousBoundsFromRange(dateRange);
  const compareLabel = previous?.text || prevBounds.text;
  const consumeUsd = quotaToUsd(consume.quota);
  const burnRatio = income > 0 ? consumeUsd / income : null;
  const prevConsumeUsd = quotaToUsd(previous?.consumeQuota);
  const prevIncome = Number(previous?.income || 0);
  const prevBurnRatio = prevIncome > 0 ? prevConsumeUsd / prevIncome : null;

  const topModels = models.slice(0, 5);
  const modelTotalQuota = useMemo(
    () => models.reduce((sum, item) => sum + Number(item.quota || 0), 0),
    [models],
  );

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === 'tokens') {
        return Number(b.total_tokens || 0) - Number(a.total_tokens || 0);
      }
      if (sort === 'requests') {
        return Number(b.request_count || 0) - Number(a.request_count || 0);
      }
      const aQuota =
        Number(a.subscription_quota || 0) + Number(a.wallet_quota || 0) ||
        Number(a.total_quota || 0);
      const bQuota =
        Number(b.subscription_quota || 0) + Number(b.wallet_quota || 0) ||
        Number(b.total_quota || 0);
      return bQuota - aQuota;
    });
    return copy.map((item, index) => ({ ...item, rank: index + 1 }));
  }, [rows, sort]);

  const trendDays = useMemo(() => listDays(start, end), [start, end]);

  const consumeLine = useMemo(() => {
    const consumeMap = new Map(
      (overview?.consume_daily || []).map((item) => [
        item.date,
        Number(item.quota || 0),
      ]),
    );
    const cashMap = new Map(
      (revenue.daily || []).map((item) => [
        item.date,
        Number(item.topup || 0) + Number(item.subscription || 0),
      ]),
    );
    if (
      ![...consumeMap.values()].some((value) => value > 0) &&
      Number(consume.quota || 0) > 0 &&
      trendDays.length
    ) {
      consumeMap.set(trendDays[trendDays.length - 1].date, Number(consume.quota));
    }
    const values = [];
    trendDays.forEach((day) => {
      values.push({
        date: day.date,
        type: '消耗金额',
        amount: quotaToUsd(consumeMap.get(day.date) || 0),
      });
      values.push({
        date: day.date,
        type: '到账金额',
        amount: cashMap.get(day.date) || 0,
      });
    });
    return lineSpec(values);
  }, [overview, revenue.daily, consume.quota, trendDays]);

  const orderBars = useMemo(
    () =>
      barSpec(
        (revenue.daily || []).map((item) => ({
          date: item.date,
          type: '付费订单',
          count: Number(item.orders || 0),
        })),
      ),
    [revenue.daily],
  );

  const incomeItems = [
    { name: '余额充值', value: Number(revenue.topup_amount || 0), color: '#286aff' },
    {
      name: '订阅购买',
      value: Number(revenue.subscription_amount || 0),
      color: '#12bde6',
    },
  ];
  const usageItems = [
    {
      name: '订阅消耗',
      value: quotaToUsd(consume.subscription_quota),
      color: '#286aff',
      moneyText: renderMoney(consume.subscription_quota),
    },
    {
      name: '余额消耗',
      value: quotaToUsd(consume.wallet_quota),
      color: '#12bde6',
      moneyText: renderMoney(consume.wallet_quota),
    },
    {
      name: '未标记消耗',
      value: quotaToUsd(consume.unmarked_quota),
      color: '#bcc8db',
      moneyText: renderMoney(consume.unmarked_quota),
    },
  ];

  const hasConsumeTrend =
    Number(consume.quota || 0) > 0 ||
    income > 0 ||
    (overview?.consume_daily || []).some((item) => Number(item.quota || 0) > 0) ||
    (revenue.daily || []).some(
      (item) => Number(item.topup || 0) + Number(item.subscription || 0) > 0,
    );
  const hasOrders = (revenue.daily || []).some((item) => Number(item.orders || 0) > 0);
  const avgTopup = Number(revenue.topup_count || 0)
    ? Number(revenue.topup_amount || 0) / Number(revenue.topup_count || 0)
    : 0;
  const successRate = Number(revenue.online_attempts || 0)
    ? `${((Number(revenue.online_paid || 0) / Number(revenue.online_attempts || 0)) * 100).toFixed(1)}%`
    : '—';

  const columns = [
    {
      title: '#',
      dataIndex: 'rank',
      width: 56,
      render: (rank) =>
        rank <= 3 ? (
          <span style={{ fontSize: 20 }}>{MEDAL[rank - 1]}</span>
        ) : (
          <Text type='tertiary'>{rank}</Text>
        ),
    },
    {
      title: t('用户'),
      dataIndex: 'username',
      width: 150,
      render: (text, record) => (
        <Space>
          <Avatar size='extra-small' color={stringToColor(text)}>
            {(text || '?')[0].toUpperCase()}
          </Avatar>
          <Text strong={record.is_self}>
            {text}
            {record.is_self && (
              <Tag color='light-blue' size='small' style={{ marginLeft: 6 }}>
                我
              </Tag>
            )}
          </Text>
        </Space>
      ),
    },
    {
      title: t('请求数'),
      dataIndex: 'request_count',
      width: 80,
      render: (val) => Number(val || 0).toLocaleString(),
    },
    {
      title: 'Token',
      dataIndex: 'total_tokens',
      width: 84,
      render: (val) => formatTokens(val),
    },
    {
      title: t('消耗金额'),
      dataIndex: 'total_quota',
      width: 280,
      render: (val, record) => {
        const sub = Number(record.subscription_quota || 0);
        const wallet = Number(record.wallet_quota || 0);
        const total = sub + wallet || Number(val || 0);
        return (
          <span>
            <span style={{ fontWeight: 700 }}>{renderMoney(total)}</span>
            <span style={{ marginLeft: 6, fontSize: 12 }}>
              {record.splitReady ? (
                <>
                  (
                  <span style={{ color: '#7C3AED', fontWeight: 650 }}>
                    {t('订')} {renderMoney(sub)}
                  </span>
                  <span style={{ opacity: 0.45 }}> / </span>
                  <span style={{ color: '#0F9D8A', fontWeight: 650 }}>
                    {t('余')} {renderMoney(wallet)}
                  </span>
                  )
                </>
              ) : (
                <span style={{ color: 'var(--semi-color-text-2)' }}>
                  ({t('订')} -- / {t('余')} --)
                </span>
              )}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <div className='ops-console mt-[60px] px-4 pb-8'>
      <div className='page-header'>
        <div>
          <div className='page-title'>
            <h1>{t('运营总览')}</h1>
          </div>
          <p className='subtitle'>
            {t('消费、到账与用户增长，一眼掌握经营表现。')}
          </p>
        </div>
        <div className='date-tools'>
          <div className='segments'>
            {[
              { key: 'overview', label: t('数据概览') },
              { key: 'ranking', label: t('用量排行') },
            ].map((item) => (
              <button
                key={item.key}
                className={mainTab === item.key ? 'active' : ''}
                onClick={() => setMainTab(item.key)}
                type='button'
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className='range-tabs'>
            {QUICK_RANGES.map((item) => (
              <button
                key={item.key}
                className={rangeLabel === item.text ? 'active' : ''}
                type='button'
                onClick={() => setDateRange(quickRangeDates(item.text))}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <DatePicker
            className='ops-datepicker'
            dropdownClassName='ops-datepicker-panel'
            type='dateRange'
            format='yyyy-MM-dd'
            value={dateRange}
            size='small'
            position='bottomRight'
            autoAdjustOverflow
            presetPosition='top'
            showClear={false}
            getPopupContainer={() => document.body}
            triggerRender={() => (
              <button
                className={`ops-date-icon${
                  !QUICK_RANGES.some((item) => item.text === rangeLabel)
                    ? ' active'
                    : ''
                }`}
                type='button'
                title={formatRangeTrigger(dateRange)}
              >
                <IconCalendar />
              </button>
            )}
            presets={DATE_RANGE_PRESETS.map((preset) => ({
              text: t(preset.text),
              start: preset.start(),
              end: preset.end(),
            }))}
            onChange={(dates) => {
              if (!dates || dates.length !== 2 || !dates[0] || !dates[1]) {
                setDateRange(defaultDateRange());
                return;
              }
              setDateRange(dates);
            }}
          />
          <button
            className='btn primary'
            type='button'
            onClick={() => loadData(true)}
            disabled={loading}
          >
            {loading ? t('加载中') : t('刷新')}
          </button>
        </div>
      </div>

      <div className='page-body'>
      {loading ? <OpsLoader label={t('加载中')} /> : null}
      {overview ? (
      mainTab === 'overview' ? (
        <>
          <section className='metrics-grid'>
            {[
              {
                label: t('总消耗金额'),
                value: renderMoney(consume.quota),
                icon: '◎',
                color: 'blue',
                deltaValue: quotaToUsd(consume.quota),
                deltaOld: prevConsumeUsd,
              },
              {
                label: t('到账合计'),
                value: formatMoney(income),
                icon: '⊞',
                color: 'green',
                deltaValue: income,
                deltaOld: Number(previous?.income || 0),
              },
              {
                label: t('充值消耗比例'),
                value: (
                  <>
                    {renderMoney(consume.quota)}
                    <span className='metric-ratio-sep'> / </span>
                    {formatMoney(income)}
                  </>
                ),
                percent:
                  burnRatio == null ? '—' : `${(burnRatio * 100).toFixed(1)}%`,
                icon: '$',
                color: 'orange',
                deltaValue: burnRatio,
                deltaOld: prevBurnRatio,
              },
              {
                label: t('付费订单数'),
                value: paidCount.toLocaleString(),
                icon: '☰',
                color: 'purple',
                deltaValue: paidCount,
                deltaOld: Number(previous?.paid || 0),
              },
              {
                label: t('活跃用户'),
                value: users.toLocaleString(),
                icon: '◍',
                color: 'blue',
                deltaValue: users,
                deltaOld: Number(previous?.users || 0),
              },
              {
                label: t('成本支出'),
                value: formatMoney(monthCostTotal),
                icon: '⊟',
                color: 'rose',
                deltaValue: monthCostTotal,
                deltaOld: lastMonthCostTotal,
                compareLabel: t('较上月'),
              },
            ].map((item) => (
              <article className='card metric' key={item.label}>
                <span className={`metric-icon ${item.color}`}>{item.icon}</span>
                <div className='metric-body'>
                  <p className='metric-label'>{item.label}</p>
                  <div
                    className={`metric-value num${
                      item.percent != null ? ' is-ratio' : ''
                    }`}
                  >
                    {item.value}
                    {item.percent != null ? (
                      <span className='metric-ratio-pct num'>{item.percent}</span>
                    ) : null}
                  </div>
                  <MetricDelta
                    value={item.deltaValue}
                    oldValue={item.deltaOld}
                    label={item.compareLabel || t(compareLabel)}
                  />
                </div>
              </article>
            ))}
          </section>

          <section className='charts-grid'>
            <article className='card panel'>
              <div className='panel-head'>
                <div>
                  <h2 className='panel-title'>{t('消耗趋势')}</h2>
                  <p className='panel-sub'>{t('计费消耗与实际到账，分开观察')}</p>
                </div>
                <div className='legend'>
                  <span>
                    <i className='line-dot' />
                    {t('消耗金额')}
                  </span>
                  <span>
                    <i className='line-dot' style={{ background: '#0cb58a' }} />
                    {t('到账金额')}
                  </span>
                  <span className='tiny-label'>{t(rangeLabel)}</span>
                </div>
              </div>
              <div className='chart-shell'>
                {hasConsumeTrend ? (
                  <VChart
                    key={`consume-${start}-${end}`}
                    spec={consumeLine}
                    option={CHART_OPTION}
                  />
                ) : (
                  <div className='empty-state'>{t('该时段暂无消耗趋势')}</div>
                )}
              </div>
            </article>
            <article className='card panel'>
              <div className='panel-head'>
                <div>
                  <h2 className='panel-title'>{t('付费订单')}</h2>
                  <p className='panel-sub'>{t('按日统计支付成功的充值与订阅订单')}</p>
                </div>
                <div className='legend'>
                  <span>
                    <i className='line-dot' style={{ background: '#9b79ef' }} />
                    {t('付费订单')}
                  </span>
                </div>
              </div>
              <div className='chart-shell'>
                {hasOrders ? (
                  <VChart
                    key={`orders-${start}-${end}`}
                    spec={orderBars}
                    option={CHART_OPTION}
                  />
                ) : (
                  <div className='empty-state'>{t('该时段暂无付费订单')}</div>
                )}
              </div>
            </article>
          </section>

          <section className='ratio-grid'>
            <CostCard
              items={costItems}
              start={start}
              end={end}
              formatMoney={formatMoney}
              onChanged={loadCosts}
            />
            <RatioCard
              title={t('余额 / 订阅比例')}
              sub={t('充值与订阅分别带来多少到账')}
              pill={t('到账口径')}
              items={incomeItems}
              total={income}
              center={formatMoney(income)}
              centerLabel={t('到账合计')}
              footLeft={t('余额充值 + 订阅购买 = 到账合计')}
              footRight={`${paidCount} ${t('笔付费订单')}`}
            />
            <RatioCard
              title={t('消耗比例')}
              sub={t('订阅额度与余额额度的使用构成')}
              pill={t('消耗口径')}
              items={usageItems}
              total={quotaToUsd(consume.quota)}
              center={renderMoney(consume.quota)}
              centerLabel={t('总消耗')}
              footLeft={t('计费额度消耗，不等同于实际成本')}
              footRight={`${t('订阅占')} ${percentText(
                consume.subscription_quota,
                consume.quota,
              )}`}
            />
          </section>

          <section className='bottom-grid'>
            <article className='card bottom-card'>
              <div className='panel-head'>
                <h2 className='panel-title'>
                  {t('模型消耗')}{' '}
                  <span style={{ fontSize: 11, color: '#869bbb', fontWeight: 550 }}>
                    TOP 5
                  </span>
                </h2>
              </div>
              {topModels.length ? (
                <table className='model-table'>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('模型名称')}</th>
                      <th style={{ textAlign: 'right' }}>{t('消耗金额')}</th>
                      <th>{t('占比')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topModels.map((item, index) => {
                      const name = item.name || item.model_name;
                      const share = modelTotalQuota
                        ? (Number(item.quota || 0) / modelTotalQuota) * 100
                        : 0;
                      return (
                        <tr key={name}>
                          <td>
                            <span className={`rank rank-${index + 1}`}>
                              {index + 1}
                            </span>
                          </td>
                          <td className='model-name' title={name}>
                            {name}
                          </td>
                          <td className='amount-cell num'>
                            {renderMoney(item.quota)}
                          </td>
                          <td className='share-cell'>
                            <span className='share-value num'>
                              {percentText(item.quota, modelTotalQuota)}
                            </span>
                            <div className='mini-bar'>
                              <i style={{ width: `${share}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className='empty-state'>{t('当前区间暂无模型消耗')}</div>
              )}
              <div className='table-foot'>
                <span>{t('按计费消耗金额排序')}</span>
                <strong>
                  TOP 5 {t('占比')}{' '}
                  {percentText(
                    topModels.reduce((sum, item) => sum + Number(item.quota || 0), 0),
                    modelTotalQuota,
                  )}
                </strong>
              </div>
            </article>

            <article className='card bottom-card'>
              <div className='panel-head'>
                <h2 className='panel-title'>{t('充值概览')}</h2>
              </div>
              <div>
                {[
                  [t('充值笔数'), String(Number(revenue.topup_count || 0)), t('支付成功')],
                  [
                    t('平均充值金额'),
                    Number(revenue.topup_count || 0) ? formatMoney(avgTopup) : '—',
                    t('每笔'),
                  ],
                  [t('充值成功率'), successRate, t('在线订单')],
                  [
                    t('最大单笔充值'),
                    Number(revenue.max_single || 0)
                      ? formatMoney(revenue.max_single)
                      : '—',
                    t('已支付'),
                  ],
                ].map(([label, value, hint]) => (
                  <div className='recharge-item' key={label}>
                    <span>{label}</span>
                    <em>{hint}</em>
                    <strong
                      className='num'
                      style={
                        label === t('充值成功率') ? { color: '#0cb58a' } : undefined
                      }
                    >
                      {value}
                    </strong>
                  </div>
                ))}
              </div>
            </article>

            <article className='card bottom-card orders-card'>
              <div className='panel-head'>
                <h2 className='panel-title'>{t('最近订单')}</h2>
              </div>
              {(revenue.orders || []).length ? (
                <table className='order-table'>
                  <thead>
                    <tr>
                      <th>{t('订单号')}</th>
                      <th>{t('类型')}</th>
                      <th>{t('金额')}</th>
                      <th>{t('状态')}</th>
                      <th>{t('时间')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(revenue.orders || []).slice(0, 5).map((item) => {
                      const st = orderStatus(item.status);
                      return (
                        <tr key={item.trade_no}>
                          <td className='num' title={item.trade_no}>
                            {item.trade_no}
                          </td>
                          <td>{item.type}</td>
                          <td className='amount-cell num'>
                            {formatMoney(item.money)}
                          </td>
                          <td>
                            <span className={`status ${st.cls}`}>{st.text}</span>
                          </td>
                          <td className='num'>{formatClock(item.create_time)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className='empty-state'>{t('当前区间暂无订单')}</div>
              )}
              <div className='table-foot'>
                <span>
                  {t('共')} {Number(revenue.order_total || 0)} {t('笔订单')} ·{' '}
                  {t('含待支付及失败')}
                </span>
                <strong>{t('金额单位 USD')}</strong>
              </div>
            </article>
          </section>

          <footer className='main-footer'>
            <span>
              {t(
                '到账仅含已支付订单；消耗为计费额度。成本需手工记账，结余是到账减支出，不是利润。',
              )}
            </span>
            <span className='num'>
              {t('数据截至')} {formatDotDate(end)}
            </span>
          </footer>
        </>
      ) : (
        <article className='card rank-card'>
          <div className='rank-toolbar'>
            <div>
              <h2 className='panel-title'>{t('用量排行')}</h2>
              <p className='panel-sub'>
                {t('消耗金额按订阅 / 余额拆分；拆分未就绪时显示 --')}
              </p>
            </div>
            <Space>
              {myRank > 0 && (
                <Tag color='orange'>
                  {t('我的排名')} #{myRank}
                </Tag>
              )}
              <Select
                value={sort}
                onChange={setSort}
                optionList={SORT_OPTIONS}
                style={{ width: 120 }}
                size='small'
              />
              <Button
                icon={<IconRefresh />}
                onClick={() => loadData(true)}
                loading={loading}
                size='small'
              >
                {t('刷新')}
              </Button>
            </Space>
          </div>
          <Table
            dataSource={sortedRows}
            columns={columns}
            rowKey='user_id'
            loading={loading}
            pagination={false}
            size='small'
            onRow={(record) => ({
              style: record.is_self ? { background: '#eef4ff' } : {},
            })}
          />
        </article>
      )
      ) : loading ? null : (
        <div className='page-body-placeholder' />
      )}
      </div>
    </div>
  );
};

export default DailyRanking;
