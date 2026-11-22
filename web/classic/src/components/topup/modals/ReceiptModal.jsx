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

import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Spin, Empty, Toast } from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { Printer } from 'lucide-react';
import { API, timestamp2string } from '../../../helpers';
import { PAYMENT_METHOD_MAP } from '../../../constants';
import { useIsMobile } from '../../../hooks/common/useIsMobile';

/**
 * 收款收据弹窗。
 *
 * 收据 ≠ 发票：这只是付款凭证，不涉及税务，所以没有税号，也不盖章
 * （无营业执照的个人本就无法合法拥有公章，伪造是刑事风险）。
 *
 * 预览与打印刻意共用同一份 iframe 文档：
 *   1. 打印直接调 iframe.contentWindow.print()，浏览器只排版这份文档，
 *      不必写 `@media print { body > *:not(...) { display:none } }` 那种
 *      去跟 Semi 的 Modal portal 抢可见性的脆弱 CSS；
 *   2. 用户看到的就是打印出来的，不存在"预览和纸面不一致"。
 */

// 收据内容全部来自用户可控字段（用户名、显示名、邮箱），拼进 HTML 前必须转义，
// 否则 iframe 里就是一个 XSS 落点。
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch],
  );

// 冷门币种后端不硬猜符号（symbol 为空），这时回退成显示币种代码。
// 金额格式化。冷门币种后端不硬猜符号（symbol 为空），这时回退成显示币种代码。
const formatMoney = (amount, data) => {
  const v = Number(amount || 0).toFixed(2);
  return data?.currency_symbol
    ? `${data.currency_symbol}${v}`
    : `${data?.currency_code || ''} ${v}`.trim();
};

const payMethodLabel = (pm, t) =>
  t(PAYMENT_METHOD_MAP[pm] || pm || '-');

const RECEIPT_CSS = `
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #1f2328;
    font: 14px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased; }
  .sheet { max-width: 580px; margin: 0 auto; padding: 26px 28px 22px; }
  .hd { display: flex; justify-content: space-between; align-items: flex-start;
    gap: 16px; padding-bottom: 13px; border-bottom: 2px solid #1f2328; }
  .site { font-size: 17px; font-weight: 700; line-height: 1.35; }
  .site .url { margin-top: 3px; font-size: 12px; font-weight: 400; color: #6b7280; }
  .hd .right { text-align: right; white-space: nowrap; }
  .ttl { font-size: 19px; font-weight: 700; letter-spacing: 3px; }
  .no { margin-top: 4px; font-size: 11px; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 9px 0; text-align: left; vertical-align: top;
    border-bottom: 1px solid #e9ebef; }
  th { width: 92px; font-weight: 400; color: #6b7280; white-space: nowrap; }
  td { word-break: break-all; }
  /* 合并收据的逐笔明细表：表头一行 + 每笔一行，金额右对齐好竖着核 */
  .items { margin-top: 14px; }
  .items table { margin-top: 0; }
  .items thead th { width: auto; padding-bottom: 7px; font-size: 11px;
    color: #6b7280; border-bottom: 1px solid #1f2328; }
  .items thead th.r, .items td.r { text-align: right; }
  .items tbody td { padding: 8px 0; font-size: 13px; }
  .items tbody td.no { color: #6b7280; font-size: 11px; }
  .items .cnt { margin-top: 7px; font-size: 11px; color: #6b7280; }
  .total { display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 16px; padding: 13px 16px; background: #f6f7f9; border-radius: 6px; }
  .total .lbl { font-size: 13px; color: #6b7280; }
  .total .val { font-size: 23px; font-weight: 700; letter-spacing: .5px; }
  .ft { margin-top: 18px; padding-top: 11px; border-top: 1px dashed #d1d5db;
    font-size: 11px; line-height: 1.9; color: #6b7280; }
  .ft .warn { color: #b45309; font-weight: 600; }
  @media print {
    /* 不加这行，灰色底纹和提示文字的颜色在打印时会被浏览器丢掉 */
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* 只去掉屏幕用的外边距，max-width 必须保留 ——
       早先写成 max-width:none 时收据在纸上被拉满整页宽，
       「收款金额」和金额被推到纸张两端，中间空一大片（实测确认）。
       @page 已经给了 18mm 页边距，这里不需要再留 padding。 */
    .sheet { padding: 0; }
  }
`;

