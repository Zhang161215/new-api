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

import React, { useEffect, useState } from 'react';
import {
  Button,
  DatePicker,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Tag,
} from '@douyinfe/semi-ui';
import { CalendarRange, RefreshCw, Search } from 'lucide-react';
import { RANGE_PRESETS } from '../../hooks/dashboard/useDashboardQuery';

const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// 一行筛选条：作用于用量 / 模型调用分析 / 用户分析三个视图
export default function RangeBar({
  query,
  isAdminUser,
  loading,
  onPreset,
  onCustom,
  onRefresh,
  isMobile,
  t,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [userInput, setUserInput] = useState(query.username || '');

  useEffect(() => {
    setUserInput(query.username || '');
  }, [query.username]);

  const granularityOptions = [
    { label: t('按小时'), value: 'hour' },
    { label: t('按天'), value: 'day' },
    { label: t('按周'), value: 'week' },
  ];

  const openCustom = () => {
    setDraft({
      range: [new Date(query.start * 1000), new Date(query.end * 1000)],
      granularity: query.granularity,
      username: query.username || '',
    });
    setOpen(true);
  };

  const confirmCustom = () => {
    const [s, e] = draft?.range || [];
    if (!s || !e) {
      setOpen(false);
      return;
    }
    onCustom({
      start: Math.floor(new Date(s).getTime() / 1000),
      end: Math.floor(new Date(e).getTime() / 1000),
      granularity: draft.granularity,
      username: isAdminUser ? draft.username.trim() : '',
      preset: 'custom',
    });
    setOpen(false);
  };

  const applyUserSearch = () => {
    const next = userInput.trim();
    if (next !== (query.username || '')) {
      onCustom({ username: next, preset: query.preset });
    }
  };

  let scope = t('我的数据');
  if (isAdminUser)
    scope = query.username ? `${t('用户')}：${query.username}` : t('全站数据');

  return (
    <div className='mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
      <div className='flex flex-wrap items-center gap-2'>
        <RadioGroup
          type='button'
          value={query.preset === 'custom' ? '' : query.preset}
          onChange={(e) => onPreset(e.target.value)}
        >
          {RANGE_PRESETS.map((p) => (
            <Radio key={p.key} value={p.key}>
              {t(p.label)}
            </Radio>
          ))}
        </RadioGroup>
        <Button
          icon={<CalendarRange size={14} />}
          theme={query.preset === 'custom' ? 'light' : 'borderless'}
          type={query.preset === 'custom' ? 'primary' : 'tertiary'}
          onClick={openCustom}
        >
          {t('自定义')}
        </Button>
        <Select
          value={query.granularity}
          optionList={granularityOptions}
          onChange={(v) => onCustom({ granularity: v, preset: query.preset })}
          style={{ width: 104 }}
        />
        {isAdminUser ? (
          <Input
            prefix={<Search size={13} className='text-semi-color-text-2' />}
            value={userInput}
            onChange={(v) => {
              setUserInput(v);
              if (v === '' && query.username) {
                onCustom({ username: '', preset: query.preset });
              }
            }}
            onEnterPress={applyUserSearch}
            onBlur={applyUserSearch}
            showClear
            placeholder={t('按用户名筛选')}
            style={{ width: 168 }}
          />
        ) : null}
      </div>
      <div className='flex flex-wrap items-center gap-2 text-xs text-semi-color-text-2'>
        <Tag
          color={query.username ? 'blue' : 'grey'}
          closable={isAdminUser && !!query.username}
          onClose={() => onCustom({ username: '', preset: query.preset })}
        >
          {scope}
        </Tag>
        <span>
          {fmt(query.start)} ~{' '}
          {query.preset === 'custom' ? fmt(query.end) : t('现在')}
        </span>
        <Button
          icon={<RefreshCw size={14} />}
          loading={loading}
          onClick={onRefresh}
          theme='borderless'
          aria-label={t('刷新')}
        />
      </div>

      <Modal
        title={t('自定义时间范围')}
        visible={open}
        onOk={confirmCustom}
        onCancel={() => setOpen(false)}
        size={isMobile ? 'full-width' : 'small'}
        centered
      >
        {draft ? (
          <div className='flex flex-col gap-3'>
            <div>
              <div className='mb-1 text-sm'>{t('时间范围')}</div>
              <DatePicker
                type='dateTimeRange'
                value={draft.range}
                onChange={(v) => setDraft((d) => ({ ...d, range: v }))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <div className='mb-1 text-sm'>{t('时间粒度')}</div>
              <Select
                value={draft.granularity}
                optionList={granularityOptions}
                onChange={(v) => setDraft((d) => ({ ...d, granularity: v }))}
                style={{ width: '100%' }}
              />
            </div>
            {isAdminUser ? (
              <div>
                <div className='mb-1 text-sm'>{t('用户名称')}</div>
                <Input
                  value={draft.username}
                  placeholder={t('留空为全站数据')}
                  onChange={(v) => setDraft((d) => ({ ...d, username: v }))}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
