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
  Banner,
  Button,
  Empty,
  Modal,
  Table,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { PenLine, Receipt } from 'lucide-react';
import { API, timestamp2string } from '../../../../helpers';
import { PAYMENT_METHOD_MAP } from '../../../../constants';
import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import ReceiptModal from '../../../topup/modals/ReceiptModal';
import ManualReceiptModal from './ManualReceiptModal';

const { Text } = Typography;

/**
 * 管理员替某个客户开具收据。
 *
 * 走管理员充值列表接口并带 user_id，只拉这个人的单；后端只返回 success 的也不行
 * （列表本身要显示全部状态），所以这里前端只允许勾选已成功的行。
 * 收据内容仍由收据接口重新查库生成，这个列表只负责「选哪几笔」。
 */
const UserReceiptsModal = ({ visible, onCancel, user, t }) => {
  const [loading, setLoading] = useState(false);
  const [topups, setTopups] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState([]);
  const [receipt, setReceipt] = useState({
    visible: false,
    tradeNo: '',
    tradeNos: null,
  });
  const [manualVisible, setManualVisible] = useState(false);
  const isMobile = useIsMobile();

  const userId = user?.id;

  useEffect(() => {
    if (!visible || !userId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await API.get(
          `/api/user/topup?p=${page}&page_size=${pageSize}&user_id=${userId}`,
        );
        if (cancelled) return;
        const { success, message, data } = res.data;
        if (success) {
          setTopups(data.items || []);
          setTotal(data.total || 0);
        } else {
          Toast.error({ content: message || t('加载失败') });
        }
      } catch (e) {
        if (!cancelled) Toast.error({ content: t('加载账单失败') });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [visible, userId, page, pageSize, t]);

  // 换人/翻页/关窗都清掉勾选，避免把看不见的行算进合并
  useEffect(() => {
    setSelected([]);
  }, [visible, userId, page, pageSize]);

  const successCount = useMemo(
    () => topups.filter((r) => r.status === 'success').length,
    [topups],
  );

  // 合并前的本地校验（后端仍是权威）。这里只可能撞到混币种 ——
  // 列表已经按 user_id 筛过，不会跨用户。
  const mergeBlockReason = useMemo(() => {
    if (selected.length < 2) return null;
    const currencies = new Set(
      selected.map((r) => r.currency_code || '').filter(Boolean),
    );
    if (currencies.size > 1) {
      return t('所选订单币种不一致，无法合并开具');
    }
    return null;
  }, [selected, t]);

  const columns = useMemo(
    () => [
      {
        title: t('订单号'),
        dataIndex: 'trade_no',
        render: (v) => <Text copyable>{v}</Text>,
      },
      {
        title: t('支付方式'),
        dataIndex: 'payment_method',
        render: (pm) => <Text>{t(PAYMENT_METHOD_MAP[pm] || pm || '-')}</Text>,
      },
      {
        title: t('支付金额'),
        dataIndex: 'money',
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
        render: (s) =>
          s === 'success' ? (
            <Text type='success'>{t('成功')}</Text>
          ) : (
            <Text type='tertiary'>{t(s)}</Text>
          ),
      },
      {
        title: t('支付时间'),
        dataIndex: 'complete_time',
        render: (v, record) =>
          timestamp2string(v > 0 ? v : record.create_time),
      },
      {
        title: t('操作'),
        key: 'action',
        render: (_, record) =>
          record.status === 'success' ? (
            <Button
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
            </Button>
          ) : null,
      },
    ],
    [t],
  );

  return (
    <Modal
      title={`${t('开具收据')} · ${user?.display_name || user?.username || ''}`}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      size={isMobile ? 'full-width' : 'large'}
    >
      <div className='mb-3 flex items-start justify-between gap-3'>
        <Banner
          type='info'
          closeIcon={null}
          description={t(
            '收据为付款凭证，非增值税发票。可单笔开具，或勾选多笔合并为一张。',
          )}
          className='flex-1'
        />
        {/* 线下转账（客户私信打款）在系统里没有订单，走手工开具 */}
        <Button
          theme='light'
          type='primary'
          icon={<PenLine size={14} />}
          onClick={() => setManualVisible(true)}
          className='shrink-0'
        >
          {t('手工开具')}
        </Button>
      </div>

      {selected.length > 0 && (
        <div className='mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-semi-color-fill-0'>
          <Text type='tertiary' className='text-xs'>
            {t('已选')} {selected.length} {t('笔')}
            {mergeBlockReason ? ` · ${mergeBlockReason}` : ''}
          </Text>
          <div className='flex items-center gap-2'>
            <Button
              size='small'
              theme='borderless'
              onClick={() => setSelected([])}
            >
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
                onClick={() =>
                  setReceipt({
                    visible: true,
                    tradeNo: '',
                    tradeNos: selected.map((r) => r.trade_no),
                  })
                }
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
        size='small'
        rowSelection={{
          selectedRowKeys: selected.map((r) => r.id),
          onChange: (_keys, rows) => setSelected(rows || []),
          getCheckboxProps: (record) => ({
            disabled: record?.status !== 'success',
          }),
        }}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOpts: [10, 20, 50, 100],
          onPageChange: setPage,
          onPageSizeChange: (s) => {
            setPageSize(s);
            setPage(1);
          },
        }}
        empty={
          <Empty
            image={<IllustrationNoResult style={{ width: 140, height: 140 }} />}
            darkModeImage={
              <IllustrationNoResultDark style={{ width: 140, height: 140 }} />
            }
            description={t('该用户暂无充值记录')}
            style={{ padding: 28 }}
          />
        }
      />

      {!loading && topups.length > 0 && successCount === 0 && (
        <Text type='tertiary' className='text-xs'>
          {t('该用户没有已支付成功的订单，无法开具收据')}
        </Text>
      )}

      <ReceiptModal
        t={t}
        visible={receipt.visible}
        tradeNo={receipt.tradeNo}
        tradeNos={receipt.tradeNos}
        onCancel={() => setReceipt((r) => ({ ...r, visible: false }))}
      />

      <ManualReceiptModal
        t={t}
        visible={manualVisible}
        user={user}
        onCancel={() => setManualVisible(false)}
      />
    </Modal>
  );
};

export default UserReceiptsModal;
