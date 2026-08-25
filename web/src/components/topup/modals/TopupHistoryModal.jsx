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
import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Table,
  Badge,
  Typography,
  Toast,
  Empty,
  Button,
  Input,
  Tag,
  Tooltip,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { Coins, Receipt } from 'lucide-react';
import { IconSearch } from '@douyinfe/semi-icons';
import { API, timestamp2string } from '../../../helpers';
import { isAdmin } from '../../../helpers/utils';
import { PAYMENT_METHOD_MAP } from '../../../constants';
import { useIsMobile } from '../../../hooks/common/useIsMobile';
import ReceiptModal from './ReceiptModal';
const { Text } = Typography;

// 状态映射配置
const STATUS_CONFIG = {
  success: { type: 'success', key: '成功' },
  pending: { type: 'warning', key: '待支付' },
  failed: { type: 'danger', key: '失败' },
  expired: { type: 'danger', key: '已过期' },
};

const TopupHistoryModal = ({ visible, onCancel, t }) => {
  const [loading, setLoading] = useState(false);
  const [topups, setTopups] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  // 收据弹窗。只存单号不存整条 record —— 收据数据一律由后端重新查，
  // 免得表格里的陈旧行渲染出与库里不一致的凭证。
  const [receipt, setReceipt] = useState({
    visible: false,
    tradeNo: '',
    tradeNos: null,
  });
  // 勾选的订单（存 record，因为要按币种/归属做合并前校验）
  const [selected, setSelected] = useState([]);
  const isMobile = useIsMobile();

  const loadTopups = async (currentPage, currentPageSize) => {
    setLoading(true);
    try {
      const base = isAdmin() ? '/api/user/topup' : '/api/user/topup/self';
      const qs =
        `p=${currentPage}&page_size=${currentPageSize}` +
        (keyword ? `&keyword=${encodeURIComponent(keyword)}` : '');
      const endpoint = `${base}?${qs}`;
      const res = await API.get(endpoint);
      const { success, message, data } = res.data;
      if (success) {
        setTopups(data.items || []);
        setTotal(data.total || 0);
      } else {
        Toast.error({ content: message || t('加载失败') });
      }
    } catch (error) {
      Toast.error({ content: t('加载账单失败') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      loadTopups(page, pageSize);
    }
  }, [visible, page, pageSize, keyword]);

  // 翻页/搜索/关窗都清空勾选：跨页保留勾选会让「合并 3 笔」的按钮
  // 把用户看不见的行也算进去。
  useEffect(() => {
    setSelected([]);
  }, [visible, page, pageSize, keyword]);

  // 合并前的本地校验。后端仍会再校验一遍（它才是权威），
  // 这里做是为了点之前就把不可合并的原因说清楚，而不是点了才报错。
  const mergeBlockReason = useMemo(() => {
    if (selected.length < 2) return null;
    const currencies = new Set(
      selected.map((r) => r.currency_code || '').filter(Boolean),
    );
    if (currencies.size > 1) {
      return t('所选订单币种不一致，无法合并开具');
    }
    // 管理员的账单列表是全站的，可能勾到不同客户
    const owners = new Set(selected.map((r) => r.user_id));
    if (owners.size > 1) {
      return t('所选订单不属于同一用户，无法合并开具');
    }
    return null;
  }, [selected, t]);

  const openMergedReceipt = () => {
    setReceipt({
      visible: true,
      tradeNo: '',
      tradeNos: selected.map((r) => r.trade_no),
    });
  };

  const handlePageChange = (currentPage) => {
    setPage(currentPage);
  };

  const handlePageSizeChange = (currentPageSize) => {
    setPageSize(currentPageSize);
    setPage(1);
  };

  const handleKeywordChange = (value) => {
    setKeyword(value);
    setPage(1);
  };

  // 管理员补单
  const handleAdminComplete = async (tradeNo) => {
    try {
      const res = await API.post('/api/user/topup/complete', {
        trade_no: tradeNo,
      });
      const { success, message } = res.data;
      if (success) {
        Toast.success({ content: t('补单成功') });
        await loadTopups(page, pageSize);
      } else {
        Toast.error({ content: message || t('补单失败') });
      }
    } catch (e) {
      Toast.error({ content: t('补单失败') });
    }
  };

  const confirmAdminComplete = (tradeNo) => {
    Modal.confirm({
      title: t('确认补单'),
      content: t('是否将该订单标记为成功并为用户入账？'),
      onOk: () => handleAdminComplete(tradeNo),
    });
  };

  // 渲染状态徽章
  const renderStatusBadge = (status) => {
    const config = STATUS_CONFIG[status] || { type: 'primary', key: status };
    return (
      <span className='flex items-center gap-2'>
        <Badge dot type={config.type} />
        <span>{t(config.key)}</span>
      </span>
    );
  };

  // 渲染支付方式
  const renderPaymentMethod = (pm) => {
    const displayName = PAYMENT_METHOD_MAP[pm];
    return <Text>{displayName ? t(displayName) : pm || '-'}</Text>;
  };

  const isSubscriptionTopup = (record) => {
    const tradeNo = (record?.trade_no || '').toLowerCase();
    return Number(record?.amount || 0) === 0 && tradeNo.startsWith('sub');
  };

  // 检查是否为管理员
  const userIsAdmin = useMemo(() => isAdmin(), []);

  const columns = useMemo(() => {
    const baseColumns = [
      {
        title: t('订单号'),
        dataIndex: 'trade_no',
        key: 'trade_no',
        render: (text) => <Text copyable>{text}</Text>,
      },
      {
        title: t('支付方式'),
        dataIndex: 'payment_method',
        key: 'payment_method',
        render: renderPaymentMethod,
      },
      {
        title: t('充值额度'),
        dataIndex: 'amount',
        key: 'amount',
        render: (amount, record) => {
          if (isSubscriptionTopup(record)) {
            return (
              <Tag color='purple' shape='circle' size='small'>
                {t('订阅套餐')}
              </Tag>
            );
          }
          return (
            <span className='flex items-center gap-1'>
              <Coins size={16} />
              <Text>{amount}</Text>
            </span>
          );
        },
      },
      {
        title: t('支付金额'),
        dataIndex: 'money',
        key: 'money',
        // 币种由后端按支付渠道下发。原先这里硬编码 ¥，Stripe / Creem 的
        // 美元订单会被显示成 ¥ 金额（现网只用支付宝/微信所以没暴露）。
        render: (money, record) => (
          <Text type='danger'>
            {record.currency_symbol ||
              (record.currency_code ? `${record.currency_code} ` : '')}
            {Number(money || 0).toFixed(2)}
          </Text>
        ),
      },
      {
        title: t('状态'),
        dataIndex: 'status',
        key: 'status',
        render: renderStatusBadge,
      },
    ];

    // 操作列所有人可见：普通用户在这里下载收据，管理员额外有补单。
    baseColumns.push({
      title: t('操作'),
      key: 'action',
      render: (_, record) => {
        const actions = [];
        // 收据只对已支付成功的订单开具（后端也会再校验一次状态与归属）
        if (record.status === 'success') {
          actions.push(
            <Button
              key='receipt'
              size='small'
              theme='borderless'
              icon={<Receipt size={14} />}
              onClick={() =>
                setReceipt({
                  visible: true,
                  tradeNo: record.trade_no,
                  tradeNos: null,
                })
              }
            >
              {t('收据')}
            </Button>,
          );
        }
        if (userIsAdmin && record.status === 'pending') {
          actions.push(
            <Button
              key='complete'
              size='small'
              type='primary'
              theme='outline'
              onClick={() => confirmAdminComplete(record.trade_no)}
            >
              {t('补单')}
            </Button>,
          );
        }
        return actions.length > 0 ? (
          <div className='flex items-center gap-1'>{actions}</div>
        ) : null;
      },
    });

    baseColumns.push({
      title: t('创建时间'),
      dataIndex: 'create_time',
      key: 'create_time',
      render: (time) => timestamp2string(time),
    });

    return baseColumns;
  }, [t, userIsAdmin]);

  return (
    <Modal
      title={t('充值账单')}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      size={isMobile ? 'full-width' : 'large'}
    >
      <div className='mb-3'>
        <Input
          prefix={<IconSearch />}
          placeholder={t('订单号')}
          value={keyword}
          onChange={handleKeywordChange}
          showClear
        />
      </div>

      {/* 勾选后出现的合并开具条。只在选了才显示，平时不占地方 */}
      {selected.length > 0 && (
        <div className='mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-semi-color-fill-0'>
          <Text type='tertiary' className='text-xs'>
            {t('已选')} {selected.length} {t('笔')}
            {mergeBlockReason ? ` · ${mergeBlockReason}` : ''}
          </Text>
          <div className='flex items-center gap-2'>
            <Button size='small' theme='borderless' onClick={() => setSelected([])}>
              {t('取消选择')}
            </Button>
            <Tooltip
              content={mergeBlockReason || ''}
              position='top'
              trigger={mergeBlockReason ? 'mouseEnter' : 'custom'}
            >
              <Button
                size='small'
                type='primary'
                theme='solid'
                icon={<Receipt size={14} />}
                disabled={selected.length < 2 || !!mergeBlockReason}
                onClick={openMergedReceipt}
              >
                {t('合并开具收据')}
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={topups}
        loading={loading}
        rowKey='id'
        rowSelection={{
          selectedRowKeys: selected.map((r) => r.id),
          onChange: (_keys, rows) => setSelected(rows || []),
          // 只有已支付成功的订单能开收据，未支付的行直接禁掉勾选框，
          // 免得用户勾了一堆才被后端告知不行
          getCheckboxProps: (record) => ({
            disabled: record?.status !== 'success',
          }),
        }}
        pagination={{
          currentPage: page,
          pageSize: pageSize,
          total: total,
          showSizeChanger: true,
          pageSizeOpts: [10, 20, 50, 100],
          onPageChange: handlePageChange,
          onPageSizeChange: handlePageSizeChange,
        }}
        size='small'
        empty={
          <Empty
            image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
            darkModeImage={
              <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
            }
            description={t('暂无充值记录')}
            style={{ padding: 30 }}
          />
        }
      />

      <ReceiptModal
        t={t}
        visible={receipt.visible}
        tradeNo={receipt.tradeNo}
        tradeNos={receipt.tradeNos}
        onCancel={() => setReceipt((r) => ({ ...r, visible: false }))}
      />
    </Modal>
  );
};

export default TopupHistoryModal;
