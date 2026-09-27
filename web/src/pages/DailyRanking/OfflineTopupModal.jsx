import React, { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Modal, Select, Switch, Toast, Typography } from '@douyinfe/semi-ui';
import { API } from '../../helpers';

const { Text } = Typography;

const METHOD_OPTIONS = [
  { value: 'offline', label: '线下转账' },
  { value: 'usdt', label: 'USDT' },
];

export default function OfflineTopupModal({ visible, onCancel, onSuccess, t }) {
  const [userId, setUserId] = useState();
  const [userOptions, setUserOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [money, setMoney] = useState();
  const [method, setMethod] = useState('offline');
  const [creditQuota, setCreditQuota] = useState(true);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setUserId(undefined);
    setUserOptions([]);
    setMoney(undefined);
    setMethod('offline');
    setCreditQuota(true);
    setRemark('');
  }, [visible]);

  const searchUsers = async (keyword) => {
    const q = String(keyword || '').trim();
    if (q.length < 1) {
      setUserOptions([]);
      return;
    }
    setSearching(true);
    try {
      const res = await API.get(
        `/api/user/search?keyword=${encodeURIComponent(q)}&p=1&page_size=20`,
      );
      const items = res?.data?.data?.items || res?.data?.data || [];
      setUserOptions(
        (Array.isArray(items) ? items : []).map((u) => ({
          value: u.id,
          label: `${u.username}  #${u.id}`,
        })),
      );
    } catch {
      setUserOptions([]);
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!userId) {
      Toast.error(t('请选择用户'));
      return;
    }
    if (!(Number(money) >= 0.01)) {
      Toast.error(t('金额必须大于 0.01'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await API.post('/api/user/topup/offline', {
        user_id: userId,
        money: Number(money),
        payment_method: method,
        credit_quota: creditQuota,
        remark,
      });
      if (!res?.data?.success) {
        Toast.error(res?.data?.message || t('创建失败'));
        return;
      }
      const data = res.data.data || {};
      Toast.success(
        creditQuota
          ? t('已入账并记入签到累计') + `  ${data.trade_no || ''}`
          : t('已记订单，未加额度') + `  ${data.trade_no || ''}`,
      );
      onSuccess?.();
    } catch (err) {
      Toast.error(err?.message || t('创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('记线下充值')}
      visible={visible}
      onCancel={onCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel}>{t('取消')}</Button>
          <Button theme='solid' type='primary' loading={submitting} onClick={submit}>
            {t('确认入账')}
          </Button>
        </div>
      }
      width={460}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Text type='tertiary' size='small'>
            {t('用户')}
          </Text>
          <Select
            style={{ width: '100%', marginTop: 6 }}
            filter
            remote
            placeholder={t('搜用户名或 ID')}
            optionList={userOptions}
            value={userId}
            onChange={setUserId}
            onSearch={searchUsers}
            loading={searching}
            emptyContent={t('输入后搜索')}
          />
        </div>
        <div>
          <Text type='tertiary' size='small'>
            {t('金额（USD）')}
          </Text>
          <InputNumber
            style={{ width: '100%', marginTop: 6 }}
            min={0.01}
            step={1}
            precision={2}
            hideButtons
            value={money}
            onChange={setMoney}
            placeholder='例如 50'
          />
        </div>
        <div>
          <Text type='tertiary' size='small'>
            {t('收款方式')}
          </Text>
          <Select
            style={{ width: '100%', marginTop: 6 }}
            optionList={METHOD_OPTIONS}
            value={method}
            onChange={setMethod}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <Text>{t('同时加余额')}</Text>
            <div>
              <Text type='tertiary' size='small'>
                {t('已经后台加过额度的关掉，只补订单给签到用')}
              </Text>
            </div>
          </div>
          <Switch checked={creditQuota} onChange={setCreditQuota} />
        </div>
        <Input
          value={remark}
          onChange={setRemark}
          placeholder={t('备注，可选')}
          maxLength={80}
        />
      </div>
    </Modal>
  );
}
