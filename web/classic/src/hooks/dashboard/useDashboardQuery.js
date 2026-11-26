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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API, showError } from '../../helpers';
import { buildBuckets, last24hStart } from '../../helpers/dashboardStats';

const PRESET_KEY = 'dashboard_range_preset';
const LEGACY_GRANULARITY_KEY = 'data_export_default_time';

export const RANGE_PRESETS = [
  { key: '24h', label: '近 24 小时', granularity: 'hour' },
  { key: '7d', label: '近 7 天', granularity: 'day' },
  { key: '30d', label: '近 30 天', granularity: 'day' },
];

function initialPreset() {
  const saved = localStorage.getItem(PRESET_KEY);
  if (RANGE_PRESETS.some((p) => p.key === saved)) return saved;
  // 沿用旧版「时间粒度」偏好：小时→近 24 小时，天→近 7 天，周→近 30 天
  const legacy = localStorage.getItem(LEGACY_GRANULARITY_KEY);
  if (legacy === 'day') return '7d';
  if (legacy === 'week') return '30d';
  return '24h';
}

export function presetRange(key) {
  const now = Math.floor(Date.now() / 1000);
  const preset = RANGE_PRESETS.find((p) => p.key === key) || RANGE_PRESETS[0];
  if (preset.key === '24h') {
    return {
      preset: preset.key,
      start: last24hStart(now),
      end: now,
      granularity: 'hour',
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = preset.key === '7d' ? 6 : 29;
  const start = Math.floor(today.getTime() / 1000) - days * 86400;
  return {
    preset: preset.key,
    start,
    end: now,
    granularity: preset.granularity,
  };
}

// 看板数据：一次取回所选时间段的 quota_data，用量 / 模型分析 / 用户分析三个视图共用
export function useDashboardQuery({ isAdminUser }) {
  const [query, setQuery] = useState(() => ({
    ...presetRange(initialPreset()),
    username: '',
  }));
  const [quotaData, setQuotaData] = useState([]);
  const [userData, setUserData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [userLoading, setUserLoading] = useState(false);
  const [userLoadedFor, setUserLoadedFor] = useState('');
  const seq = useRef(0);

  const rangeParams = (q) => {
    // 结束时间往后放一小时，包含当前小时（后端会按当前时间截断）
    const end = q.preset === 'custom' ? q.end : q.end + 3600;
    return `start_timestamp=${q.start}&end_timestamp=${end}`;
  };

  const load = useCallback(
    async (q) => {
      const id = ++seq.current;
      setLoading(true);
      try {
        const url = isAdminUser
          ? `/api/data/?username=${encodeURIComponent(q.username || '')}&${rangeParams(q)}`
          : `/api/data/self?${rangeParams(q)}`;
        const res = await API.get(url);
        if (id !== seq.current) return;
        const { success, message, data } = res.data;
        if (success) {
          setQuotaData(Array.isArray(data) ? data : []);
        } else {
          showError(message);
        }
      } catch (err) {
        if (id === seq.current) showError(err?.message || String(err));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [isAdminUser],
  );

  const loadUsers = useCallback(
    async (q) => {
      if (!isAdminUser) return;
      setUserLoading(true);
      try {
        const res = await API.get(`/api/data/users?${rangeParams(q)}`);
        const { success, message, data } = res.data;
        if (success) {
          setUserData(Array.isArray(data) ? data : []);
          setUserLoadedFor(`${q.start}-${q.end}`);
        } else {
          showError(message);
        }
      } catch (err) {
        showError(err?.message || String(err));
      } finally {
        setUserLoading(false);
      }
    },
    [isAdminUser],
  );

  useEffect(() => {
    load(query);
  }, [query, load]);

  const applyPreset = useCallback((key) => {
    localStorage.setItem(PRESET_KEY, key);
    setQuery((q) => ({ ...presetRange(key), username: q.username }));
  }, []);

  const applyCustom = useCallback((next) => {
    setQuery((q) => ({ ...q, ...next, preset: next.preset || 'custom' }));
  }, []);

  const refresh = useCallback(() => {
    // 预设区间刷新时把终点推到现在；用户分析下次进入时重新取
    setUserLoadedFor('');
    setQuery((q) =>
      q.preset === 'custom'
        ? { ...q }
        : {
            ...presetRange(q.preset),
            granularity: q.granularity,
            username: q.username,
          },
    );
  }, []);

  const ensureUsers = useCallback(() => {
    if (userLoadedFor !== `${query.start}-${query.end}` && !userLoading) {
      loadUsers(query);
    }
  }, [query, userLoadedFor, userLoading, loadUsers]);

  const buckets = useMemo(
    () => buildBuckets(query.start, query.end, query.granularity),
    [query.start, query.end, query.granularity],
  );

  const rangeMinutes = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return Math.max(1, (Math.min(query.end, now) - query.start) / 60);
  }, [query.start, query.end]);

  return {
    query,
    quotaData,
    userData,
    loading,
    loaded,
    userLoading,
    buckets,
    rangeMinutes,
    applyPreset,
    applyCustom,
    refresh,
    ensureUsers,
  };
}
