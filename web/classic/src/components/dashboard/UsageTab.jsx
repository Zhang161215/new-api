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
import { Banner } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { Coins, Layers, Activity } from 'lucide-react';
import { renderQuota } from '../../helpers';
import {
  cacheHitRate,
  formatInt,
  formatPercent,
  formatRate,
  formatTokens,
  summarize,
  timeSeries,
} from '../../helpers/dashboardStats';
import {
  ChartCard,
  ChartEmpty,
  CompositionBar,
  SegmentedTabs,
  StatTile,
} from './parts';
import {
  CHART_OPTION,
  quietAxes,
  seriesColors,
  surfaceColor,
  tokenPartColors,
} from './vizTheme';

export const TOKEN_RULE_TEXT =
  'Token 口径：输入 = 非缓存输入 + 缓存读取 + 缓存创建，总 Token = 输入 + 输出。各家协议对缓存的计法不同（Claude 的输入不含缓存，OpenAI / Gemini 含缓存），看板统一换算成这一口径。';

function singleBarSpec({ rows, field, color, format }) {
  return {
    type: 'bar',
    data: [{ id: 'd', values: rows }],
    xField: 'label',
    yField: field,
    barMaxWidth: 24,
    bar: { style: { fill: color, cornerRadius: [4, 4, 0, 0] } },
    axes: quietAxes(format),
    legends: { visible: false },
    tooltip: {
      mark: {
        content: [{ key: (d) => d.label, value: (d) => format(d[field]) }],
      },
      dimension: {
        content: [{ key: (d) => d.label, value: (d) => format(d[field]) }],
      },
    },
    background: 'transparent',
  };
}

function singleLineSpec({ rows, field, color, format }) {
  return {
    type: 'area',
    data: [{ id: 'd', values: rows }],
    xField: 'label',
    yField: field,
    line: {
      style: {
        stroke: color,
        lineWidth: 2,
        lineCap: 'round',
        lineJoin: 'round',
      },
    },
    area: { style: { fill: color, fillOpacity: 0.1 } },
    point: { visible: false },
    axes: quietAxes(format),
    legends: { visible: false },
    tooltip: {
      mark: {
        content: [{ key: (d) => d.label, value: (d) => format(d[field]) }],
      },
      dimension: {
        content: [{ key: (d) => d.label, value: (d) => format(d[field]) }],
      },
    },
    background: 'transparent',
  };
}

