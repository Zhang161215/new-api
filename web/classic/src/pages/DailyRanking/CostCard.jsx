import React, { useMemo, useState } from 'react';
import { Button, DatePicker, Input, InputNumber, Modal, Select } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { showError, showSuccess } from '../../helpers';
import {
  COST_CATEGORIES,
  costCategoryMeta,
  createOpsCost,
  deleteOpsCost,
  updateOpsCost,
} from './costApi';

const shanghaiYmd = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: pick('year'), m: pick('month'), d: pick('day') };
};

const shanghaiDayStartTs = (value) => {
  const { y, m, d } = shanghaiYmd(new Date(value));
  return Math.floor(
    new Date(
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+08:00`,
    ).getTime() / 1000,
  );
};

const formatCostDate = (ts) => {
  const { y, m, d } = shanghaiYmd(new Date(Number(ts || 0) * 1000));
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
};

const percentText = (value, total) => {
  if (!total) return '—';
  const pct = (Number(value || 0) / total) * 100;
  if (pct > 0 && pct < 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
};

const emptyForm = (start, end) => {
  const now = Date.now() / 1000;
  const date =
    now >= start && now <= end ? new Date() : new Date(Number(end || now) * 1000);
  return {
    id: 0,
    category: 'upstream',
    amount: undefined,
    date,
    note: '',
  };
};

const CostDonut = ({ items, total, center, sub }) => {
  const r = 71.5;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className='donut'>
      <svg viewBox='0 0 160 160'>
        <circle
          cx='80'
          cy='80'
          r={r}
          fill='none'
          stroke='#edf2fa'
          strokeWidth='17'
        />
        {items.map((item) => {
          const length = total ? (item.value / total) * circ : 0;
          const gap = length > 2 ? 1.5 : 0;
          const dash = Math.max(0, length - gap);
          const node = (
            <circle
              key={item.name}
              cx='80'
              cy='80'
              r={r}
              fill='none'
              stroke={item.color}
              strokeWidth='17'
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return node;
        })}
      </svg>
      <div className='donut-center'>
        <strong className='num'>{center}</strong>
        <span>{sub}</span>
      </div>
    </div>
  );
};

const CostCard = ({
  items = [],
  start = 0,
  end = 0,
  formatMoney,
  onChanged,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => emptyForm(start, end));

  const periodItems = useMemo(
    () =>
      items.filter((item) => {
        const ts = Number(item.occurred_at || 0);
        return ts >= start && ts <= end;
      }),
    [items, start, end],
  );

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(b.occurred_at || 0) - Number(a.occurred_at || 0) ||
          Number(b.id || 0) - Number(a.id || 0),
      ),
    [items],
  );

  const periodTotal = periodItems.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const grouped = COST_CATEGORIES.map((meta) => ({
    name: meta.label,
    value: periodItems
      .filter((item) => item.category === meta.value)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    color: meta.color,
  })).filter((item) => item.value > 0);

  const openModal = (record) => {
    if (record) {
      setForm({
        id: record.id,
        category: record.category || 'other',
        amount: Number(record.amount || 0),
        date: new Date(Number(record.occurred_at || 0) * 1000),
        note: record.note || '',
      });
    } else {
      setForm(emptyForm(start, end));
    }
    setOpen(true);
  };

  const submit = async () => {
    const amount = Number(form.amount || 0);
    if (!form.category) {
      showError(t('请选择成本类别'));
      return;
    }
    if (!(amount > 0)) {
      showError(t('请填写大于 0 的金额'));
      return;
    }
    if (!form.date) {
      showError(t('请选择发生日期'));
      return;
    }
    setSaving(true);
    const payload = {
      category: form.category,
      amount,
      occurred_at: shanghaiDayStartTs(form.date),
      note: String(form.note || '').trim(),
      title: costCategoryMeta(form.category).label,
    };
    try {
      if (form.id) {
        await updateOpsCost({ ...payload, id: form.id });
        showSuccess(t('已更新'));
      } else {
        await createOpsCost(payload);
        showSuccess(t('已记账'));
      }
      setForm(emptyForm(start, end));
      await onChanged?.();
    } catch (err) {
      showError(err.message || err);
    } finally {
      setSaving(false);
    }
  };

  const remove = (record) => {
    Modal.confirm({
      title: t('删除这条成本？'),
      content: `${costCategoryMeta(record.category).label} ${formatMoney(record.amount)}`,
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        try {
          await deleteOpsCost(record.id);
          showSuccess(t('已删除'));
          await onChanged?.();
        } catch (err) {
          showError(err.message || err);
        }
      },
    });
  };

  return (
    <>
      <article className='card ratio-card cost-card'>
        <div className='panel-head'>
          <div>
            <h2 className='panel-title'>{t('成本记录')}</h2>
            <p className='panel-sub'>{t('上游、服务器等实际支出，按页面日期汇总')}</p>
          </div>
          <button className='ops-text-button' type='button' onClick={() => openModal()}>
            {t('记一笔')}
          </button>
        </div>
        <div className='ratio-content'>
          {grouped.length ? (
            <>
              <CostDonut
                items={grouped}
                total={periodTotal}
                center={formatMoney(periodTotal)}
                sub={t('本期支出')}
              />
              <div className='ratio-legend'>
                {grouped.map((item) => (
                  <div className='ratio-row' key={item.name}>
                    <i className='dot' style={{ background: item.color }} />
                    <span className='ratio-label'>{item.name}</span>
                    <span className='ratio-value num'>
                      {percentText(item.value, periodTotal)}
                    </span>
                    <span className='ratio-amount num'>{formatMoney(item.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className='empty-state' style={{ gridColumn: '1 / -1' }}>
              {t('该时段暂无成本记录')}
            </div>
          )}
        </div>
        <div className='ratio-footer'>
          <span>
            {items.length > periodItems.length
              ? `${t('全部')} ${items.length} ${t('笔')}，${t('当前日期')} ${periodItems.length} ${t('笔')}`
              : t('只统计当前所选日期')}
          </span>
          <strong>
            {periodItems.length} {t('笔')} · {formatMoney(periodTotal)}
          </strong>
        </div>
      </article>

      <Modal
        title={form.id ? t('编辑成本') : t('记一笔成本')}
        visible={open}
        onCancel={() => setOpen(false)}
        width={640}
        centered
        footer={
          <div className='ops-cost-footer'>
            <Button onClick={() => setOpen(false)}>{t('关闭')}</Button>
            <Button type='primary' theme='solid' loading={saving} onClick={submit}>
              {form.id ? t('保存') : t('添加')}
            </Button>
          </div>
        }
      >
        <div className='ops-cost-form'>
          <Select
            value={form.category}
            optionList={COST_CATEGORIES.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
            onChange={(value) => setForm((prev) => ({ ...prev, category: value }))}
            style={{ width: 148 }}
          />
          <InputNumber
            value={form.amount}
            min={0.01}
            max={10000000}
            step={1}
            prefix='$'
            hideButtons
            placeholder={t('金额')}
            onChange={(value) => setForm((prev) => ({ ...prev, amount: value }))}
            style={{ width: 140 }}
          />
          <DatePicker
            type='date'
            format='yyyy-MM-dd'
            value={form.date}
            onChange={(value) => setForm((prev) => ({ ...prev, date: value }))}
            style={{ width: 150 }}
          />
          <Input
            value={form.note}
            maxLength={200}
            placeholder={t('备注，如 OpenRouter / 东京机器')}
            onChange={(value) => setForm((prev) => ({ ...prev, note: value }))}
          />
        </div>
        <div className='ops-cost-list-head'>
          <span>
            {t('全部')} {items.length} {t('笔')}
            {items.length !== periodItems.length
              ? ` · ${t('当前日期内')} ${periodItems.length} ${t('笔')}`
              : ''}
          </span>
        </div>
        {sortedItems.length ? (
          <div className='ops-cost-list'>
            {sortedItems.map((item, index) => {
              const meta = costCategoryMeta(item.category);
              const inPeriod =
                Number(item.occurred_at || 0) >= start &&
                Number(item.occurred_at || 0) <= end;
              return (
                <div
                  className={`ops-cost-row${inPeriod ? '' : ' is-outside'}`}
                  key={`${item.id}-${index}`}
                >
                  <i className='dot' style={{ background: meta.color }} />
                  <div className='ops-cost-main'>
                    <strong>{meta.label}</strong>
                    {item.note ? <em>{item.note}</em> : null}
                  </div>
                  <span className='num ops-cost-date'>
                    {formatCostDate(item.occurred_at)}
                  </span>
                  <strong className='num ops-cost-amount'>
                    {formatMoney(item.amount)}
                  </strong>
                  <div className='ops-cost-actions'>
                    <button type='button' onClick={() => openModal(item)}>
                      {t('改')}
                    </button>
                    <button type='button' onClick={() => remove(item)}>
                      {t('删')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className='empty-state' style={{ padding: '18px 0' }}>
            {t('还没有成本记录')}
          </div>
        )}
      </Modal>
    </>
  );
};

export default CostCard;
