import { API } from '../../helpers';

const OPTIONAL = { skipErrorHandler: true };
export const OPS_COST_OPTION_KEY = 'ops_cost_records';
const TABLE_URL = '/api/analytics/ops-costs';

export const COST_CATEGORIES = [
  { value: 'upstream', label: '上游充值', color: '#286aff' },
  { value: 'account', label: '账号充值', color: '#ff9648' },
  { value: 'server', label: '服务器', color: '#0cb58a' },
  { value: 'domain', label: '域名 / CDN', color: '#9166ee' },
  { value: 'other', label: '其他', color: '#12bde6' },
];

export const costCategoryMeta = (value) =>
  COST_CATEGORIES.find((item) => item.value === value) || {
    value: value || 'other',
    label: value || '其他',
    color: '#bcc8db',
  };

let backend = null;

const asItems = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  if (typeof raw === 'string') {
    try {
      return asItems(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
};

const nowTs = () => Math.floor(Date.now() / 1000);

const normalizeItem = (item) => ({
  id: Number(item.id || 0),
  category: String(item.category || 'other'),
  title: String(item.title || ''),
  amount: Number(item.amount || 0),
  occurred_at: Number(item.occurred_at || 0),
  note: String(item.note || ''),
  created_at: Number(item.created_at || 0),
  updated_at: Number(item.updated_at || 0),
});

async function detectBackend() {
  if (backend) return backend;
  try {
    const res = await API.get(TABLE_URL, OPTIONAL);
    if (res?.data?.success) {
      backend = 'table';
      return backend;
    }
  } catch {
    /* 正式环境未发版时没有这张表 */
  }
  backend = 'option';
  return backend;
}

async function loadOptionItems() {
  const res = await API.get('/api/option/', OPTIONAL);
  if (!res?.data?.success) {
    const error = new Error(res?.data?.message || '无法读取成本记录');
    error.status = res?.status;
    throw error;
  }
  const row = (res.data.data || []).find(
    (item) => item.key === OPS_COST_OPTION_KEY,
  );
  return asItems(row?.value).map(normalizeItem);
}

async function saveOptionItems(items) {
  try {
    const res = await API.put(
      '/api/option/',
      { key: OPS_COST_OPTION_KEY, value: JSON.stringify(items) },
      OPTIONAL,
    );
    if (!res?.data?.success) {
      throw new Error(res?.data?.message || '保存失败，请使用站长账号');
    }
  } catch (err) {
    throw new Error(
      err?.response?.data?.message || err?.message || '保存失败，请使用站长账号',
    );
  }
}

export async function listOpsCosts() {
  const mode = await detectBackend();
  if (mode === 'table') {
    try {
      const res = await API.get(TABLE_URL, OPTIONAL);
      if (res?.data?.success) {
        return asItems(res.data.data).map(normalizeItem);
      }
    } catch {
      /* 正式环境未发版时走 options 暂存 */
    }
    backend = 'option';
    return listOpsCosts();
  }
  try {
    return await loadOptionItems();
  } catch {
    return [];
  }
}

const fail = (err, fallback) => {
  throw new Error(
    err?.response?.data?.message || err?.message || fallback,
  );
};

export async function createOpsCost(payload) {
  try {
    const mode = await detectBackend();
    if (mode === 'table') {
      const res = await API.post(TABLE_URL, payload, OPTIONAL);
      if (!res?.data?.success) {
        throw new Error(res?.data?.message || '保存失败');
      }
      return normalizeItem(res.data.data);
    }
    const items = await loadOptionItems();
    const next = normalizeItem({
      ...payload,
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      created_at: nowTs(),
      updated_at: nowTs(),
    });
    items.unshift(next);
    await saveOptionItems(items);
    return next;
  } catch (err) {
    fail(err, '保存失败');
  }
}

export async function updateOpsCost(payload) {
  try {
    const mode = await detectBackend();
    if (mode === 'table') {
      const res = await API.put(TABLE_URL, payload, OPTIONAL);
      if (!res?.data?.success) {
        throw new Error(res?.data?.message || '保存失败');
      }
      return normalizeItem(res.data.data);
    }
    const items = await loadOptionItems();
    const next = items.map((item) =>
      Number(item.id) === Number(payload.id)
        ? normalizeItem({ ...item, ...payload, updated_at: nowTs() })
        : item,
    );
    await saveOptionItems(next);
    return next.find((item) => Number(item.id) === Number(payload.id));
  } catch (err) {
    fail(err, '保存失败');
  }
}

export async function deleteOpsCost(id) {
  try {
    const mode = await detectBackend();
    if (mode === 'table') {
      const res = await API.delete(`${TABLE_URL}/${id}`, OPTIONAL);
      if (!res?.data?.success) {
        throw new Error(res?.data?.message || '删除失败');
      }
      return;
    }
    const items = await loadOptionItems();
    await saveOptionItems(
      items.filter((item) => Number(item.id) !== Number(id)),
    );
  } catch (err) {
    fail(err, '删除失败');
  }
}
