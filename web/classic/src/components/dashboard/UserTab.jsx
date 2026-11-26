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

import React, { useEffect, useMemo, useState } from 'react';
import { Table } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { Users, ListOrdered } from 'lucide-react';
import { renderQuota } from '../../helpers';
import {
  byUser,
  formatInt,
  formatPercent,
  formatTokens,
  summarize,
  userTimeSeries,
} from '../../helpers/dashboardStats';
import { ChartCard, ChartEmpty, SegmentedTabs, numberColumn } from './parts';
import {
  CHART_OPTION,
  MAX_MODEL_SERIES,
  colorMapFor,
  quietAxes,
  seriesColors,
  textColor,
} from './vizTheme';

const RANK_LIMIT = 10;

export default function UserTab({
  data,
  buckets,
  granularity,
  loading,
  theme,
  ensureUsers,
  t,
}) {
  const [chartTab, setChartTab] = useState('rank');
  useEffect(() => {
    ensureUsers();
  }, [ensureUsers]);

  const users = useMemo(() => byUser(data), [data]);
  const totals = useMemo(() => summarize(data), [data]);
  const trendNames = useMemo(
    () => users.slice(0, MAX_MODEL_SERIES).map((u) => u.user),
    [users],
  );
  const trendRows = useMemo(
    () => userTimeSeries(data, buckets, granularity, trendNames),
    [data, buckets, granularity, trendNames],
  );
  const colorMap = useMemo(
    () => colorMapFor(trendNames, theme),
    [trendNames, theme],
  );
  const quotaFmt = (v) => renderQuota(v, 2);

  const spec = useMemo(() => {
    if (chartTab === 'trend') {
      return {
        type: 'line',
        data: [{ id: 'users', values: trendRows }],
        xField: 'Time',
        yField: 'quota',
        seriesField: 'User',
        color: {
          type: 'ordinal',
          domain: trendNames,
          range: trendNames.map((n) => colorMap[n]),
        },
        line: { style: { lineWidth: 2, lineCap: 'round', lineJoin: 'round' } },
        point: { visible: false },
        axes: quietAxes(quotaFmt),
        legends: { visible: true, orient: 'top', position: 'start' },
        tooltip: {
          mark: {
            content: [
              { key: (d) => d.User, value: (d) => renderQuota(d.quota, 4) },
            ],
          },
          dimension: {
            content: [{ key: (d) => d.User, value: (d) => d.quota }],
            updateContent: (items) =>
              items
                .sort((a, b) => Number(b.value) - Number(a.value))
                .map((i) => ({ ...i, value: renderQuota(Number(i.value), 4) })),
          },
        },
        background: 'transparent',
      };
    }
    const rank = users.slice(0, RANK_LIMIT);
    return {
      type: 'bar',
      direction: 'horizontal',
      data: [{ id: 'rank', values: rank }],
      xField: 'quota',
      yField: 'user',
      barMaxWidth: 20,
      bar: {
        style: { fill: seriesColors(theme)[0], cornerRadius: [0, 4, 4, 0] },
      },
      label: {
        visible: true,
        position: 'outside',
        style: { fill: textColor(2), fontSize: 12 },
        formatMethod: (v, d) =>
          `${renderQuota(d.quota, 2)}  ${formatPercent(d.quota, totals.quota)}`,
      },
      axes: [
        {
          orient: 'left',
          type: 'band',
          tick: { visible: false },
          domainLine: { visible: false },
        },
        { orient: 'bottom', type: 'linear', visible: false },
      ],
      legends: { visible: false },
      tooltip: {
        mark: {
          content: [
            { key: t('消耗额度'), value: (d) => renderQuota(d.quota, 4) },
            { key: t('请求次数'), value: (d) => formatInt(d.count) },
            { key: t('总 Token'), value: (d) => formatTokens(d.total) },
          ],
        },
      },
      background: 'transparent',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartTab, users, trendRows, trendNames, colorMap, totals.quota, theme]);

  const tokenFmt = (v) => <span title={formatInt(v)}>{formatTokens(v)}</span>;
  const columns = [
    { title: t('用户'), dataIndex: 'user', fixed: 'left', width: 180 },
    numberColumn({
      title: t('消耗额度'),
      dataIndex: 'quota',
      format: (v) => renderQuota(v, 2),
      share: (v) => formatPercent(v, totals.quota),
      width: 160,
      defaultSortOrder: 'descend',
    }),
    numberColumn({
      title: t('请求次数'),
      dataIndex: 'count',
      format: formatInt,
    }),
    numberColumn({
      title: t('总 Token'),
      dataIndex: 'total',
      format: tokenFmt,
    }),
    numberColumn({ title: t('输入'), dataIndex: 'input', format: tokenFmt }),
    numberColumn({ title: t('输出'), dataIndex: 'output', format: tokenFmt }),
    numberColumn({
      title: t('缓存读取'),
      dataIndex: 'cacheRead',
      format: tokenFmt,
    }),
    numberColumn({
      title: t('命中率'),
      dataIndex: 'hitRate',
      format: (v) =>
        v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`,
      width: 110,
    }),
  ];

  const hasData = users.length > 0;

  return (
    <div className='flex flex-col gap-4'>
      <ChartCard
        title={t('用户分析')}
        icon={<Users size={16} />}
        subtitle={`${t('用户')} ${users.length} · ${renderQuota(totals.quota, 2)}`}
        dimmed={loading && hasData}
        extra={
          <SegmentedTabs
            value={chartTab}
            onChange={setChartTab}
            options={[
              { value: 'rank', label: t('消耗排行') },
              { value: 'trend', label: t('消耗趋势') },
            ]}
          />
        }
      >
        <div className={chartTab === 'rank' ? 'h-[360px]' : 'h-80'}>
          {hasData ? (
            <VChart spec={spec} option={CHART_OPTION} />
          ) : (
            <ChartEmpty
              text={loading ? t('加载中') : t('所选时间内没有用量')}
            />
          )}
        </div>
      </ChartCard>

      <ChartCard
        title={t('用户明细')}
        icon={<ListOrdered size={16} />}
        bodyClassName='p-0'
        dimmed={loading && hasData}
      >
        <Table
          columns={columns}
          dataSource={users}
          rowKey='user'
          size='small'
          loading={loading && !hasData}
          pagination={
            users.length > 20 ? { pageSize: 20, showSizeChanger: false } : false
          }
          scroll={{ x: 1130 }}
          empty={t('所选时间内没有用量')}
        />
      </ChartCard>
    </div>
  );
}
