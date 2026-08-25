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
import {
  Banner,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Select,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import ReceiptModal from '../../../topup/modals/ReceiptModal';

const { Text } = Typography;

// 线下收款方式候选。Select 开了 allowCreate，可以现填别的（如「银行转账」）。
const OFFLINE_METHODS = ['支付宝转账', '微信转账', '银行转账', 'USDT', '其他'];

/**
 * 手工开具收据：客户私信转账、系统里没有订单时用。
 *
 * 全程不写库 —— 不加额度、不发返利、不计入累计充值、也不出现在客户账单里。
 * 就是填一张凭据打出来。加不加额度请照原来的方式在后台单独操作。
 */
const ManualReceiptModal = ({ visible, onCancel, user, t }) => {
  const [money, setMoney] = useState(null);
  const [currency, setCurrency] = useState('CNY');
  const [method, setMethod] = useState(OFFLINE_METHODS[0]);
  const [paidAt, setPaidAt] = useState(() => new Date());
  const [itemName, setItemName] = useState('API 额度充值');
  const [remark, setRemark] = useState('');
  const [payload, setPayload] = useState(null);

  // 每次打开都重置：上一位客户的金额留在表单里，很容易开错
  useEffect(() => {
    if (!visible) return;
    setMoney(null);
    setCurrency('CNY');
    setMethod(OFFLINE_METHODS[0]);
    setPaidAt(new Date());
    setItemName('API 额度充值');
    setRemark('');
    setPayload(null);
  }, [visible]);

  const submit = () => {
    const amount = Number(money);
    if (!amount || amount < 0.01) {
      Toast.error({ content: t('请填写收款金额') });
      return;
    }
    if (!method) {
      Toast.error({ content: t('请填写收款方式') });
      return;
    }
    setPayload({
      user_id: user?.id,
      money: amount,
      currency_code: currency,
      payment_method: method,
      // DatePicker 给的是 Date，后端要秒级时间戳
      paid_at: Math.floor((paidAt?.getTime?.() || Date.now()) / 1000),
      item_name: itemName,
      remark,
    });
  };

  const label = (text) => (
    <Text type='tertiary' className='text-xs block mb-1'>
      {text}
    </Text>
  );

  return (
    <>
      <Modal
        title={`${t('手工开具收据')} · ${user?.display_name || user?.username || ''}`}
        visible={visible}
        onCancel={onCancel}
        footer={
          <div className='flex justify-end gap-2'>
            <Button onClick={onCancel}>{t('取消')}</Button>
            <Button type='primary' theme='solid' onClick={submit}>
              {t('生成凭据')}
            </Button>
          </div>
        }
      >
        <Banner
          type='warning'
          closeIcon={null}
          description={t(
            '此操作只生成凭据，不会写入充值记录、不加额度、不发返利。额度请另行在后台调整。',
          )}
          className='mb-4'
        />

        <div className='grid grid-cols-2 gap-3'>
          <div>
            {label(t('收款金额'))}
            <InputNumber
              value={money}
              onChange={setMoney}
              min={0.01}
              step={1}
              precision={2}
              placeholder='0.00'
              style={{ width: '100%' }}
            />
          </div>
          <div>
            {label(t('币种'))}
            <Select
              value={currency}
              onChange={setCurrency}
              style={{ width: '100%' }}
              optionList={[
                { label: '¥ CNY', value: 'CNY' },
                { label: '$ USD', value: 'USD' },
              ]}
            />
          </div>
        </div>

        <div className='mt-3'>
          {label(t('收款方式'))}
          <Select
            value={method}
            onChange={setMethod}
            allowCreate
            filter
            style={{ width: '100%' }}
            optionList={OFFLINE_METHODS.map((m) => ({
              label: t(m),
              value: m,
            }))}
          />
        </div>

        <div className='mt-3'>
          {label(t('收款时间'))}
          <DatePicker
            type='dateTime'
            value={paidAt}
            onChange={setPaidAt}
            style={{ width: '100%' }}
          />
        </div>

        <div className='mt-3'>
          {label(t('服务内容'))}
          <Input value={itemName} onChange={setItemName} />
        </div>

        <div className='mt-3'>
          {label(`${t('备注')}（${t('选填')}）`)}
          <Input
            value={remark}
            onChange={setRemark}
            placeholder={t('如：微信转账后四位 1234')}
          />
        </div>
      </Modal>

      <ReceiptModal
        t={t}
        visible={!!payload}
        manualPayload={payload}
        onCancel={() => setPayload(null)}
      />
    </>
  );
};

export default ManualReceiptModal;
