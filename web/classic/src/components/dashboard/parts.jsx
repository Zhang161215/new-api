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

import React from 'react';
import { Card, Radio, RadioGroup, Skeleton, Tooltip } from '@douyinfe/semi-ui';
import { IconHelpCircle } from '@douyinfe/semi-icons';

// 卡片：标题 + 副标题 + 右侧操作；刷新时保留旧内容半透明，不闪骨架屏
export function ChartCard({
  title,
  icon,
  subtitle,
  extra,
  children,
  dimmed,
  className = '',
  bodyClassName = 'p-3',
}) {
  return (
    <Card
      shadows=''
      bordered
      headerLine
      className={`!rounded-2xl ${className}`}
      bodyStyle={{ padding: 0 }}
      title={
        <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between w-full'>
          <div className='flex items-center gap-2 min-w-0'>
            {icon}
            <span className='font-semibold'>{title}</span>
            {subtitle ? (
              <span className='text-xs text-semi-color-text-2 truncate'>
                {subtitle}
              </span>
            ) : null}
          </div>
          {extra ? (
            <div className='flex items-center gap-2 flex-wrap'>{extra}</div>
          ) : null}
        </div>
      }
    >
      <div
        className={`${bodyClassName} transition-opacity ${dimmed ? 'opacity-60' : ''}`}
      >
        {children}
      </div>
    </Card>
  );
}

export function SegmentedTabs({ value, onChange, options }) {
  return (
    <RadioGroup
      type='button'
      buttonSize='small'
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <Radio key={o.value} value={o.value}>
          {o.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}

// 迷你趋势线：只表达走势，数值看主数字和下方图表
export function Sparkline({ values, color, width = 96, height = 32 }) {
  const list = (values || []).map((v) => (Number.isFinite(v) ? v : 0));
  if (list.length < 2 || list.every((v) => v === 0)) return null;
  const max = Math.max(...list);
  const min = Math.min(...list);
  const span = max - min || 1;
  const step = width / (list.length - 1);
  const points = list
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden='true'
      className='shrink-0'
    >
      <polyline
        points={points}
        fill='none'
        stroke={color}
        strokeWidth='2'
        strokeLinejoin='round'
        strokeLinecap='round'
      />
    </svg>
  );
}

export function StatTile({
  title,
  value,
  sub,
  help,
  loading,
  sparkline,
  sparkColor,
  action,
}) {
  return (
    <div className='rounded-xl border border-semi-color-border bg-semi-color-bg-0 px-4 py-3 min-w-0'>
      <div className='flex items-center gap-1 text-xs text-semi-color-text-2'>
        <span className='truncate'>{title}</span>
        {help ? (
          <Tooltip content={help}>
            <IconHelpCircle
              size='small'
              className='cursor-help text-semi-color-text-3'
            />
          </Tooltip>
        ) : null}
      </div>
      <div className='mt-1 flex items-end justify-between gap-2'>
        <div className='min-w-0'>
          {loading ? (
            <Skeleton.Paragraph
              rows={1}
              style={{ width: 96, height: 28, marginTop: 4 }}
              active
            />
          ) : (
            <div
              className='text-2xl font-semibold text-semi-color-text-0 truncate'
              title={typeof value === 'string' ? value : undefined}
            >
              {value}
            </div>
          )}
          {sub ? (
            <div className='mt-0.5 text-xs text-semi-color-text-2 truncate'>
              {sub}
            </div>
          ) : null}
        </div>
        {action ||
          (sparkline ? (
            <Sparkline values={sparkline} color={sparkColor} />
          ) : null)}
      </div>
    </div>
  );
}

// 比例条：各段之间留 2px 缝，图例写名称 + 数值 + 占比（颜色只做身份提示，数字都写出来）
export function CompositionBar({ parts, total, format, formatShare }) {
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className='flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-semi-color-fill-0'>
        {visible.map((p) => (
          <Tooltip
            key={p.key}
            content={`${p.label}：${format(p.value)}（${formatShare(p.value, total)}）`}
          >
            <div
              style={{
                width: `${(p.value / total) * 100}%`,
                background: p.color,
                minWidth: 2,
              }}
              className='h-full first:rounded-l-full last:rounded-r-full'
            />
          </Tooltip>
        ))}
      </div>
      <div className='mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3 xl:grid-cols-5'>
        {parts.map((p) => (
          <div key={p.key} className='flex items-start gap-2 min-w-0'>
            <span
              className='mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm'
              style={{ background: p.color }}
            />
            <div className='min-w-0'>
              <div className='text-xs text-semi-color-text-2 truncate'>
                {p.label}
              </div>
              <div className='text-sm font-medium text-semi-color-text-0'>
                {format(p.value)}
                <span className='ml-1 text-xs font-normal text-semi-color-text-2'>
                  {formatShare(p.value, total)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartEmpty({ text }) {
  return (
    <div className='flex h-full items-center justify-center text-sm text-semi-color-text-2'>
      {text}
    </div>
  );
}

// 明细表数值列：右对齐、不换行、可排序；share 给出时在数值后面跟占比
export function numberColumn({
  title,
  dataIndex,
  format,
  width = 136,
  share,
  defaultSortOrder,
}) {
  return {
    title: <span className='whitespace-nowrap'>{title}</span>,
    dataIndex,
    width,
    align: 'right',
    defaultSortOrder,
    sorter: (a, b) => (a[dataIndex] ?? -1) - (b[dataIndex] ?? -1),
    render: (v) => (
      <span className='whitespace-nowrap tabular-nums'>
        {format(v)}
        {share ? (
          <span className='ml-1 text-xs text-semi-color-text-2'>
            {share(v)}
          </span>
        ) : null}
      </span>
    ),
  };
}
