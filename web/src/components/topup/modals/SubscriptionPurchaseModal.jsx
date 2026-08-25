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
  Modal,
  Typography,
  Card,
  Button,
  Divider,
  Tooltip,
} from '@douyinfe/semi-ui';
import {
  Crown,
  CalendarClock,
  Package,
  Gauge,
  Wallet,
  RotateCcw,
  Ban,
  ChevronLeft,
} from 'lucide-react';
import { SiStripe, SiWechat, SiAlipay } from 'react-icons/si';
import { IconCreditCard } from '@douyinfe/semi-icons';
import { renderQuota } from '../../../helpers';
import { getCurrencyConfig } from '../../../helpers/render';
import {
  formatSubscriptionDuration,
  formatSubscriptionResetPeriod,
} from '../../../helpers/subscriptionFormat';
import { DEFAULT_SUBSCRIPTION_AGREEMENT } from '../../../constants';
import MarkdownRenderer from '../../common/markdown/MarkdownRenderer';

const { Text } = Typography;

// 倍率去掉无意义的尾随零：1 → "1"、0.20 → "0.2"、0.125 → "0.125"
const formatRatio = (value) => String(Number(Number(value).toFixed(6)));

// 后端用 -1 表示「该套餐不适用此倍率」（不升级分组，或分组未配倍率）
const hasRatio = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

// 订阅使用说明的单行条目
const InfoLine = ({ icon: Icon, children }) => (
  <div className='flex items-start gap-2'>
    <Icon size={14} className='mt-[3px] shrink-0 text-slate-500' />
    <Text size='small' className='text-slate-700 dark:text-slate-200'>
      {children}
    </Text>
  </div>
);