// 单笔与合并两种收据共用同一张纸的骨架（页眉 / 合计 / 页脚），
// 只有中间那块不同 —— 抽出来是为了让 CSS 与免责声明只有一份。
const wrapDoc = ({ data, t, bodyHtml, totalMoney }) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(t('收款收据'))} ${esc(data.receipt_no)}</title>
<style>${RECEIPT_CSS}</style></head>
<body><div class="sheet">
  <div class="hd">
    <div class="site">${esc(data.site_name)}
      ${data.site_url ? `<div class="url">${esc(data.site_url)}</div>` : ''}
    </div>
    <div class="right">
      <div class="ttl">${esc(t('收款收据'))}</div>
      <div class="no">No. ${esc(data.receipt_no)}</div>
    </div>
  </div>
  ${bodyHtml}
  <div class="total">
    <span class="lbl">${esc(t('收款金额'))}</span>
    <span class="val">${esc(formatMoney(totalMoney, data))}</span>
  </div>
  <div class="ft">
    <span class="warn">${esc(t('本收据为付款凭证，非增值税发票。'))}</span><br>
    ${esc(t('开具时间'))}：${esc(timestamp2string(data.issued_at))}
  </div>
</div></body></html>`;

const buildSingleReceiptHtml = (data, t) => {
  const rows = [
    [t('付款人'), esc(data.payer_name)],
    ...(data.payer_email ? [[t('邮箱'), esc(data.payer_email)]] : []),
    // item_name 由后端给中文（"API 额度充值"/"订阅套餐"），本项目 zh 文案即 i18n key，
    // 所以这里过一遍 t() 才能让英文界面的收据也是英文
    [t('服务内容'), esc(t(data.item_name))],
    // amount 是以美元计价的额度数量（见后端 TopUpReceipt 注释）；
    // 订阅套餐订单与手工开具的收据为 0，这一行整体不渲染。
    ...(Number(data.amount) > 0
      ? [[t('充值额度'), `$${esc(data.amount)}`]]
      : []),
    [t('支付方式'), esc(payMethodLabel(data.payment_method, t))],
    [t('支付时间'), esc(timestamp2string(data.paid_at))],
    // 手工开具（线下转账）没有系统订单号，这一行不渲染
    ...(data.trade_no ? [[t('订单号'), esc(data.trade_no)]] : []),
    ...(data.remark ? [[t('备注'), esc(data.remark)]] : []),
  ];

  const bodyHtml = `<table><tbody>
    ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('\n    ')}
  </tbody></table>`;

  return wrapDoc({ data, t, bodyHtml, totalMoney: data.money });
};

const buildMergedReceiptHtml = (data, t) => {
  const items = data.items || [];
  // 明细只写「月-日」：合并收据的付款区间已经在上方给了完整年份，
  // 每行再重复一遍年份会把这张表挤得很拥挤。
  const shortDate = (ts) => timestamp2string(ts).slice(5, 16);

  const headRows = [
    [t('付款人'), esc(data.payer_name)],
    ...(data.payer_email ? [[t('邮箱'), esc(data.payer_email)]] : []),
    [
      t('付款区间'),
      `${esc(timestamp2string(data.period_start).slice(0, 10))} ~ ${esc(
        timestamp2string(data.period_end).slice(0, 10),
      )}`,
    ],
  ];

  const bodyHtml = `<table><tbody>
    ${headRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('\n    ')}
  </tbody></table>
  <div class="items">
    <table>
      <thead><tr>
        <th>${esc(t('支付时间'))}</th>
        <th>${esc(t('订单号'))}</th>
        <th>${esc(t('服务内容'))}</th>
        <th class="r">${esc(t('金额'))}</th>
      </tr></thead>
      <tbody>
        ${items
          .map(
            (it) => `<tr>
          <td class="no">${esc(shortDate(it.paid_at))}</td>
          <td class="no">${esc(it.trade_no)}</td>
          <td>${esc(t(it.item_name))}</td>
          <td class="r">${esc(formatMoney(it.money, data))}</td>
        </tr>`,
          )
          .join('\n        ')}
      </tbody>
    </table>
    <div class="cnt">${esc(t('共'))} ${items.length} ${esc(t('笔'))}</div>
  </div>`;

  return wrapDoc({ data, t, bodyHtml, totalMoney: data.total_money });
};

// iframe 高度上限。单笔收据（7 行）约 560px，一次装得下；
// 合并十几笔时会超过上限、回到 iframe 内滚动 —— 这是有意的，
// 弹窗不能无限长。打印出来仍是完整多页，不受这个上限影响。
const MAX_FRAME_HEIGHT = 720;

/**
 * 三种形态：
 *   tradeNo       → 单笔收据
 *   tradeNos      → 多笔合并收据
 *   manualPayload → 手工开具（线下转账，系统里没有订单）
 * 优先级：manualPayload > tradeNos > tradeNo。
 */
const ReceiptModal = ({
  visible,
  onCancel,
  tradeNo,
  tradeNos,
  manualPayload,
  t,
}) => {
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState('');
  const [frameHeight, setFrameHeight] = useState(480);
  const iframeRef = useRef(null);
  const isMobile = useIsMobile();

  // 数组是每次渲染新建的引用，直接进 deps 会让 effect 每帧重跑。
  // 序列化成字符串当依赖，内容不变就不重新请求。
  const mergeKey = Array.isArray(tradeNos) && tradeNos.length ? tradeNos.join(',') : '';
  // 同理，对象字面量每次渲染都是新引用，序列化后当依赖
  const manualKey = manualPayload ? JSON.stringify(manualPayload) : '';

  useEffect(() => {
    if (!visible) return;
    if (!manualKey && !mergeKey && !tradeNo) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setHtml('');
      // 换单时重置高度，否则新收据会先按上一张的高度渲染再跳一下
      setFrameHeight(480);
      try {
        let res;
        if (manualKey) {
          res = await API.post(
            '/api/user/receipt/manual',
            JSON.parse(manualKey),
          );
        } else if (mergeKey) {
          res = await API.post('/api/user/topup/receipt/merge', {
            trade_nos: mergeKey.split(','),
          });
        } else {
          res = await API.get(
            `/api/user/topup/receipt/${encodeURIComponent(tradeNo)}`,
          );
        }
        if (cancelled) return;
        const { success, message, data } = res.data;
        if (success) {
          // 手工开具走单笔版式（它就是一笔收款，只是没有系统订单号）
          setHtml(
            mergeKey
              ? buildMergedReceiptHtml(data, t)
              : buildSingleReceiptHtml(data, t),
          );
        } else {
          Toast.error({ content: message || t('获取收据失败') });
        }
      } catch (e) {
        if (!cancelled) Toast.error({ content: t('获取收据失败') });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    // 关掉弹窗时把在途请求的结果丢弃，避免 setState on unmounted
    return () => {
      cancelled = true;
    };
  }, [visible, tradeNo, mergeKey, manualKey, t]);

  // 让 iframe 贴合内容高度。固定高会在收据略长时出现内层滚动条，
  // 用户第一眼看到的是被截断的收据（实测：固定 480px 时标题被卷上去了）。
  // srcDoc + allow-same-origin 才读得到 contentDocument。
  const handleFrameLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const h = Math.ceil(
      doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 0,
    );
    // +2 容下 1px 上下边框，否则临界值仍会冒出滚动条
    if (h > 0) setFrameHeight(Math.min(h + 2, MAX_FRAME_HEIGHT));
  };

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // 先 focus 再 print：Safari 下不 focus 会打印宿主页面而不是 iframe
    win.focus();
    win.print();
  };

  return (
    <Modal
      title={t('收款收据')}
      visible={visible}
      onCancel={onCancel}
      size={isMobile ? 'full-width' : 'medium'}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onCancel}>{t('关闭')}</Button>
          <Button
            type='primary'
            theme='solid'
            icon={<Printer size={16} />}
            disabled={!html}
            onClick={handlePrint}
          >
            {t('打印 / 保存为 PDF')}
          </Button>
        </div>
      }
    >
      <Spin spinning={loading}>
        {html ? (
          <iframe
            ref={iframeRef}
            title={t('收款收据')}
            srcDoc={html}
            onLoad={handleFrameLoad}
            // sandbox 不加 allow-modals 的话 print() 会被静默拦掉
            sandbox='allow-same-origin allow-modals'
            style={{
              width: '100%',
              height: frameHeight,
              border: '1px solid var(--semi-color-border)',
              borderRadius: 6,
              background: '#fff',
            }}
          />
        ) : (
          !loading && (
            <Empty
              image={
                <IllustrationNoResult style={{ width: 130, height: 130 }} />
              }
              darkModeImage={
                <IllustrationNoResultDark style={{ width: 130, height: 130 }} />
              }
              description={t('暂无收据')}
              style={{ padding: 24 }}
            />
          )
        )}
      </Spin>
    </Modal>
  );
};

export default ReceiptModal;
