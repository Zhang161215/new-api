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
  Button,
  DatePicker,
  Empty,
  Modal,
  Select,
  SideSheet,
  Space,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconPlusCircle } from '@douyinfe/semi-icons';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { API, showError, showSuccess } from '../../../../helpers';
import { convertUSDToCurrency } from '../../../../helpers/render';
import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import CardTable from '../../../common/ui/CardTable';

const { Text } = Typography;

function formatTs(ts) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString();
}

function renderStatusTag(sub, t) {
  const now = Date.now() / 1000;
  const end = sub?.end_time || 0;
  const status = sub?.status || '';

  const isExpiredByTime = end > 0 && end < now;
  const isActive = status === 'active' && !isExpiredByTime;
  if (isActive) {
    return (
      <Tag color='green' shape='circle' size='small'>
        {t('生效')}
      </Tag>
    );
  }
  if (status === 'cancelled') {
    return (
      <Tag color='grey' shape='circle' size='small'>
        {t('已作废')}
      </Tag>
    );
  }
  return (
    <Tag color='grey' shape='circle' size='small'>
      {t('已过期')}
    </Tag>
  );
}

const UserSubscriptionsModal = ({ visible, onCancel, user, t, onSuccess }) => {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [plansLoading, setPlansLoading] = useState(false);

  const [plans, setPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);

  const [subs, setSubs] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 改期弹窗状态
  const [editEndTimeVisible, setEditEndTimeVisible] = useState(false);
  const [editEndTimeSub, setEditEndTimeSub] = useState(null);
  const [editEndTimeValue, setEditEndTimeValue] = useState(null);
  const [editEndTimeLoading, setEditEndTimeLoading] = useState(false);

  const openEditEndTime = (sub) => {
    setEditEndTimeSub(sub);
    setEditEndTimeValue(sub?.end_time ? new Date(sub.end_time * 1000) : new Date());
    setEditEndTimeVisible(true);
  };

  const submitEditEndTime = async () => {
    if (!editEndTimeSub?.id || !editEndTimeValue) return;
    const endTimeUnix = Math.floor(new Date(editEndTimeValue).getTime() / 1000);
    if (endTimeUnix <= 0) {
      showError(t('请选择有效的日期'));
      return;
    }
    setEditEndTimeLoading(true);
    try {
      const res = await API.put(
        `/api/subscription/admin/user_subscriptions/${editEndTimeSub.id}/end_time`,
        { end_time: endTimeUnix },
      );
      if (res.data?.success) {
        showSuccess(res.data?.data?.message || t('到期时间已更新'));
        setEditEndTimeVisible(false);
        await loadUserSubscriptions();
        onSuccess?.();
      } else {
        showError(res.data?.message || t('操作失败'));
      }
    } catch (e) {
      showError(t('请求失败'));
    } finally {
      setEditEndTimeLoading(false);
    }
  };

  const planTitleMap = useMemo(() => {
    const map = new Map();
    (plans || []).forEach((p) => {
      const id = p?.plan?.id;
      const title = p?.plan?.title;
      if (id) map.set(id, title || `#${id}`);
    });
    return map;
  }, [plans]);

  const pagedSubs = useMemo(() => {
    const start = Math.max(0, (Number(currentPage || 1) - 1) * pageSize);
    const end = start + pageSize;
    return (subs || []).slice(start, end);
  }, [subs, currentPage]);

  const planOptions = useMemo(() => {
    return (plans || []).map((p) => ({
      label: `${p?.plan?.title || ''} (${convertUSDToCurrency(
        Number(p?.plan?.price_amount || 0),
        2,
      )})`,
      value: p?.plan?.id,
    }));
  }, [plans]);

  const loadPlans = async () => {
    setPlansLoading(true);
    try {
      const res = await API.get('/api/subscription/admin/plans');
      if (res.data?.success) {
        setPlans(res.data.data || []);
      } else {
        showError(res.data?.message || t('加载失败'));
      }
    } catch (e) {
      showError(t('请求失败'));
    } finally {
      setPlansLoading(false);
    }
  };

  const loadUserSubscriptions = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await API.get(
        `/api/subscription/admin/users/${user.id}/subscriptions`,
      );
      if (res.data?.success) {
        const next = res.data.data || [];
        setSubs(next);
        setCurrentPage(1);
      } else {
        showError(res.data?.message || t('加载失败'));
      }
    } catch (e) {
      showError(t('请求失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setSelectedPlanId(null);
    setCurrentPage(1);
    loadPlans();
    loadUserSubscriptions();
  }, [visible]);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const createSubscription = async () => {
    if (!user?.id) {
      showError(t('用户信息缺失'));
      return;
    }
    if (!selectedPlanId) {
      showError(t('请选择订阅套餐'));
      return;
    }
    setCreating(true);
    try {
      const res = await API.post(
        `/api/subscription/admin/users/${user.id}/subscriptions`,
        {
          plan_id: selectedPlanId,
        },
      );
      if (res.data?.success) {
        const msg = res.data?.data?.message;
        showSuccess(msg ? msg : t('新增成功'));
        setSelectedPlanId(null);
        await loadUserSubscriptions();
        onSuccess?.();
      } else {
        showError(res.data?.message || t('新增失败'));
      }
    } catch (e) {
      showError(t('请求失败'));
    } finally {
      setCreating(false);
    }
  };

  const invalidateSubscription = (subId) => {
    Modal.confirm({
      title: t('确认作废'),
      content: t('作废后该订阅将立即失效，历史记录不受影响。是否继续？'),
      centered: true,
      onOk: async () => {
        try {
          const res = await API.post(
            `/api/subscription/admin/user_subscriptions/${subId}/invalidate`,
          );
          if (res.data?.success) {
            const msg = res.data?.data?.message;
            showSuccess(msg ? msg : t('已作废'));
            await loadUserSubscriptions();
            onSuccess?.();
          } else {
            showError(res.data?.message || t('操作失败'));
          }
        } catch (e) {
          showError(t('请求失败'));
        }
      },
    });
  };

  const deleteSubscription = (subId) => {
    Modal.confirm({
      title: t('确认删除'),
      content: t('删除会彻底移除该订阅记录（含权益明细）。是否继续？'),
      centered: true,
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await API.delete(
            `/api/subscription/admin/user_subscriptions/${subId}`,
          );
          if (res.data?.success) {
            const msg = res.data?.data?.message;
            showSuccess(msg ? msg : t('已删除'));
            await loadUserSubscriptions();
            onSuccess?.();
          } else {
            showError(res.data?.message || t('删除失败'));
          }
        } catch (e) {
          showError(t('请求失败'));
        }
      },
    });
  };

  const resetSubscriptionQuota = (subId) => {
    Modal.confirm({
      title: t('确认重置额度'),
      content: t('将把该订阅的已用额度重置为0，相当于重新开始当期额度。是否继续？'),
      centered: true,
      onOk: async () => {
        try {
          const res = await API.post(
            `/api/subscription/admin/user_subscriptions/${subId}/reset_quota`,
          );
          if (res.data?.success) {
            const msg = res.data?.data?.message;
            showSuccess(msg ? msg : t('额度已重置'));
            await loadUserSubscriptions();
            onSuccess?.();
          } else {
            showError(res.data?.message || t('操作失败'));
          }
        } catch (e) {
          showError(t('请求失败'));
        }
      },
    });
  };

  const columns = useMemo(() => {
    return [
      {
        title: 'ID',
        dataIndex: ['subscription', 'id'],
        key: 'id',
        width: 70,
      },
      {
        title: t('套餐'),
        key: 'plan',
        width: 180,
        render: (_, record) => {
          const sub = record?.subscription;
          const planId = sub?.plan_id;
          const title =
            planTitleMap.get(planId) || (planId ? `#${planId}` : '-');
          return (
            <div className='min-w-0'>
              <div className='font-medium truncate'>{title}</div>
              <div className='text-xs text-gray-500'>
                {t('来源')}: {sub?.source || '-'}
              </div>
            </div>
          );
        },
      },
      {
        title: t('状态'),
        key: 'status',
        width: 90,
        render: (_, record) => renderStatusTag(record?.subscription, t),
      },
      {
        title: t('有效期'),
        key: 'validity',
        width: 200,
        render: (_, record) => {
          const sub = record?.subscription;
          return (
            <div className='text-xs text-gray-600'>
              <div>
                {t('开始')}: {formatTs(sub?.start_time)}
              </div>
              <div>
                {t('结束')}: {formatTs(sub?.end_time)}
              </div>
            </div>
          );
        },
      },
      {
        title: t('总额度'),
        key: 'total',
        width: 120,
        render: (_, record) => {
          const sub = record?.subscription;
          const total = Number(sub?.amount_total || 0);
          const used = Number(sub?.amount_used || 0);
          return (
            <Text type={total > 0 ? 'secondary' : 'tertiary'}>
              {total > 0 ? `${used}/${total}` : t('不限')}
            </Text>
          );
        },
      },
      {
        title: '',
        key: 'operate',
        width: 280,
        fixed: 'right',
        render: (_, record) => {
          const sub = record?.subscription;
          const now = Date.now() / 1000;
          const isExpired =
            (sub?.end_time || 0) > 0 && (sub?.end_time || 0) < now;
          const isActive = sub?.status === 'active' && !isExpired;
          const isCancelled = sub?.status === 'cancelled';
          return (
            <Space>
              <Button
                size='small'
                theme='light'
                disabled={isCancelled}
                onClick={() => openEditEndTime(sub)}
              >
                {t('改期')}
              </Button>
              <Button
                size='small'
                theme='light'
                disabled={!isActive || isCancelled}
                onClick={() => resetSubscriptionQuota(sub?.id)}
              >
                {t('重置额度')}
              </Button>
              <Button
                size='small'
                type='warning'
                theme='light'
                disabled={!isActive || isCancelled}
                onClick={() => invalidateSubscription(sub?.id)}
              >
                {t('作废')}
              </Button>
              <Button
                size='small'
                type='danger'
                theme='light'
                onClick={() => deleteSubscription(sub?.id)}
              >
                {t('删除')}
              </Button>
            </Space>
          );
        },
      },
    ];
  }, [t, planTitleMap]);

  return (
    <>
    <SideSheet
      visible={visible}
      placement='right'
      width={isMobile ? '100%' : 920}
      bodyStyle={{ padding: 0 }}
      onCancel={onCancel}
      title={
        <Space>
          <Tag color='blue' shape='circle'>
            {t('管理')}
          </Tag>
          <Typography.Title heading={4} className='m-0'>
            {t('用户订阅管理')}
          </Typography.Title>
          <Text type='tertiary' className='ml-2'>
            {user?.username || '-'} (ID: {user?.id || '-'})
          </Text>
        </Space>
      }
    >
      <div className='p-4'>
        {/* 顶部操作栏：新增订阅 */}
        <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4'>
          <div className='flex gap-2 flex-1'>
            <Select
              placeholder={t('选择订阅套餐')}
              optionList={planOptions}
              value={selectedPlanId}
              onChange={setSelectedPlanId}
              loading={plansLoading}
              filter
              style={{ minWidth: isMobile ? undefined : 300, flex: 1 }}
            />
            <Button
              type='primary'
              theme='solid'
              icon={<IconPlusCircle />}
              loading={creating}
              onClick={createSubscription}
            >
              {t('新增订阅')}
            </Button>
          </div>
        </div>

        {/* 订阅列表 */}
        <CardTable
          columns={columns}
          dataSource={pagedSubs}
          rowKey={(row) => row?.subscription?.id}
          loading={loading}
          scroll={{ x: 'max-content' }}
          hidePagination={false}
          pagination={{
            currentPage,
            pageSize,
            total: subs.length,
            pageSizeOpts: [10, 20, 50],
            showSizeChanger: false,
            onPageChange: handlePageChange,
          }}
          empty={
            <Empty
              image={
                <IllustrationNoResult style={{ width: 150, height: 150 }} />
              }
              darkModeImage={
                <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
              }
              description={t('暂无订阅记录')}
              style={{ padding: 30 }}
            />
          }
          size='middle'
        />
      </div>
    </SideSheet>

    {/* 修改到期时间弹窗 */}
    <Modal
      title={t('修改到期时间')}
      visible={editEndTimeVisible}
      onOk={submitEditEndTime}
      onCancel={() => setEditEndTimeVisible(false)}
      confirmLoading={editEndTimeLoading}
      centered
    >
      <div className='mb-3'>
        <Text type='secondary'>
          {t('订阅 ID')}: {editEndTimeSub?.id || '-'}
        </Text>
      </div>
      <DatePicker
        type='dateTime'
        value={editEndTimeValue}
        onChange={(val) => setEditEndTimeValue(val)}
        style={{ width: '100%' }}
      />
    </Modal>
    </>
  );
};

export default UserSubscriptionsModal;