export default function UsageTab({
  data,
  buckets,
  granularity,
  rangeMinutes,
  loading,
  loaded,
  theme,
  t,
}) {
  const [trendTab, setTrendTab] = useState('quota');
  const totals = useMemo(() => summarize(data), [data]);
  const series = useMemo(
    () => timeSeries(data, buckets, granularity),
    [data, buckets, granularity],
  );
  const colors = seriesColors(theme);
  const parts = tokenPartColors(theme);
  const hit = cacheHitRate(totals);
  const showSkeleton = loading && !loaded;

  const partList = [
    {
      key: 'uncached',
      label: t('非缓存输入'),
      value: totals.uncached,
      color: parts.uncached,
    },
    {
      key: 'readIn',
      label: t('缓存读取'),
      value: totals.readIn,
      color: parts.readIn,
    },
    {
      key: 'writeIn',
      label: t('缓存创建'),
      value: totals.writeIn,
      color: parts.writeIn,
    },
    {
      key: 'output',
      label: t('输出'),
      value: totals.output,
      color: parts.output,
    },
  ];
  if (totals.legacy > 0) {
    partList.push({
      key: 'legacy',
      label: t('早期数据（未拆分）'),
      value: totals.legacy,
      color: parts.legacy,
    });
  }

  const quotaFmt = (v) => renderQuota(v, 2);
  const primaryTiles = [
    {
      key: 'quota',
      title: t('消耗额度'),
      value: renderQuota(totals.quota, 2),
      sub: `${t('平均每次')} ${totals.count > 0 ? renderQuota(totals.quota / totals.count, 4) : '-'}`,
      sparkline: series.map((r) => r.quota),
      accent: colors[0],
      sparkColor: colors[0],
    },
    {
      key: 'count',
      title: t('请求次数'),
      value: formatInt(totals.count),
      sub: `${t('平均 RPM')} ${formatRate(totals.count / rangeMinutes)}`,
      sparkline: series.map((r) => r.count),
      accent: colors[1],
      sparkColor: colors[1],
    },
    {
      key: 'total',
      title: t('总 Token'),
      value: formatTokens(totals.total),
      sub: `${t('平均 TPM')} ${formatRate(totals.total / rangeMinutes)}`,
      help: t(TOKEN_RULE_TEXT),
      sparkline: series.map((r) => r.total),
      accent: colors[6],
      sparkColor: colors[6],
    },
    {
      key: 'cacheRead',
      title: t('缓存命中率'),
      value: hit === null ? '-' : `${(hit * 100).toFixed(1)}%`,
      sub: `${t('缓存读取')} ${formatTokens(totals.cacheRead)}`,
      help: t('命中率 = 缓存读取 / 输入'),
      accent: parts.readIn,
    },
  ];
  const secondaryTiles = [
    {
      key: 'avg',
      title: t('平均每次 Token'),
      value: totals.count > 0 ? formatTokens(totals.total / totals.count) : '-',
      sub: `${t('涉及模型')} ${totals.modelCount}`,
    },
    {
      key: 'input',
      title: t('输入 Token'),
      value: formatTokens(totals.input),
      sub: `${t('含缓存')} · ${t('非缓存')} ${formatTokens(totals.uncached)}`,
      help: t('非缓存输入 + 缓存读取 + 缓存创建'),
    },
    {
      key: 'output',
      title: t('输出 Token'),
      value: formatTokens(totals.output),
      sub: `${t('占总量')} ${formatPercent(totals.output, totals.input + totals.output)}`,
    },
    {
      key: 'cacheWrite',
      title: t('缓存创建'),
      value: formatTokens(totals.cacheWrite),
      sub: `${t('占输入')} ${formatPercent(totals.writeIn, totals.input)}`,
    },
  ];

  const trendSpec = useMemo(() => {
    if (trendTab === 'count') {
      return singleLineSpec({
        rows: series,
        field: 'count',
        color: colors[1],
        format: formatInt,
      });
    }
    if (trendTab === 'total') {
      return singleLineSpec({
        rows: series,
        field: 'total',
        color: colors[6],
        format: formatTokens,
      });
    }
    return singleBarSpec({
      rows: series,
      field: 'quota',
      color: colors[0],
      format: quotaFmt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, trendTab, theme]);

  const tokenSpec = useMemo(() => {
    const keys = partList.map((p) => p.key);
    const labelOf = Object.fromEntries(partList.map((p) => [p.key, p.label]));
    const rows = [];
    series.forEach((r) => {
      keys.forEach((k) =>
        rows.push({ label: r.label, part: labelOf[k], value: r[k] }),
      );
    });
    return {
      type: 'bar',
      data: [{ id: 'tokens', values: rows }],
      xField: 'label',
      yField: 'value',
      seriesField: 'part',
      stack: true,
      barMaxWidth: 24,
      color: {
        type: 'ordinal',
        domain: partList.map((p) => p.label),
        range: partList.map((p) => p.color),
      },
      bar: { style: { stroke: surfaceColor(theme), lineWidth: 2 } },
      axes: quietAxes(formatTokens),
      legends: { visible: true, orient: 'top', position: 'start' },
      tooltip: {
        mark: {
          content: [
            { key: (d) => d.part, value: (d) => formatTokens(d.value) },
          ],
        },
        dimension: {
          content: [{ key: (d) => d.part, value: (d) => d.value }],
          updateContent: (items) => {
            const sum = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
            const out = items.map((i) => ({
              ...i,
              value: `${formatTokens(i.value)}  ${formatPercent(i.value, sum)}`,
            }));
            out.unshift({
              key: t('总 Token'),
              value: formatTokens(sum),
              hasShape: false,
            });
            return out;
          },
        },
      },
      background: 'transparent',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, theme, totals.legacy > 0]);

  const hasData = totals.count > 0 || totals.quota > 0;

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2.5'>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          {primaryTiles.map(({ key, sparkColor, ...tile }) => (
            <StatTile
              key={key}
              {...tile}
              loading={showSkeleton}
              sparkColor={sparkColor || colors[0]}
            />
          ))}
        </div>
        <div className='grid grid-cols-2 gap-2.5 xl:grid-cols-4'>
          {secondaryTiles.map(({ key, ...tile }) => (
            <StatTile
              key={key}
              {...tile}
              tone='subtle'
              loading={showSkeleton}
            />
          ))}
        </div>
      </div>

      <ChartCard
        title={t('用量趋势')}
        icon={<Activity size={16} />}
        dimmed={loading && loaded}
        extra={
          <SegmentedTabs
            value={trendTab}
            onChange={setTrendTab}
            options={[
              { value: 'quota', label: t('消耗额度') },
              { value: 'count', label: t('请求次数') },
              { value: 'total', label: t('总 Token') },
            ]}
          />
        }
      >
        <div className='h-72'>
          {hasData ? (
            <VChart spec={trendSpec} option={CHART_OPTION} />
          ) : (
            <ChartEmpty text={t('所选时间内没有用量')} />
          )}
        </div>
      </ChartCard>

      <ChartCard
        title={t('Token 构成')}
        icon={<Layers size={16} />}
        subtitle={`${t('总 Token')} ${formatTokens(totals.total)}（${formatInt(totals.total)}）`}
        dimmed={loading && loaded}
      >
        <div className='flex flex-col gap-4'>
          {totals.total > 0 ? (
            <CompositionBar
              parts={partList}
              total={totals.total}
              format={formatTokens}
              formatShare={formatPercent}
            />
          ) : null}
          {totals.legacy > 0 ? (
            <Banner
              type='info'
              closeIcon={null}
              description={t(
                '所选时间包含早期数据：当时没有记录输入 / 输出与缓存的拆分，只有总量，且 Claude 请求的总量不含缓存。这部分单独列为「早期数据（未拆分）」。',
              )}
            />
          ) : null}
          <div className='h-72'>
            {hasData ? (
              <VChart spec={tokenSpec} option={CHART_OPTION} />
            ) : (
              <ChartEmpty text={t('所选时间内没有用量')} />
            )}
          </div>
          <div className='text-xs text-semi-color-text-2'>
            <Coins size={12} className='mr-1 inline-block align-[-2px]' />
            {t(TOKEN_RULE_TEXT)}
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