const SubscriptionPurchaseModal = ({
  t,
  visible,
  onCancel,
  selectedPlan,
  paying,
  selectedEpayMethod,
  setSelectedEpayMethod,
  epayMethods = [],
  enableOnlineTopUp = false,
  enableStripeTopUp = false,
  enableCreemTopUp = false,
  enableXunhuTopUp = false,
  purchaseLimitInfo = null,
  agreementText = '',
  onPayStripe,
  onPayCreem,
  onPayEpay,
  onPayXunhu,
}) => {
  const plan = selectedPlan?.plan;
  const totalAmount = Number(plan?.total_amount || 0);
  const { symbol, rate } = getCurrencyConfig();
  const price = plan ? Number(plan.price_amount || 0) : 0;
  const convertedPrice = price * rate;
  const displayPrice = convertedPrice.toFixed(
    Number.isInteger(convertedPrice) ? 0 : 2,
  );

  // 分两步：先看说明+协议，点「同意并继续」后才出现支付方式。
  // 每次打开都回到 agreement —— 「禁止分发」这类条款每次购买都要重新告知。
  const [step, setStep] = useState('agreement');
  useEffect(() => {
    if (visible) {
      setStep('agreement');
    }
  }, [visible]);

  // 只有当管理员开启支付网关 AND 套餐配置了对应的支付ID时才显示。
  // Stripe 的屏蔽统一在父组件 topup/index.jsx 里做（那里会把开关置 false
  // 并从 payMethods 剔除），此处无需再判断，避免两处控制同一件事。
  const hasStripe = enableStripeTopUp && !!plan?.stripe_price_id;
  const hasCreem = enableCreemTopUp && !!plan?.creem_product_id;
  const hasEpay = enableOnlineTopUp && epayMethods.length > 0;
  const hasXunhu = enableXunhuTopUp;
  const hasAnyPayment = hasStripe || hasCreem || hasEpay || hasXunhu;
  const purchaseLimit = Number(purchaseLimitInfo?.limit || 0);
  const purchaseCount = Number(purchaseLimitInfo?.count || 0);
  const purchaseLimitReached =
    purchaseLimit > 0 && purchaseCount >= purchaseLimit;

  // 两档倍率由后端按套餐下发（不能读 /api/pricing —— 那里会按可用分组过滤，
  // 未订阅用户拿不到升级分组的倍率）。定义与 switchRatioForFundingFallback 一致。
  const subRatio = selectedPlan?.subscription_ratio;
  const fallbackRatio = selectedPlan?.fallback_ratio;
  const showSubRatio = hasRatio(subRatio);
  const showFallbackRatio = hasRatio(fallbackRatio);
  // 两档相同 = 回落钱包时倍率不发生切换，此时并列两个相同数字反而让人困惑
  const ratioSwitches =
    showSubRatio && showFallbackRatio && Number(subRatio) !== Number(fallbackRatio);
  const resetPeriod = plan ? formatSubscriptionResetPeriod(plan, t) : '';
  const hasReset = resetPeriod && resetPeriod !== t('不重置');

  const purchaseLimitBanner = purchaseLimitReached ? (
    <Banner
      type='warning'
      description={`${t('已达到购买上限')} (${purchaseCount}/${purchaseLimit})`}
      className='!rounded-xl'
      closeIcon={null}
    />
  ) : null;

  const isAgreement = step === 'agreement';

  // 主按钮放在 footer 而非 body：body 会随协议长度滚动，
  // 放里面的话矮屏（如 620px 高）上按钮会被挤出可视区、点不到。
  //
  // 不设独立的勾选框 —— 点「同意并继续」本身即表示同意，按钮上方
  // 用一行小字说明。多一次勾选并不增加约束力，只是多一步操作。
  //
  // !ml-0 是必需的：Semi 给 footer 内的按钮加了 margin-left:12px（用于
  // 多按钮间距），碰上 block 全宽按钮就变成整体右推 12px 并顶出 footer 边界。
  const agreementFooter = (
    <div className='space-y-2 pt-1'>
      <Button
        theme='solid'
        type='primary'
        block
        className='!ml-0'
        disabled={purchaseLimitReached || !hasAnyPayment}
        onClick={() => setStep('payment')}
      >
        {t('同意并继续')}
      </Button>
      <div className='text-center'>
        <Text size='small' type='tertiary'>
          {t('点击即表示您已阅读并同意《订阅服务协议》')}
        </Text>
      </div>
    </div>
  );

  return (
    <Modal
      title={
        <div className='flex items-center'>
          <Crown className='mr-2' size={18} />
          {isAgreement ? t('订阅说明与协议') : t('购买订阅套餐')}
        </div>
      }
      visible={visible}
      onCancel={onCancel}
      footer={plan && isAgreement ? agreementFooter : null}
      // 协议步要放整篇条款，small(448px) 显得又窄又长；支付步内容少，
      // 保持原宽度避免几个支付按钮被拉散。
      width={isAgreement ? 580 : 448}
      centered
      // 协议正文长度不可控（管理员可自定义），不封顶会把弹窗顶出屏幕外。
      // 减去的是标题栏 + footer + 上下留白的大致占位。
      // 支付步没有 footer，靠 paddingBottom 撑出底部留白，否则按钮会贴死在弹窗边缘。
      bodyStyle={{
        maxHeight: 'calc(100vh - 260px)',
        overflowY: 'auto',
        paddingBottom: isAgreement ? undefined : 20,
      }}
    >
      {plan ? (
        <div className='space-y-3'>
          {isAgreement ? (
            /* 协议步只给一行摘要：这一步用户在读规则，完整的订单核对
               放到支付步。省下的高度留给协议正文。 */
            <div className='flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2'>
              <Typography.Text
                ellipsis={{ rows: 1, showTooltip: true }}
                strong
                className='text-slate-800 dark:text-slate-100'
                style={{ maxWidth: 220 }}
              >
                {plan.title}
              </Typography.Text>
              <Text strong className='text-lg text-purple-600 shrink-0'>
                {symbol}
                {displayPrice}
              </Text>
            </div>
          ) : (
            /* 支付步：完整套餐信息，付款前最后一次核对 */
            <Card className='!rounded-xl !border-0 bg-slate-50 dark:bg-slate-800'>
              <div className='space-y-3'>
                <div className='flex justify-between items-center'>
                  <Text strong className='text-slate-700 dark:text-slate-200'>
                    {t('套餐名称')}：
                  </Text>
                  <Typography.Text
                    ellipsis={{ rows: 1, showTooltip: true }}
                    className='text-slate-900 dark:text-slate-100'
                    style={{ maxWidth: 200 }}
                  >
                    {plan.title}
                  </Typography.Text>
                </div>
                <div className='flex justify-between items-center'>
                  <Text strong className='text-slate-700 dark:text-slate-200'>
                    {t('有效期')}：
                  </Text>
                  <div className='flex items-center'>
                    <CalendarClock size={14} className='mr-1 text-slate-500' />
                    <Text className='text-slate-900 dark:text-slate-100'>
                      {formatSubscriptionDuration(plan, t)}
                    </Text>
                  </div>
                </div>
                {hasReset && (
                  <div className='flex justify-between items-center'>
                    <Text strong className='text-slate-700 dark:text-slate-200'>
                      {t('重置周期')}：
                    </Text>
                    <Text className='text-slate-900 dark:text-slate-100'>
                      {resetPeriod}
                    </Text>
                  </div>
                )}
                <div className='flex justify-between items-center'>
                  <Text strong className='text-slate-700 dark:text-slate-200'>
                    {t('总额度')}：
                  </Text>
                  <div className='flex items-center'>
                    <Package size={14} className='mr-1 text-slate-500' />
                    {totalAmount > 0 ? (
                      <Tooltip content={`${t('原生额度')}：${totalAmount}`}>
                        <Text className='text-slate-900 dark:text-slate-100'>
                          {renderQuota(totalAmount)}
                        </Text>
                      </Tooltip>
                    ) : (
                      <Text className='text-slate-900 dark:text-slate-100'>
                        {t('不限')}
                      </Text>
                    )}
                  </div>
                </div>
                {plan?.upgrade_group ? (
                  <div className='flex justify-between items-center'>
                    <Text strong className='text-slate-700 dark:text-slate-200'>
                      {t('升级分组')}：
                    </Text>
                    <Text className='text-slate-900 dark:text-slate-100'>
                      {plan.upgrade_group}
                    </Text>
                  </div>
                ) : null}
                <Divider margin={8} />
                <div className='flex justify-between items-center'>
                  <Text strong className='text-slate-700 dark:text-slate-200'>
                    {t('应付金额')}：
                  </Text>
                  <Text strong className='text-xl text-purple-600'>
                    {symbol}
                    {displayPrice}
                  </Text>
                </div>
              </div>
            </Card>
          )}

          {purchaseLimitBanner}

          {isAgreement ? (
            <div className='space-y-3'>
              {/* 订阅使用说明：数字全部来自后端下发，不硬编码，
                  避免改倍率配置后文案与实际计费脱节。
                  标题内嵌在框里，省掉一行独立标签的高度。 */}
              <div className='space-y-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2.5'>
                <Text size='small' type='tertiary'>
                  {t('订阅使用说明')}
                </Text>
                {showSubRatio && (
                  <InfoLine icon={Gauge}>
                    {t('订阅额度按')}{' '}
                    <Text strong className='text-purple-600'>
                      {formatRatio(subRatio)}x
                    </Text>{' '}
                    {t('倍率消耗')}
                  </InfoLine>
                )}
                <InfoLine icon={Wallet}>
                  {/* 不用「常规/特殊倍率」这类定性词：这里的 1x 其实是未配倍率时的
                      默认值，而 0.2x 才是管理员为该分组配的值 —— 把 0.2 说成
                      「常规」会让用户以为回落是降级，与事实相反。只陈述数字来源。 */}
                  {ratioSwitches ? (
                    <>
                      {t('额度用尽后自动改用钱包余额，按')}
                      {plan?.upgrade_group ? ` ${plan.upgrade_group} ` : ''}
                      {t('分组倍率')}{' '}
                      <Text strong className='text-green-600'>
                        {formatRatio(fallbackRatio)}x
                      </Text>{' '}
                      {t('计费')}
                    </>
                  ) : (
                    t('额度用尽后自动改用钱包余额继续计费')
                  )}
                </InfoLine>
                {hasReset && (
                  <InfoLine icon={RotateCcw}>
                    {t('额度以购买日为锚点')}
                    {resetPeriod}
                    {t('重置，未用完的部分不累计')}
                  </InfoLine>
                )}
                {plan?.upgrade_group ? (
                  <InfoLine icon={CalendarClock}>
                    {t('订阅到期后账号分组自动回落至购买前的分组')}
                  </InfoLine>
                ) : null}
                <InfoLine icon={Ban}>
                  <Text strong type='danger'>
                    {t('订阅仅限本人使用，禁止转售、分发或共享账号与 API Key')}
                  </Text>
                </InfoLine>
              </div>

              {/* 协议正文自带滚动条：管理员可换成任意长度的文案，
                  不封顶就会把下面的勾选框和按钮挤出可视区。 */}
              <div
                className='rounded-xl'
                style={{ border: '1px solid var(--semi-color-border)' }}
              >
                <div className='px-3 pt-2'>
                  <Text size='small' type='tertiary'>
                    {t('订阅服务协议')}
                  </Text>
                </div>
                <div
                  className='overflow-y-auto px-3 pb-2'
                  style={{ maxHeight: 260 }}
                >
                  <MarkdownRenderer
                    content={agreementText || DEFAULT_SUBSCRIPTION_AGREEMENT}
                  />
                </div>
              </div>

              {!hasAnyPayment && (
                <Banner
                  type='info'
                  description={t(
                    '管理员未开启在线支付功能，请联系管理员配置。',
                  )}
                  className='!rounded-xl'
                  closeIcon={null}
                />
              )}
            </div>
          ) : (
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <Text size='small' type='tertiary'>
                  {t('选择支付方式')}：
                </Text>
                <Button
                  theme='borderless'
                  type='tertiary'
                  size='small'
                  icon={<ChevronLeft size={14} />}
                  onClick={() => setStep('agreement')}
                >
                  {t('返回')}
                </Button>
              </div>

              {/* Stripe / Creem */}
              {(hasStripe || hasCreem) && (
                <div className='flex gap-2'>
                  {hasStripe && (
                    <Button
                      theme='light'
                      className='flex-1'
                      icon={<SiStripe size={14} color='#635BFF' />}
                      onClick={onPayStripe}
                      loading={paying}
                      disabled={purchaseLimitReached}
                    >
                      Stripe
                    </Button>
                  )}
                  {hasCreem && (
                    <Button
                      theme='light'
                      className='flex-1'
                      icon={<IconCreditCard />}
                      onClick={onPayCreem}
                      loading={paying}
                      disabled={purchaseLimitReached}
                    >
                      Creem
                    </Button>
                  )}
                </div>
              )}

              {/* 虎皮椒微信支付 */}
              {hasXunhu && (
                <Button
                  theme='light'
                  block
                  icon={<SiWechat size={14} color='#07C160' />}
                  onClick={onPayXunhu}
                  loading={paying}
                  disabled={purchaseLimitReached}
                >
                  {t('微信支付')}
                </Button>
              )}

              {/* 易支付：图标卡片式选择，与充值页 RechargeCard 的样式保持一致。
                  原先是 Select 下拉 + 支付按钮，只有一个支付宝时也要先展开下拉，
                  多一次无意义的点击且看不出是什么支付方式。 */}
              {hasEpay && (
                <div className='space-y-2'>
                  <div className='flex flex-wrap gap-2'>
                    {epayMethods.map((m) => {
                      const active = selectedEpayMethod === m.type;
                      return (
                        <Button
                          key={m.type}
                          theme={active ? 'solid' : 'outline'}
                          type={active ? 'primary' : 'tertiary'}
                          onClick={() => setSelectedEpayMethod(m.type)}
                          disabled={purchaseLimitReached}
                          icon={
                            m.type === 'alipay' ? (
                              <SiAlipay
                                size={18}
                                color={active ? '#fff' : '#1677FF'}
                              />
                            ) : m.type === 'wxpay' ? (
                              <SiWechat
                                size={18}
                                color={active ? '#fff' : '#07C160'}
                              />
                            ) : (
                              <IconCreditCard />
                            )
                          }
                          className='!rounded-lg !px-4'
                        >
                          {m.name || m.type}
                        </Button>
                      );
                    })}
                  </div>
                  <Button
                    theme='solid'
                    type='primary'
                    block
                    onClick={onPayEpay}
                    loading={paying}
                    disabled={!selectedEpayMethod || purchaseLimitReached}
                  >
                    {selectedEpayMethod
                      ? `${t('立即支付')} ${symbol}${displayPrice}`
                      : t('请选择支付方式')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
};

export default SubscriptionPurchaseModal;
