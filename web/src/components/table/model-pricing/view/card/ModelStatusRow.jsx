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

const MISSING = 'rgba(156, 163, 175, 0.35)';

export const barColor = (avail) => {
  if (!Number.isFinite(avail) || avail < 0) return MISSING;
  if (avail >= 99.9) return '#10b981';
  if (avail >= 90) return '#34d399';
  if (avail >= 70) return '#f59e0b';
  return '#ef4444';
};

export const successTextColor = (rate) => {
  if (!Number.isFinite(rate)) return 'var(--semi-color-text-2)';
  if (rate >= 99.9) return '#059669';
  if (rate >= 90) return '#10b981';
  if (rate >= 70) return '#d97706';
  return '#dc2626';
};

export const formatLatency = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const ms = seconds * 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

export const formatThroughput = (tps) => {
  if (!Number.isFinite(tps) || tps <= 0) return '—';
  if (tps >= 1000) return `${(tps / 1000).toFixed(1)}K t/s`;
  return `${tps.toFixed(tps < 10 ? 2 : 1)} t/s`;
};

const labelStyle = {
  color: 'var(--semi-color-text-2)',
  fontSize: 11,
  lineHeight: '16px',
};

const ModelStatusRow = ({ status, t, children, showTtft = false }) => {
  const tr = (s) => (typeof t === 'function' ? t(s) : s);
  const hasData = Boolean(status?.has_data);
  const throughput = Number(status?.throughput || 0);
  const latency = Number(status?.latency || 0);
  const ttft = Number(status?.ttft || 0);
  const availability = Number(status?.availability || 0);
  const buckets =
    Array.isArray(status?.buckets) && status.buckets.length > 0
      ? status.buckets
      : new Array(24).fill(-1);
  const latencyText = formatLatency(latency);
  const ttftText = formatLatency(ttft);
  const throughputText = formatThroughput(throughput).replace(' t/s', 't/s');

  return (
    <div
      aria-label={tr('最近 24 小时性能')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        width: '100%',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 20,
          minWidth: 0,
        }}
      >
        <div style={{ width: 96, flex: '0 0 96px' }}>
          <div
            style={{
              ...labelStyle,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{tr('状态')}</span>
            <span
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
            >
              {hasData ? `${availability.toFixed(2)}%` : '—'}
            </span>
          </div>
          <div
            role='img'
            aria-label={tr('最近成功率；灰色竖条表示该小时没有请求')}
            title={tr('最近成功率；灰色竖条表示该小时没有请求')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              height: 12,
              marginTop: 4,
              width: 96,
            }}
          >
            {buckets.map((avail, i) => {
              const value = Number(avail);
              const hoursAgo = buckets.length - 1 - i;
              const when =
                hoursAgo === 0 ? tr('当前小时') : `${hoursAgo}h ${tr('前')}`;
              const title =
                value < 0
                  ? `${when} · ${tr('无数据')}`
                  : `${when} · ${value.toFixed(2)}%`;
              return (
                <span
                  key={i}
                  title={title}
                  style={{
                    display: 'block',
                    width: 3,
                    height: 12,
                    flex: '0 0 3px',
                    borderRadius: 1,
                    backgroundColor: barColor(value),
                  }}
                />
              );
            })}
          </div>
        </div>
        {showTtft && (
          <div
            style={{ flex: '0 0 auto' }}
            title={tr('首字延迟（流式请求首个 token）')}
          >
            <div style={labelStyle}>{tr('首字')}</div>
            <div
              style={{
                marginTop: 4,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                whiteSpace: 'nowrap',
              }}
            >
              {ttftText === '—' ? '—s' : ttftText}
            </div>
          </div>
        )}
        <div style={{ flex: '0 0 auto' }} title={tr('平均延迟')}>
          <div style={labelStyle}>{tr('延迟')}</div>
          <div
            style={{
              marginTop: 4,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              whiteSpace: 'nowrap',
            }}
          >
            {latencyText === '—' ? '—s' : latencyText}
          </div>
        </div>
        <div style={{ flex: '0 0 auto' }} title={tr('吞吐')}>
          <div style={labelStyle}>{tr('吞吐')}</div>
          <div
            style={{
              marginTop: 4,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              whiteSpace: 'nowrap',
            }}
          >
            {throughputText === '—' ? '—t/s' : throughputText}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
};

export default ModelStatusRow;
