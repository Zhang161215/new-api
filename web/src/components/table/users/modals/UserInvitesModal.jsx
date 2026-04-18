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
import {
  Avatar,
  Card,
  Empty,
  SideSheet,
  Space,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { Gift, ShieldAlert, UserPlus, Wallet } from 'lucide-react';
import { API, showError } from '../../../../helpers';
import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import CardTable from '../../../common/ui/CardTable';

const { Text } = Typography;

function formatTs(ts) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString();
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '-';
  const [name, domain] = email.split('@');
  if (name.length <= 2) return `${name[0] || '*'}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function renderRiskTag(tag, t) {
  const config = {
    same_ip: { color: 'red', label: t('同 IP') },
    no_real_payment: { color: 'grey', label: t('无真实付费') },
    no_active_subscription: { color: 'orange', label: t('无生效订阅') },
  }[tag] || { color: 'grey', label: tag };

  return (
    <Tag key={tag} color={config.color} shape='circle' size='small'>
      {config.label}
    </Tag>
  );
}

const UserInvitesModal = ({ visible, onCancel, user, t }) => {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ summary: {}, items: [] });

  const loadInvites = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await API.get(`/api/user/${user.id}/invites`);
      if (res.data?.success) {
        setData(res.data.data || { summary: {}, items: [] });
      } else {
        showError(res.data?.message || t('加载失败'));
      }
    } catch (error) {
      showError(t('请求失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    loadInvites();
  }, [visible, user?.id]);

  const columns = useMemo(
    () => [
      {
        title: t('用户'),
        dataIndex: 'username',
        width: 220,
        render: (text, record) => (
          <div className='flex flex-col'>
            <Text strong>{text || '-'}</Text>
            <Text type='tertiary' size='small'>
              {record.display_name || '-'} / ID: {record.id}
            </Text>
          </div>
        ),
      },
      {
        title: t('邮箱'),
        dataIndex: 'email',
        width: 180,
        render: (text) => maskEmail(text),
      },
      {
        title: t('注册信息'),
        dataIndex: 'register_time',
        width: 240,
        render: (text, record) => (
          <div className='flex flex-col'>
            <Text size='small'>{formatTs(text)}</Text>
            <Text type='tertiary' size='small'>
              IP: {record.register_ip || '-'}
            </Text>
          </div>
        ),
      },
      {
        title: t('真实付费'),
        dataIndex: 'order_stats',
        width: 180,
        render: (text) => {
          const isPaid = (text?.paid_order_count || 0) > 0;
          return (
            <div className='flex flex-col gap-1'>
              <Tag color={isPaid ? 'green' : 'grey'} shape='circle' size='small'>
                {isPaid ? t('已真实付费') : t('未真实付费')}
              </Tag>
              <Text type='tertiary' size='small'>
                {t('订单')}: {text?.paid_order_count || 0}
              </Text>
              <Text type='tertiary' size='small'>
                {t('金额')}: {Number(text?.paid_amount || 0).toFixed(2)}
              </Text>
            </div>
          );
        },
      },
      {
        title: t('订阅开通情况'),
        dataIndex: 'subscription_stats',
        width: 160,
        render: (text) => {
          const activeCount = text?.active_subscription_count || 0;
          return (
            <div className='flex flex-col gap-1'>
              <Tag color={activeCount > 0 ? 'green' : 'grey'} shape='circle' size='small'>
                {activeCount > 0 ? t('已开通') : t('未开通')}
              </Tag>
              <Text type='tertiary' size='small'>
                {t('总订阅')}: {text?.subscription_count || 0}
              </Text>
              <Text type='tertiary' size='small'>
                {t('生效订阅')}: {activeCount}
              </Text>
            </div>
          );
        },
      },
      {
        title: t('风险标签'),
        dataIndex: 'risk_tags',
        width: 260,
        render: (tags) => (
          <Space wrap spacing={4}>
            {(tags || []).length > 0
              ? tags.map((tag) => renderRiskTag(tag, t))
              : <Tag color='green' shape='circle' size='small'>{t('正常')}</Tag>}
          </Space>
        ),
      },
    ],
    [t],
  );

  const summary = data?.summary || {};

  return (
    <SideSheet
      placement='right'
      title={
        <Space>
          <Tag color='violet' shape='circle'>
            {t('邀请明细')}
          </Tag>
          <Typography.Title heading={4} className='m-0'>
            {user?.username || '-'} {t('的邀请数据')}
          </Typography.Title>
        </Space>
      }
      bodyStyle={{ padding: 0 }}
      visible={visible}
      width={isMobile ? '100%' : 'min(1360px, calc(100vw - 32px))'}
      footer={null}
      closeIcon={null}
      onCancel={onCancel}
    >
      <div className='p-4 flex flex-col gap-4 min-w-0'>
        <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4'>
          <Card className='!rounded-2xl shadow-sm border-0'>
            <div className='flex items-center gap-3'>
              <Avatar color='blue'><UserPlus size={16} /></Avatar>
              <div>
                <Text type='tertiary'>{t('邀请总数')}</Text>
                <div className='text-xl font-bold'>{summary.invited_total || 0}</div>
              </div>
            </div>
          </Card>
          <Card className='!rounded-2xl shadow-sm border-0'>
            <div className='flex items-center gap-3'>
              <Avatar color='green'><Wallet size={16} /></Avatar>
              <div>
                <Text type='tertiary'>{t('已付费人数')}</Text>
                <div className='text-xl font-bold'>{summary.paid_total || 0}</div>
              </div>
            </div>
          </Card>
          <Card className='!rounded-2xl shadow-sm border-0'>
            <div className='flex items-center gap-3'>
              <Avatar color='grey'><Gift size={16} /></Avatar>
              <div>
                <Text type='tertiary'>{t('未付费人数')}</Text>
                <div className='text-xl font-bold'>{summary.unpaid_total || 0}</div>
              </div>
            </div>
          </Card>
          <Card className='!rounded-2xl shadow-sm border-0'>
            <div className='flex items-center gap-3'>
              <Avatar color='orange'><Gift size={16} /></Avatar>
              <div>
                <Text type='tertiary'>{t('累计付费金额')}</Text>
                <div className='text-xl font-bold'>
                  {(summary.paid_amount_total || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </Card>
          <Card className='!rounded-2xl shadow-sm border-0'>
            <div className='flex items-center gap-3'>
              <Avatar color='red'><ShieldAlert size={16} /></Avatar>
              <div>
                <Text type='tertiary'>{t('可疑人数')}</Text>
                <div className='text-xl font-bold'>{summary.suspicious_total || 0}</div>
              </div>
            </div>
          </Card>
        </div>

        <Card className='!rounded-2xl shadow-sm border-0 min-w-0'>
          <div className='flex items-center justify-between mb-4'>
            <div>
              <Typography.Text className='text-lg font-medium'>
                {t('被邀请用户列表')}
              </Typography.Text>
              <div className='text-xs text-gray-500'>
                {t('查看注册 IP、付费情况和订阅状态')}
              </div>
            </div>
          </div>

          <div className='w-full min-w-0 overflow-x-auto'>
            <CardTable
              columns={columns}
              dataSource={data?.items || []}
              rowKey={(row) => row.id}
              loading={loading}
              pagination={false}
              hidePagination={true}
              scroll={{ x: 1240 }}
              tableStyle={{ minWidth: 1120, width: '100%' }}
              empty={
                <Empty
                  image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
                  darkModeImage={<IllustrationNoResultDark style={{ width: 150, height: 150 }} />}
                  description={t('暂无邀请记录')}
                  style={{ padding: 30 }}
                />
              }
              size='middle'
            />
          </div>
        </Card>
      </div>
    </SideSheet>
  );
};

export default UserInvitesModal;
