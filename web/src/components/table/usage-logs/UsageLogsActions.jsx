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
import { Tag, Space, Skeleton, Tooltip } from '@douyinfe/semi-ui';
import { renderQuota } from '../../../helpers';
import CompactModeToggle from '../../common/ui/CompactModeToggle';
import { useMinimumLoadingTime } from '../../../hooks/common/useMinimumLoadingTime';

const LogsActions = ({
  stat,
  loadingStat,
  showStat,
  compactMode,
  setCompactMode,
  t,
}) => {
  const showSkeleton = useMinimumLoadingTime(loadingStat);
  const needSkeleton = !showStat || showSkeleton;

  // 2026-04-04 之前的日志没写 billing_source，归不到订阅也归不到钱包。
  // 用总额减去两者得到这部分，只在 >0 时才渲染 —— 近期区间看不到它，
  // 查很老的数据时它才出现，用来解释「订阅+钱包 < 总消耗」的差额。
  const subQuota = Number(stat.subscription_quota || 0);
  const walletQuota = Number(stat.wallet_quota || 0);
  const untagged = Math.max(0, Number(stat.quota || 0) - subQuota - walletQuota);

  const tagStyle = {
    fontWeight: 500,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    padding: 13,
  };

  const placeholder = (
    <Space>
      <Skeleton.Title style={{ width: 108, height: 21, borderRadius: 6 }} />
      <Skeleton.Title style={{ width: 100, height: 21, borderRadius: 6 }} />
      <Skeleton.Title style={{ width: 100, height: 21, borderRadius: 6 }} />
      <Skeleton.Title style={{ width: 65, height: 21, borderRadius: 6 }} />
      <Skeleton.Title style={{ width: 64, height: 21, borderRadius: 6 }} />
    </Space>
  );

  return (
    <div className='flex flex-col md:flex-row justify-between items-start md:items-center gap-2 w-full'>
      <Skeleton loading={needSkeleton} active placeholder={placeholder}>
        {/* 标签会换行：拆成订阅/钱包后一行放不下窄屏 */}
        <Space wrap>
          <Tag color='blue' style={tagStyle} className='!rounded-lg'>
            {t('消耗额度')}: {renderQuota(stat.quota)}
          </Tag>
          <Tag color='violet' style={tagStyle} className='!rounded-lg'>
            {t('订阅额度')}: {renderQuota(subQuota)}
          </Tag>
          <Tag color='cyan' style={tagStyle} className='!rounded-lg'>
            {t('钱包额度')}: {renderQuota(walletQuota)}
          </Tag>
          {untagged > 0 && (
            <Tooltip
              content={t('这部分日志产生于订阅计费上线前，未记录计费来源')}
              position='top'
            >
              <Tag color='grey' style={tagStyle} className='!rounded-lg'>
                {t('未标记')}: {renderQuota(untagged)}
              </Tag>
            </Tooltip>
          )}
          <Tag color='pink' style={tagStyle} className='!rounded-lg'>
            RPM: {stat.rpm}
          </Tag>
          <Tag
            color='white'
            style={{ ...tagStyle, border: 'none' }}
            className='!rounded-lg'
          >
            TPM: {stat.tpm}
          </Tag>
        </Space>
      </Skeleton>

      <CompactModeToggle
        compactMode={compactMode}
        setCompactMode={setCompactMode}
        t={t}
      />
    </div>
  );
};

export default LogsActions;
