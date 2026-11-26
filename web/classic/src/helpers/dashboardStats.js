/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// 数据看板的统计口径（与后端 model/usedata_tokens.go 一致）：
//   输入 = 非缓存输入 + 缓存读取 + 缓存创建；输出 = completion；总 Token = 输入 + 输出。
// 缓存读取 / 缓存创建是输入的一部分，单独展示，不再额外加进总数。
// 旧数据（升级前、且超出日志保留期无法回算的）只有总量，没有输入 / 输出拆分，记为「未拆分」。

export const GRANULARITY_SECONDS = { hour: 3600, day: 86400, week: 604800 };
const MAX_BUCKETS = 2000;

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const pad2 = (n) => String(n).padStart(2, '0');

// 近 24 小时的起点对齐到整点：quota_data 按整点记录，起点落在小时中间时那一小时整行会被筛掉，第一根柱子总是空的
export const last24hStart = (now) => Math.ceil((now - 86400) / 3600) * 3600;

// ========== 时间分桶 ==========
export function bucketStart(ts, granularity) {
  const d = new Date(ts * 1000);
  if (granularity === 'day' || granularity === 'week') {
    d.setHours(0, 0, 0, 0);
    if (granularity === 'week') {
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 周一为一周起点
    }
  } else {
    d.setMinutes(0, 0, 0);
  }
  return Math.floor(d.getTime() / 1000);
}

function nextBucket(ts, granularity) {
  const d = new Date(ts * 1000);
  if (granularity === 'week') d.setDate(d.getDate() + 7);
  else if (granularity === 'day') d.setDate(d.getDate() + 1);
  else d.setHours(d.getHours() + 1);
  return Math.floor(d.getTime() / 1000);
}

