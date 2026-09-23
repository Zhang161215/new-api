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

import React, { useMemo } from 'react';
import { VChart } from '@visactor/react-vchart';
import { AlertTriangle, HeartPulse, Timer, Zap } from 'lucide-react';
import {
  formatLatency,
  formatThroughput,
} from '../../view/card/ModelStatusRow';
import { groupColor } from '../../squareUtils';

// 结构与样式对齐上游 model-details-performance.tsx / model-details-charts.tsx

const CHART_OPTION = { fallbacks: true };

// 上游 getSuccessRateLevel：100 满绿，>=90 浅绿，>=70 琥珀，其余红
const levelColor = (rate) => {
  if (!Number.isFinite(rate)) return '#9ca3af';
  if (rate >= 100) return '#10b981';
  if (rate >= 90) return '#34d399';
  if (rate >= 70) return '#f59e0b';
  return '#ef4444';
};

const levelTextColor = (rate) => {
  if (!Number.isFinite(rate)) return 'var(--semi-color-text-2)';
  if (rate >= 100) return '#059669';
  if (rate >= 90) return '#10b981';
  if (rate >= 70) return '#d97706';
  return '#dc2626';
};

const formatPct = (rate) =>
  Number.isFinite(rate) ? `${Number(rate).toFixed(2)}%` : '—';

const isDark = () =>
  typeof document !== 'undefined' &&
  (document.documentElement.classList.contains('dark') ||
    document.body.getAttribute('theme-mode') === 'dark');

const chartTokens = () =>
  isDark()
    ? { text: 'rgba(255, 255, 255, 0.68)', grid: 'rgba(255, 255, 255, 0.12)' }
    : { text: 'rgba(15, 23, 42, 0.58)', grid: 'rgba(15, 23, 42, 0.12)' };

// 与后端 24 格对齐：最后一格是当前小时
const hourLabels = (count) => {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getTime() - (count - 1 - i) * 3600 * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  });
};

// 只保留有请求的小时
const dataPoints = (buckets) => {
  const labels = hourLabels(buckets.length);
  return buckets
    .map((value, i) => ({ label: labels[i], value: Number(value) }))
    .filter((point) => Number.isFinite(point.value) && point.value >= 0);
};

const SectionHeader = ({ icon: Icon, title, description, accent }) => (
  <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
    <div className='flex min-w-0 items-center gap-2'>
      <Icon
        size={14}
        style={{
          flexShrink: 0,
          color: 'var(--semi-color-text-2)',
          opacity: 0.8,
        }}
      />
      <div className='min-w-0'>
        <div
          className='text-sm font-semibold'
          style={{ color: 'var(--semi-color-text-0)' }}
        >
          {title}
        </div>
        {description && (
          <p className='text-xs' style={{ color: 'var(--semi-color-text-2)' }}>
            {description}
          </p>
        )}
      </div>
    </div>
    {accent && <div className='shrink-0 text-xs font-medium'>{accent}</div>}
  </div>
);

const StatCard = ({ icon: Icon, label, value, hint, color }) => (
  <div
    className='flex flex-col gap-1 rounded-lg border p-3'
    style={{
      borderColor: 'var(--semi-color-border)',
      background: 'var(--semi-color-bg-0)',
    }}
  >
    <span
      className='inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider'
      style={{ color: 'var(--semi-color-text-2)' }}
    >
      <Icon size={12} />
      {label}
    </span>
    <span
      className='font-mono text-lg font-semibold tabular-nums'
      style={{ color: color || 'var(--semi-color-text-0)' }}
    >
      {value}
    </span>
    {hint && (
      <span
        className='text-[11px]'
        style={{ color: 'var(--semi-color-text-2)', opacity: 0.8 }}
      >
        {hint}
      </span>
    )}
  </div>
);

// 上游 UptimeSparkline（sm）：只画有数据的小时，越差越矮
const heightFor = (rate) => {
  if (rate >= 99.9) return '100%';
  if (rate >= 99) return '88%';
  if (rate >= 95) return '72%';
  if (rate >= 90) return '55%';
  return '40%';
};

const UptimeSparkline = ({ buckets, overall }) => {
  const points = dataPoints(buckets || []);
  if (points.length === 0) {
    return (
      <span className='text-xs' style={{ color: 'var(--semi-color-text-2)' }}>
        —
      </span>
    );
  }
  return (
    <div className='flex items-center gap-2'>
      <div className='flex h-3.5 items-end gap-px' role='img'>
        {points.map((point) => (
          <div
            key={point.label}
            className='flex h-3.5 w-[3px] items-end'
            title={`${point.label} · ${formatPct(point.value)}`}
          >
            <div
              className='w-full rounded-sm'
              style={{
                height: heightFor(point.value),
                backgroundColor: levelColor(point.value),
              }}
            />
          </div>
        ))}
      </div>
      <span
        className='font-mono text-sm font-semibold tabular-nums'
        style={{ color: levelTextColor(overall) }}
      >
        {formatPct(overall)}
      </span>
    </div>
  );
};

