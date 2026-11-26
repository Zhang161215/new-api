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
import { Button } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { Wallet, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API, renderQuota } from '../../helpers';
import {
  buildBuckets,
  formatInt,
  formatTokens,
  summarize,
  timeSeries,
} from '../../helpers/dashboardStats';
import { ChartCard, ChartEmpty, StatTile } from './parts';
import { CHART_OPTION, quietAxes, seriesColors } from './vizTheme';

// 总览：账户状态 + 自己近 24 小时的用量（管理员这里看的也是自己的账户，全站数据在「用量」）
export default function OverviewTab({
  user,
  theme,
  onOpenUsage,
  aside,
  t,
  children,
}) {
  const navigate = useNavigate();
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range] = useState(() => {
    const end = Math.floor(Date.now() / 1000);
    return { start: end - 86400, end };
  });

  useEffect(() => {
    let alive = true;
    API.get(
      `/api/data/self?start_timestamp=${range.start}&end_timestamp=${range.end + 3600}`,
    )
      .then((res) => {
        if (alive && res.data?.success)
          setRecent(Array.isArray(res.data.data) ? res.data.data : []);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  const totals = useMemo(() => summarize(recent), [recent]);
  const series = useMemo(
    () =>
      timeSeries(recent, buildBuckets(range.start, range.end, 'hour'), 'hour'),
    [recent, range],
  );
  const trendSpec = useMemo(
    () => ({
      type: 'bar',
      data: [{ id: 'd', values: series }],
      xField: 'label',
      yField: 'quota',
      barMaxWidth: 16,
      bar: {
        style: { fill: seriesColors(theme)[0], cornerRadius: [3, 3, 0, 0] },
      },
      axes: quietAxes((v) => renderQuota(v, 2)),
      legends: { visible: false },
      tooltip: {
        mark: {
          content: [
            { key: (d) => d.label, value: (d) => renderQuota(d.quota, 4) },
          ],
        },
        dimension: {
          content: [
            { key: (d) => d.label, value: (d) => renderQuota(d.quota, 4) },
            { key: t('请求次数'), value: (d) => formatInt(d.count) },
            { key: t('总 Token'), value: (d) => formatTokens(d.total) },
          ],
        },
      },
      background: 'transparent',
    }),
    [series, theme, t],
  );
  const balance = Number(user?.quota) || 0;

  let runway = t('近 24 小时无用量');
  if (balance <= 0) runway = t('余额已用完');
  else if (totals.quota > 0) {
    const days = balance / totals.quota;
    runway =
      days < 1
        ? t('不足 1 天')
        : days > 999
          ? t('999 天以上')
          : t('约 {{n}} 天', { n: Math.floor(days) });
  }

  return (
    <div className='flex flex-col gap-4'>
      <div
        className={`grid grid-cols-1 gap-4 ${aside ? 'lg:grid-cols-4' : ''}`}
      >
        <ChartCard
          className={aside ? 'lg:col-span-3' : ''}
          title={t('账户概览')}
          icon={<Wallet size={16} />}
          extra={
            <Button
              theme='borderless'
              size='small'
              onClick={onOpenUsage}
              icon={<ArrowRight size={14} />}
              iconPosition='right'
            >
              {t('查看用量明细')}
            </Button>
          }
        >
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            <StatTile
              title={t('当前余额')}
              value={renderQuota(balance, 2)}
              sub={`${t('预计可用')} ${runway}`}
              help={t('按近 24 小时的消耗速度估算')}
              action={
                <Button
                  size='small'
                  theme='solid'
                  onClick={() => navigate('/console/topup')}
                >
                  {t('充值')}
                </Button>
              }
            />
            <StatTile
              title={t('近 24 小时消耗')}
              value={renderQuota(totals.quota, 2)}
              sub={`${formatInt(totals.count)} ${t('次请求')} · ${formatTokens(totals.total)} Token`}
              loading={loading}
            />
            <StatTile
              title={t('累计消耗')}
              value={renderQuota(user?.used_quota, 2)}
              sub={t('累计请求 {{n}} 次', {
                n: formatInt(user?.request_count),
              })}
            />
          </div>
          <div className='mt-4'>
            <div className='mb-1 text-xs text-semi-color-text-2'>
              {t('近 24 小时每小时消耗')}
            </div>
            <div className='h-52'>
              {totals.quota > 0 ? (
                <VChart spec={trendSpec} option={CHART_OPTION} />
              ) : (
                <ChartEmpty
                  text={loading ? t('加载中') : t('近 24 小时无用量')}
                />
              )}
            </div>
          </div>
        </ChartCard>
        {aside}
      </div>
      {children}
    </div>
  );
}
