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

import React, { useMemo, useState } from 'react';
import { Table, Tooltip } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { BarChart3, ListOrdered } from 'lucide-react';
import { renderQuota } from '../../helpers';
import {
  byModel,
  formatInt,
  formatPercent,
  formatTokens,
  modelTimeSeries,
  summarize,
  topModelNames,
} from '../../helpers/dashboardStats';
import { ChartCard, ChartEmpty, SegmentedTabs, numberColumn } from './parts';
import {
  CHART_OPTION,
  MAX_MODEL_SERIES,
  colorMapFor,
  quietAxes,
  surfaceColor,
  textColor,
} from './vizTheme';
import { TOKEN_RULE_TEXT } from './UsageTab';

const RANK_LIMIT = 15;

const METRICS = {
  quota: {
    label: '消耗额度',
    format: (v) => renderQuota(v, 2),
    tip: (v) => renderQuota(v, 4),
  },
  count: { label: '调用次数', format: formatInt, tip: formatInt },
  total: { label: '总 Token', format: formatTokens, tip: formatTokens },
};

export default function ModelTab({
  data,
  buckets,
  granularity,
  loading,
  loaded,
  theme,
  t,
}) {
  const [chartTab, setChartTab] = useState('quota');
  const otherLabel = t('其他');
  const models = useMemo(() => byModel(data), [data]);
  const totals = useMemo(() => summarize(data), [data]);
  const topNames = useMemo(
    () => topModelNames(models, MAX_MODEL_SERIES),
    [models],
  );
  const { rows: timeRows, names } = useMemo(
    () => modelTimeSeries(data, buckets, granularity, topNames, otherLabel),
    [data, buckets, granularity, topNames, otherLabel],
  );
  // 颜色按本次数据的额度排名分配一次，趋势图、排行、表格共用，切换指标不重新上色
  const colorMap = useMemo(
    () => colorMapFor(names, theme, otherLabel),
    [names, theme, otherLabel],
  );
  const colorOf = (name) => colorMap[name] || colorMap[otherLabel];

  const spec = useMemo(() => {
    if (chartTab === 'rank') {
      const rank = [...models]
        .sort((a, b) => b.count - a.count)
        .slice(0, RANK_LIMIT)
        .map((m) => ({
          model: m.model,
          count: m.count,
          color: colorMap[m.model] || colorMap[otherLabel] || '#999',
        }));
      return {
        type: 'bar',
        direction: 'horizontal',
        data: [{ id: 'rank', values: rank }],
        xField: 'count',
        yField: 'model',
        barMaxWidth: 20,
        bar: { style: { fill: (d) => d.color, cornerRadius: [0, 4, 4, 0] } },
        label: {
          visible: true,
          position: 'outside',
          style: { fill: textColor(2), fontSize: 12 },
          formatMethod: (v, d) =>
            `${formatInt(d.count)}  ${formatPercent(d.count, totals.count)}`,
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
              { key: t('调用次数'), value: (d) => formatInt(d.count) },
              {
                key: t('占比'),
                value: (d) => formatPercent(d.count, totals.count),
              },
            ],
          },
        },
        background: 'transparent',
      };
    }
    const metric = METRICS[chartTab];
    const base = {
      data: [{ id: 'models', values: timeRows }],
      xField: 'Time',
      yField: chartTab,
      seriesField: 'Model',
      color: { type: 'ordinal', domain: names, range: names.map(colorOf) },
      axes: quietAxes(metric.format),
      legends: { visible: true, orient: 'top', position: 'start', maxRow: 2 },
      tooltip: {
        mark: {
          content: [
            { key: (d) => d.Model, value: (d) => metric.tip(d[chartTab]) },
          ],
        },
        dimension: {
          content: [{ key: (d) => d.Model, value: (d) => d[chartTab] }],
          updateContent: (items) => {
            const sum = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
            const sorted = items
              .filter((i) => Number(i.value) > 0)
              .sort((a, b) => Number(b.value) - Number(a.value))
              .map((i) => ({ ...i, value: metric.tip(Number(i.value)) }));
            sorted.unshift({
              key: t('合计'),
              value: metric.tip(sum),
              hasShape: false,
            });
            return sorted;
          },
        },
      },
      background: 'transparent',
    };
    if (chartTab === 'count') {
      return {
        ...base,
        type: 'line',
        line: { style: { lineWidth: 2, lineCap: 'round', lineJoin: 'round' } },
        point: { visible: false },
      };
    }
    return {
      ...base,
      type: 'bar',
      stack: true,
      barMaxWidth: 24,
      bar: { style: { stroke: surfaceColor(theme), lineWidth: 2 } },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartTab, timeRows, names, colorMap, models, totals.count, theme]);

  const tokenFmt = (v) => <span title={formatInt(v)}>{formatTokens(v)}</span>;
  const rateFmt = (v) =>
    v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`;
  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model',
      fixed: 'left',
      width: 230,
      render: (name) => (
        <span className='inline-flex items-center gap-2 min-w-0'>
          <span
            className='inline-block h-2.5 w-2.5 shrink-0 rounded-sm'
            style={{ background: colorOf(name) }}
          />
          <span className='truncate' title={name}>
            {name}
          </span>
        </span>
      ),
    },
    numberColumn({
      title: t('调用次数'),
      dataIndex: 'count',
      format: formatInt,
      share: (v) => formatPercent(v, totals.count),
      width: 140,
    }),
    numberColumn({
      title: t('消耗额度'),
      dataIndex: 'quota',
      format: (v) => renderQuota(v, 2),
      share: (v) => formatPercent(v, totals.quota),
      width: 160,
      defaultSortOrder: 'descend',
    }),
    numberColumn({
      title: (
        <Tooltip content={t(TOKEN_RULE_TEXT)}>
          <span className='cursor-help'>{t('总 Token')}</span>
        </Tooltip>
      ),
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
      title: t('缓存创建'),
      dataIndex: 'cacheWrite',
      format: tokenFmt,
    }),
    numberColumn({
      title: t('命中率'),
      dataIndex: 'hitRate',
      format: rateFmt,
      width: 110,
    }),
    numberColumn({
      title: t('平均每次 Token'),
      dataIndex: 'avgTokens',
      format: tokenFmt,
      width: 190,
    }),
  ];

  const hasData = models.length > 0;

  return (
    <div className='flex flex-col gap-4'>
      <ChartCard
        title={t('模型调用分析')}
        icon={<BarChart3 size={16} />}
        subtitle={`${t('模型')} ${totals.modelCount} · ${t('调用')} ${formatInt(totals.count)} · ${renderQuota(totals.quota, 2)}`}
        dimmed={loading && loaded}
        extra={
          <SegmentedTabs
            value={chartTab}
            onChange={setChartTab}
            options={[
              { value: 'quota', label: t('消耗分布') },
              { value: 'count', label: t('调用趋势') },
              { value: 'total', label: t('Token 分布') },
              { value: 'rank', label: t('调用排行') },
            ]}
          />
        }
      >
        <div className={chartTab === 'rank' ? 'h-[420px]' : 'h-80'}>
          {hasData ? (
            <VChart spec={spec} option={CHART_OPTION} />
          ) : (
            <ChartEmpty text={t('所选时间内没有调用')} />
          )}
        </div>
        {hasData && models.length > MAX_MODEL_SERIES && chartTab !== 'rank' ? (
          <div className='px-1 pt-1 text-xs text-semi-color-text-2'>
            {t(
              '按消耗额度取前 {{n}} 个模型单独显示，其余合并为「其他」，完整数据见下方明细。',
              { n: MAX_MODEL_SERIES },
            )}
          </div>
        ) : null}
      </ChartCard>

      <ChartCard
        title={t('模型明细')}
        icon={<ListOrdered size={16} />}
        subtitle={t('点击表头排序')}
        dimmed={loading && loaded}
        bodyClassName='p-0'
      >
        <Table
          columns={columns}
          dataSource={models}
          rowKey='model'
          size='small'
          loading={loading && !loaded}
          pagination={
            models.length > 20
              ? { pageSize: 20, showSizeChanger: false }
              : false
          }
          scroll={{ x: 1500 }}
          empty={t('所选时间内没有调用')}
        />
      </ChartCard>
    </div>
  );
}
