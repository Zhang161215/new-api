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

// 每小时可用率% -> 竖条颜色 + 高度（-1 表示无数据）
const barStyle = (avail) => {
  if (avail < 0) return { color: 'var(--semi-color-fill-2)', height: '30%' };
  if (avail >= 99.9) return { color: 'rgb(16, 185, 129)', height: '100%' }; // emerald-500
  if (avail >= 99) return { color: 'rgb(52, 211, 153)', height: '85%' }; // emerald-400
  if (avail >= 95) return { color: 'rgb(251, 191, 36)', height: '70%' }; // amber-400
  if (avail >= 90) return { color: 'rgb(245, 158, 11)', height: '60%' }; // amber-500
  return { color: 'rgb(244, 63, 94)', height: '50%' }; // rose-500
};

// 整体可用率 -> 百分比文字颜色
const availColor = (avail) => {
  if (avail >= 99) return 'rgb(5, 150, 105)'; // emerald-600
  if (avail >= 90) return 'rgb(217, 119, 6)'; // amber-600
  return 'rgb(225, 29, 72)'; // rose-600
};

// 两位补零
const pad = (n) => String(n).padStart(2, '0');

const ModelStatusRow = ({ status, t }) => {
  const tr = (s) => (typeof t === 'function' ? t(s) : s);

  if (!status || !status.has_data) return null;

  const throughput = Number(status.throughput || 0);
  const latency = Number(status.latency || 0);
  const availability = Number(status.availability || 0);
  const buckets =
    Array.isArray(status.buckets) && status.buckets.length > 0
      ? status.buckets
      : new Array(24).fill(-1);
  const n = buckets.length;

  // 最近一个桶的整点时间（展示用）
  const now = new Date();
  const latestLabel = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )} ${pad(now.getHours())}:00`;

  return (
    <div className='flex items-center gap-3 text-xs shrink-0'>
      {/* 吞吐 */}
      <span className='inline-flex items-baseline gap-1'>
        <span style={{ color: 'var(--semi-color-text-2)' }}>{tr('吞吐')}</span>
        <span
          className='font-mono tabular-nums'
          style={{ color: 'var(--semi-color-text-0)' }}
        >
          {throughput.toFixed(1)} t/s
        </span>
      </span>

      {/* 延迟 */}
      <span className='inline-flex items-baseline gap-1'>
        <span style={{ color: 'var(--semi-color-text-2)' }}>{tr('延迟')}</span>
        <span
          className='font-mono tabular-nums'
          style={{ color: 'var(--semi-color-text-0)' }}
        >
          {latency.toFixed(2)}s
        </span>
      </span>

      {/* 24 格迷你在线率 + 可用率 */}
      <div className='relative'>
        <span
          className='absolute bottom-full left-0 mb-0.5 whitespace-nowrap text-[10px] leading-none'
          style={{ color: 'var(--semi-color-text-3)' }}
        >
          {latestLabel}
        </span>
        <div className='flex items-center gap-2'>
          <div className='flex items-end gap-[2px] h-4'>
            {buckets.map((avail, i) => {
              const { color, height } = barStyle(avail);
              const hoursAgo = n - 1 - i;
              const when =
                hoursAgo === 0 ? tr('当前小时') : `${hoursAgo}h ${tr('前')}`;
              const title =
                avail < 0
                  ? `${when} · ${tr('无数据')}`
                  : `${when} · ${avail.toFixed(2)}%`;
              return (
                <span
                  key={i}
                  className='flex shrink-0 items-end w-1 h-full'
                  title={title}
                >
                  <span
                    className='block w-full rounded-sm'
                    style={{ backgroundColor: color, height }}
                  />
                </span>
              );
            })}
          </div>
          <span
            className='font-mono font-semibold text-xs tabular-nums'
            style={{ color: availColor(availability) }}
          >
            {availability.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default ModelStatusRow;