const EmptyChart = ({ text }) => (
  <div
    className='flex h-48 items-center justify-center rounded-lg border text-xs'
    style={{
      color: 'var(--semi-color-text-2)',
      borderColor: 'var(--semi-color-border)',
    }}
  >
    {text}
  </div>
);

// 上游 LatencyTrendChart：平均首 Token 延迟（ms），平滑折线 + 圆点
const LatencyTrendChart = ({ hours, t }) => {
  const labels = hourLabels(hours.length);
  const values = hours
    .map((point, i) => ({
      time: labels[i],
      ttft: Math.round(Number(point?.ttft) * 1000),
    }))
    .filter(
      (point, i) => Number(hours[i]?.availability) >= 0 && point.ttft > 0,
    );
  const spec = useMemo(() => {
    const { text, grid } = chartTokens();
    return {
      type: 'line',
      data: [{ id: 'latency', values }],
      xField: 'time',
      yField: 'ttft',
      smooth: true,
      color: ['#3b82f6'],
      point: {
        visible: true,
        style: { size: 5, stroke: '#ffffff', lineWidth: 1.5 },
      },
      line: { style: { lineWidth: 2 } },
      legends: { visible: false },
      tooltip: {
        mark: {
          title: { value: (d) => d?.time },
          content: [
            {
              key: t('平均首 Token 延迟'),
              value: (d) => `${Math.round(d?.ttft)} ms`,
            },
          ],
        },
      },
      axes: [
        {
          orient: 'bottom',
          label: { style: { fill: text, fontSize: 10 } },
          tick: { visible: false },
        },
        {
          orient: 'left',
          label: {
            formatMethod: (val) => `${val} ms`,
            style: { fill: text, fontSize: 10 },
          },
          grid: { visible: true, style: { lineDash: [3, 3], stroke: grid } },
        },
      ],
      background: 'transparent',
    };
  }, [values, t]);
  if (values.length === 0) return <EmptyChart text={t('暂无延迟数据')} />;
  return (
    <div className='h-64 sm:h-72'>
      <VChart spec={spec} option={CHART_OPTION} />
    </div>
  );
};

// 上游 getUptimeAxisMin：都在 95 以上就从 95 起，否则 90，再差就按 10 取整
const uptimeAxisMin = (values) => {
  if (values.length === 0) return 95;
  const min = Math.max(0, Math.min(...values));
  if (min >= 95) return 95;
  if (min >= 90) return 90;
  return Math.max(0, Math.floor((min - 5) / 10) * 10);
};

// 上游 UptimeTrendChart：每小时成功率点线图，点按等级着色
const UptimeTrendChart = ({ buckets, t }) => {
  const points = dataPoints(buckets);
  const spec = useMemo(() => {
    const { text, grid } = chartTokens();
    const raw = points.map((point) => ({
      date: point.label,
      uptime: Math.min(100, Math.max(0, point.value)),
      incidents: point.value < 100 ? 1 : 0,
    }));
    // 只有一个点时复制一份，避免折线图只画出孤点
    const values =
      raw.length === 1
        ? [
            { ...raw[0], date: `${raw[0].date}__start` },
            { ...raw[0], date: `${raw[0].date}__end` },
          ]
        : raw;
    const strip = (value) => String(value).replace(/__(start|end)$/, '');
    return {
      type: 'line',
      data: [{ id: 'uptime', values }],
      xField: 'date',
      yField: 'uptime',
      smooth: true,
      line: { style: { stroke: '#10b981', lineWidth: 2 } },
      point: {
        visible: true,
        style: {
          size: 5,
          stroke: '#ffffff',
          lineWidth: 1.5,
          fill: (datum) => levelColor(datum?.uptime),
        },
      },
      tooltip: {
        mark: {
          title: { value: (d) => strip(d?.date) },
          content: [
            {
              key: t('可用率'),
              value: (d) => `${Number(d?.uptime).toFixed(2)}%`,
            },
            { key: t('事件'), value: (d) => `${d?.incidents}` },
          ],
        },
      },
      axes: [
        {
          orient: 'bottom',
          label: {
            formatMethod: (val) => strip(val),
            style: { fill: text, fontSize: 10 },
            autoLimit: true,
          },
          tick: { visible: false },
        },
        {
          orient: 'left',
          min: uptimeAxisMin(raw.map((point) => point.uptime)),
          max: 100,
          label: {
            formatMethod: (val) => `${val}%`,
            style: { fill: text, fontSize: 10 },
          },
          grid: { visible: true, style: { lineDash: [3, 3], stroke: grid } },
        },
      ],
      background: 'transparent',
    };
  }, [points, t]);
  if (points.length === 0) return <EmptyChart text={t('暂无可用率数据')} />;
  return (
    <div className='h-56 sm:h-64'>
      <VChart spec={spec} option={CHART_OPTION} />
    </div>
  );
};

