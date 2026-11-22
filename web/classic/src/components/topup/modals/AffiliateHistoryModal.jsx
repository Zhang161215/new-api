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
import React, { useEffect, useState } from 'react';
import { Modal, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { API, timestamp2string } from '../../../helpers';

const { Text } = Typography;

const STATUS_MAP = {
  pending: { type: 'warning', key: '待到账' },
  released: { type: 'success', key: '已到账' },
  revoked: { type: 'danger', key: '已撤销' },
};

const AffiliateHistoryModal = ({ visible, onClose, t, renderQuota }) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res = await API.get(
        `/api/user/affiliate/history?page=${p}&page_size=${ps}`,
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
    if (visible) {
      load(page, pageSize);
    }
  }, [visible, page, pageSize]);

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 70,
    },
    {
      title: t('被邀人'),
      dataIndex: 'invitee_username',
      render: (v, r) => v || `#${r.invitee_id}`,
    },
    {
      title: t('充值金额'),
      dataIndex: 'topup_money',
      render: (v) => `$${(v || 0).toFixed(2)}`,
    },
    {
      title: t('返利金额'),
      dataIndex: 'rebate_money',
      render: (v, r) => (
        <Text strong>${(v || 0).toFixed(2)}</Text>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      render: (v) => {
        const conf = STATUS_MAP[v] || { type: 'tertiary', key: v };
        return <Tag color={conf.type}>{t(conf.key)}</Tag>;
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
  ];

  return (
    <Modal
      title={t('返利记录')}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={920}
    >
      <Table
        dataSource={items}
        columns={columns}
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
          pageSizeOpts: [10, 20, 50],
        }}
      />
    </Modal>
  );
};

export default AffiliateHistoryModal;
