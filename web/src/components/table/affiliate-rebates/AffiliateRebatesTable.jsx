/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

For commercial licensing, please contact support@quantumnous.com
*/
import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Toast,
  Modal,
  Input,
  Form,
  Space,
  Typography,
  Select,
} from '@douyinfe/semi-ui';
import { API, timestamp2string } from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const STATUS_MAP = {
  pending: { color: 'orange', key: '待到账' },
  released: { color: 'green', key: '已到账' },
  revoked: { color: 'grey', key: '已撤销' },
};

const AffiliateRebatesTable = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [inviterId, setInviterId] = useState('');
  const [inviteeId, setInviteeId] = useState('');

  const [revokeVisible, setRevokeVisible] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');

  const fetchList = async (
    p = page,
    ps = pageSize,
    s = statusFilter,
    iv = inviterId,
    ie = inviteeId,
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p,
        page_size: ps,
      });
      if (s) params.append('status', s);
      if (iv) params.append('inviter_id', iv);
      if (ie) params.append('invitee_id', ie);
      const res = await API.get(
        `/api/affiliate-rebates?${params.toString()}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setItems(data.items || []);
        setTotal(data.total || 0);
      } else {
        Toast.error({ content: message || t('加载失败') });
      }
    } catch (e) {
      Toast.error({ content: t('加载失败') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList(page, pageSize, statusFilter, inviterId, inviteeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const onSearch = () => {
    setPage(1);
    fetchList(1, pageSize, statusFilter, inviterId, inviteeId);
  };

  const onRelease = async (record) => {
    Modal.confirm({
      title: t('确认提前到账'),
      content: `#${record.id} → ${t('返利金额')} $${(record.rebate_money || 0).toFixed(2)}`,
      onOk: async () => {
        try {
          const res = await API.post(
            `/api/affiliate-rebates/${record.id}/release`,
          );
          if (res?.data?.success) {
            Toast.success({ content: t('已到账') });
            fetchList(page, pageSize, statusFilter, inviterId, inviteeId);
          } else {
            Toast.error({ content: res?.data?.message || t('操作失败') });
          }
        } catch (e) {
          Toast.error({ content: t('操作失败') });
        }
      },
    });
  };

  const openRevoke = (record) => {
    setRevokeTarget(record);
    setRevokeReason('');
    setRevokeVisible(true);
  };

  const submitRevoke = async () => {
    if (!revokeTarget) return;
    try {
      const res = await API.post(
        `/api/affiliate-rebates/${revokeTarget.id}/revoke`,
        { reason: revokeReason },
      );
      if (res?.data?.success) {
        Toast.success({ content: t('已撤销') });
        setRevokeVisible(false);
        fetchList(page, pageSize, statusFilter, inviterId, inviteeId);
      } else {
        Toast.error({ content: res?.data?.message || t('操作失败') });
      }
    } catch (e) {
      Toast.error({ content: t('操作失败') });
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: t('邀请人'),
      dataIndex: 'inviter_username',
      render: (v, r) => (v ? `${v} (#${r.inviter_id})` : `#${r.inviter_id}`),
    },
    {
      title: t('被邀人'),
      dataIndex: 'invitee_username',
      render: (v, r) => (v ? `${v} (#${r.invitee_id})` : `#${r.invitee_id}`),
    },
    {
      title: t('充值金额'),
      dataIndex: 'topup_money',
      render: (v) => `$${(v || 0).toFixed(2)}`,
    },
    {
      title: t('返利金额'),
      dataIndex: 'rebate_money',
      render: (v) => <Text strong>{`$${(v || 0).toFixed(2)}`}</Text>,
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      render: (v) => {
        const conf = STATUS_MAP[v] || { color: 'grey', key: v };
        return <Tag color={conf.color}>{t(conf.key)}</Tag>;
      },
    },
    {
      title: t('创建时间'),
      dataIndex: 'created_at',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
    {
      title: t('预计到账'),
      dataIndex: 'release_at',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
    {
      title: t('实际到账'),
      dataIndex: 'released_at',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
    {
      title: t('操作'),
      dataIndex: 'op',
      width: 180,
      render: (_, r) => (
        <Space>
          {r.status === 'pending' && (
            <Button size='small' type='primary' onClick={() => onRelease(r)}>
              {t('提前到账')}
            </Button>
          )}
          {(r.status === 'pending' || r.status === 'released') && (
            <Button
              size='small'
              type='danger'
              theme='light'
              onClick={() => openRevoke(r)}
            >
              {t('撤销返利')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title={t('返利管理')}>
      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Select
          placeholder={t('状态')}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v || '')}
          style={{ width: 140 }}
          showClear
        >
          <Select.Option value='pending'>{t('待到账')}</Select.Option>
          <Select.Option value='released'>{t('已到账')}</Select.Option>
          <Select.Option value='revoked'>{t('已撤销')}</Select.Option>
        </Select>
        <Input
          placeholder={t('邀请人') + ' ID'}
          value={inviterId}
          onChange={(v) => setInviterId(v)}
          style={{ width: 140 }}
        />
        <Input
          placeholder={t('被邀人') + ' ID'}
          value={inviteeId}
          onChange={(v) => setInviteeId(v)}
          style={{ width: 140 }}
        />
        <Button type='primary' onClick={onSearch}>
          {t('搜索')}
        </Button>
      </Space>

      <Table
        columns={columns}
        dataSource={items}
        loading={loading}
        rowKey='id'
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => setPage(p),
          onPageSizeChange: (ps) => {
            setPageSize(ps);
            setPage(1);
          },
          showSizeChanger: true,
          pageSizeOpts: [10, 20, 50, 100],
        }}
      />

      <Modal
        title={t('确认撤销该返利？')}
        visible={revokeVisible}
        onCancel={() => setRevokeVisible(false)}
        onOk={submitRevoke}
        okType='danger'
      >
        <div className='mb-3'>
          <Text type='warning'>
            {t(
              '撤销 pending 返利仅扣减待到账额度；撤销已到账返利将从 aff_quota 扣减，不足时继续扣 quota（可能变负）',
            )}
          </Text>
        </div>
        <Input
          placeholder={t('请输入撤销原因')}
          value={revokeReason}
          onChange={(v) => setRevokeReason(v)}
        />
      </Modal>
    </Card>
  );
};

export default AffiliateRebatesTable;