const ModelPerformancePanel = ({ modelData, t }) => {
  const status = modelData?.status;
  if (!status?.has_data) {
    return (
      <div
        className='rounded-lg border p-6 text-center text-sm'
        style={{
          color: 'var(--semi-color-text-2)',
          borderColor: 'var(--semi-color-border)',
        }}
      >
        {t('该模型最近 24 小时没有请求，暂无性能数据。')}
      </div>
    );
  }

  const buckets = Array.isArray(status.buckets) ? status.buckets : [];
  const hours = Array.isArray(status.hours) ? status.hours : [];
  const groups = Array.isArray(status.groups) ? status.groups : [];
  const incidentCount = dataPoints(buckets).filter(
    (point) => point.value < 100,
  ).length;
  const availability = Number(status.availability);

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <StatCard
          icon={Timer}
          label='TPS'
          value={formatThroughput(Number(status.throughput))}
          hint={t('持续每秒 Token 数')}
        />
        <StatCard
          icon={Zap}
          label={t('首字延迟')}
          value={formatLatency(Number(status.ttft))}
          hint={t('流式请求首个 Token')}
        />
        <StatCard
          icon={Timer}
          label={t('平均延迟')}
          value={formatLatency(Number(status.latency))}
        />
        <StatCard
          icon={HeartPulse}
          label={t('成功率')}
          value={formatPct(availability)}
          color={levelTextColor(availability)}
          hint={
            incidentCount > 0
              ? t('最近 24 小时 {{count}} 个异常桶', { count: incidentCount })
              : t('最近 24 小时无异常')
          }
        />
      </div>

      <section>
        <SectionHeader
          icon={HeartPulse}
          title={t('各分组性能')}
          description={t('平均延迟、TTFT、TPS 和成功率')}
        />
        {groups.length === 0 ? (
          <EmptyChart text={t('当前还没有按分组拆开的性能数据。')} />
        ) : (
          <div
            className='overflow-auto rounded-lg border'
            style={{ borderColor: 'var(--semi-color-border)' }}
          >
            <table className='w-full text-left text-sm'>
              <thead>
                <tr
                  className='whitespace-nowrap'
                  style={{ color: 'var(--semi-color-text-2)' }}
                >
                  <th className='px-3 py-2.5 font-medium'>{t('分组')}</th>
                  <th className='px-3 py-2.5 text-right font-medium'>TPS</th>
                  <th className='px-3 py-2.5 text-right font-medium'>
                    {t('平均首 Token 延迟')}
                  </th>
                  <th className='px-3 py-2.5 text-right font-medium'>
                    {t('平均延迟')}
                  </th>
                  <th className='min-w-[180px] px-3 py-2.5 font-medium'>
                    {t('成功率')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr
                    key={group.group || 'empty'}
                    className='pricing-perf-row'
                    style={{ borderTop: '1px solid var(--semi-color-border)' }}
                  >
                    <td
                      className='px-3 py-3'
                      style={{
                        color: groupColor(group.group),
                        fontWeight: 500,
                      }}
                    >
                      {group.group || t('未分组')}
                    </td>
                    <td className='px-3 py-3 text-right font-mono tabular-nums'>
                      {formatThroughput(Number(group.throughput))}
                    </td>
                    <td className='px-3 py-3 text-right font-mono tabular-nums'>
                      {formatLatency(Number(group.ttft))}
                    </td>
                    <td
                      className='px-3 py-3 text-right font-mono tabular-nums'
                      style={{ color: 'var(--semi-color-text-2)' }}
                    >
                      {formatLatency(Number(group.latency))}
                    </td>
                    <td className='px-3 py-3'>
                      <UptimeSparkline
                        buckets={group.buckets}
                        overall={Number(group.availability)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          icon={Timer}
          title={t('延迟趋势（最近 24 小时）')}
          description={t('平均首 Token 延迟')}
        />
        <LatencyTrendChart hours={hours} t={t} />
      </section>

      <section>
        <SectionHeader
          icon={HeartPulse}
          title={t('可用率（最近 24 小时）')}
          description={t('成功率排除业务拒绝，统计包含当前尚未结束的小时。')}
          accent={
            incidentCount > 0 ? (
              <span
                className='inline-flex items-center gap-1'
                style={{ color: '#d97706' }}
              >
                <AlertTriangle size={14} />
                {t('{{count}} 起事件', { count: incidentCount })}
              </span>
            ) : null
          }
        />
        <UptimeTrendChart buckets={buckets} t={t} />
      </section>
    </div>
  );
};

export default ModelPerformancePanel;