export function bucketLabel(ts, granularity, showYear = false) {
  const d = new Date(ts * 1000);
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const date = showYear ? `${d.getFullYear()}-${md}` : md;
  if (granularity === 'hour') return `${date} ${pad2(d.getHours())}:00`;
  if (granularity === 'week') {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    return `${date}~${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
  }
  return date;
}

// 从起点到终点的完整桶序列（没数据的桶补 0，趋势才不会断档）
export function buildBuckets(start, end, granularity) {
  const first = bucketStart(start, granularity);
  const last = bucketStart(Math.max(start, end), granularity);
  const showYear =
    new Date(first * 1000).getFullYear() !==
    new Date(last * 1000).getFullYear();
  const buckets = [];
  for (
    let ts = first;
    ts <= last && buckets.length < MAX_BUCKETS;
    ts = nextBucket(ts, granularity)
  ) {
    buckets.push({ ts, label: bucketLabel(ts, granularity, showYear) });
  }
  return buckets;
}

// ========== 单行 Token 拆分 ==========
export function rowTokens(item) {
  const reported = num(item.token_used);
  const input = num(item.input_tokens);
  const output = num(item.output_tokens);
  const cacheRead = num(item.cache_read_tokens);
  const cacheWrite = num(item.cache_creation_tokens);
  const split = input + output;
  // 新口径行 token_used = 输入 + 输出；旧口径行没有拆分，整行记为未拆分
  const legacy = Math.max(0, reported - split);
  // 构成图里缓存要落在输入之内（OpenAI 缓存写入偶尔与读取重叠，超出部分不重复画）
  const readIn = Math.min(cacheRead, input);
  const writeIn = Math.min(cacheWrite, input - readIn);
  return {
    total: split + legacy,
    input,
    output,
    cacheRead,
    cacheWrite,
    readIn,
    writeIn,
    uncached: input - readIn - writeIn,
    legacy,
  };
}

const TOKEN_KEYS = [
  'total',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'readIn',
  'writeIn',
  'uncached',
  'legacy',
];

const emptyTotals = () => {
  const acc = { count: 0, quota: 0 };
  TOKEN_KEYS.forEach((k) => {
    acc[k] = 0;
  });
  return acc;
};

function addRow(acc, item) {
  acc.count += num(item.count);
  acc.quota += num(item.quota);
  const tokens = rowTokens(item);
  TOKEN_KEYS.forEach((k) => {
    acc[k] += tokens[k];
  });
  return acc;
}

// ========== 汇总 ==========
export function summarize(data) {
  const acc = emptyTotals();
  const models = new Set();
  (data || []).forEach((item) => {
    addRow(acc, item);
    if (item.model_name) models.add(item.model_name);
  });
  acc.modelCount = models.size;
  return acc;
}

// 缓存命中率：缓存读取 / 输入（只算有拆分的数据）
export function cacheHitRate(totals) {
  return totals.input > 0 ? totals.readIn / totals.input : null;
}

// ========== 按时间 ==========
export function timeSeries(data, buckets, granularity) {
  const index = new Map(buckets.map((b, i) => [b.ts, i]));
  const rows = buckets.map((b) => ({ ...b, ...emptyTotals() }));
  (data || []).forEach((item) => {
    const i = index.get(bucketStart(num(item.created_at), granularity));
    if (i !== undefined) addRow(rows[i], item);
  });
  return rows;
}

// 明细表用的派生列：命中率（缓存读取 / 输入，没有拆分时为空）、平均每次 Token
function withRatios(row) {
  row.hitRate = row.input > 0 ? row.readIn / row.input : null;
  row.avgTokens = row.count > 0 ? row.total / row.count : 0;
  return row;
}

// ========== 按模型 ==========
export function byModel(data) {
  const map = new Map();
  (data || []).forEach((item) => {
    const name = item.model_name || '-';
    if (!map.has(name)) map.set(name, { model: name, ...emptyTotals() });
    addRow(map.get(name), item);
  });
  return Array.from(map.values())
    .map(withRatios)
    .sort(
      (a, b) => b.quota - a.quota || b.count - a.count || b.total - a.total,
    );
}

// 图表里只给前 N 个模型单独配色，其余合并为「其他」（颜色按本次数据的额度排名固定，所有图共用）
export function topModelNames(models, limit) {
  return models.slice(0, limit).map((m) => m.model);
}

export function modelTimeSeries(
  data,
  buckets,
  granularity,
  topNames,
  otherLabel,
) {
  const top = new Set(topNames);
  const index = new Map(buckets.map((b, i) => [b.ts, i]));
  const names = [...topNames];
  const cells = new Map();
  let hasOther = false;
  (data || []).forEach((item) => {
    const i = index.get(bucketStart(num(item.created_at), granularity));
    if (i === undefined) return;
    const name = top.has(item.model_name) ? item.model_name : otherLabel;
    if (name === otherLabel) hasOther = true;
    const key = `${i}\u0000${name}`;
    if (!cells.has(key)) cells.set(key, { count: 0, quota: 0, total: 0 });
    const cell = cells.get(key);
    cell.count += num(item.count);
    cell.quota += num(item.quota);
    cell.total += rowTokens(item).total;
  });
  if (hasOther) names.push(otherLabel);
  const rows = [];
  buckets.forEach((b, i) => {
    names.forEach((name) => {
      const cell = cells.get(`${i}\u0000${name}`) || {
        count: 0,
        quota: 0,
        total: 0,
      };
      rows.push({ Time: b.label, Model: name, ...cell });
    });
  });
  return { rows, names };
}

// ========== 按用户（管理员） ==========
export function byUser(data) {
  const map = new Map();
  (data || []).forEach((item) => {
    const name = item.username || '-';
    if (!map.has(name)) map.set(name, { user: name, ...emptyTotals() });
    addRow(map.get(name), item);
  });
  return Array.from(map.values())
    .map(withRatios)
    .sort((a, b) => b.quota - a.quota || b.count - a.count);
}

export function userTimeSeries(data, buckets, granularity, topNames) {
  const top = new Set(topNames);
  const index = new Map(buckets.map((b, i) => [b.ts, i]));
  const cells = new Map();
  (data || []).forEach((item) => {
    if (!top.has(item.username)) return;
    const i = index.get(bucketStart(num(item.created_at), granularity));
    if (i === undefined) return;
    const key = `${i}\u0000${item.username}`;
    cells.set(key, (cells.get(key) || 0) + num(item.quota));
  });
  const rows = [];
  buckets.forEach((b, i) => {
    topNames.forEach((name) => {
      rows.push({
        Time: b.label,
        User: name,
        quota: cells.get(`${i}\u0000${name}`) || 0,
      });
    });
  });
  return rows;
}

// ========== 格式化 ==========
export function formatTokens(value) {
  const n = num(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export const formatInt = (value) => Math.round(num(value)).toLocaleString();

export function formatPercent(part, whole, digits = 1) {
  if (!(whole > 0)) return '-';
  return `${((num(part) / whole) * 100).toFixed(digits)}%`;
}

export function formatRate(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e4) return formatTokens(n);
  return n.toFixed(n >= 100 ? 0 : digits);
}
