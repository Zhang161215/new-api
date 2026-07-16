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
import { Tooltip } from '@douyinfe/semi-ui';

// 桶颜色状态：0=无数据 1=绿 2=黄 3=红（与后端 model/pricing_status.go 一致）
const BUCKET_COLORS = {
  0: 'var(--semi-color-fill-1)', // 灰
  1: '#22c55e', // 绿
  2: '#eab308', // 黄
  3: '#ef4444', // 红
};

const BUCKET_LABELS = {
  0: '无数据',
  1: '正常',
  2: '波动',
  3: '异常',
};

// 可用率文字颜色
const availabilityColor = (avail) => {
  if (avail >= 99) return '#16a34a';
  if (avail >= 90) return '#ca8a04';
  return '#dc2626';
};

const StatusBars = ({ buckets }) => {
  const arr = Array.isArray(buckets) && buckets.length > 0 ? buckets : new Array(24).fill(0);
  return (
    <div className='flex items-end gap-[1px]' style={{ height: 14 }}>
      {arr.map((v, i) => (
        <Tooltip key={i} content={BUCKET_LABELS[v] ?? '无数据'} position='top'>
          <div
            style={{
              width: 3,
              height: 14,
              borderRadius: 1,
              backgroundColor: BUCKET_COLORS[v] ?? BUCKET_COLORS[0],
            }}
          />
        </Tooltip>
      ))}
    </div>
  );
};

const ModelStatusRow = ({ status, t }) => {
  const tr = (s) => (typeof t === 'function' ? t(s) : s);

  // 无状态数据：显示占位，不影响卡片其余部分
  if (!status || !status.has_data) {
    return (
      <div className='pt-3 mt-1'>
        <div
          className='flex items-center text-xs'
          style={{ color: 'var(--semi-color-text-2)' }}
        >
          {tr('暂无数据')}
        </div>
      </div>
    );
  }

  const throughput = Number(status.throughput || 0);
  const latency = Number(status.latency || 0);
  const availability = Number(status.availability || 0);

  return (
    <div className='pt-3 mt-1'>
      <div className='flex items-center justify-between gap-2 text-xs'>
        {/* 吞吐 */}
        <div className='flex items-center gap-1' style={{ color: 'var(--semi-color-text-2)' }}>
          <span>{tr('吞吐')}</span>
          <span className='font-medium' style={{ color: 'var(--semi-color-text-0)' }}>
            {throughput.toFixed(1)}
          </span>
          <span>t/s</span>
        </div>

        {/* 延迟 */}
        <div className='flex items-center gap-1' style={{ color: 'var(--semi-color-text-2)' }}>
          <span>{tr('延迟')}</span>
          <span className='font-medium' style={{ color: 'var(--semi-color-text-0)' }}>
            {latency.toFixed(1)}
          </span>
          <span>s</span>
        </div>

        {/* 24 格在线率 */}
        <StatusBars buckets={status.buckets} />

        {/* 可用率 */}
        <div className='flex items-center gap-1'>
          <span className='font-semibold' style={{ color: availabilityColor(availability) }}>
            {availability.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default ModelStatusRow;
