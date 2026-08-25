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
  Card,
  Calendar,
  Button,
  Typography,
  Avatar,
  Spin,
  Tooltip,
  Collapsible,
  Modal,
  Banner,
} from '@douyinfe/semi-ui';
import {
  CalendarCheck,
  Gift,
  ChevronDown,
  ChevronUp,
  Wallet,
} from 'lucide-react';
import Turnstile from 'react-turnstile';
import { API, showError, showSuccess, renderQuota } from '../../../../helpers';
import {
  ChestClosed,
  ChestOpen,
  PixelSparkle,
  PixelTag,
} from './TreasureChest';
import CheckinRewardModal from './CheckinRewardModal';

// 倍数去掉无意义的尾随零：2 → "2"、1.5 → "1.5"
const formatMultiplier = (v) => String(Number(Number(v || 0).toFixed(2)));

// renderQuota 会把小数补齐到指定位数，$0.000000 这种既占地方又难读。
// 这里去掉无意义的尾随零、但至少保留 2 位小数：
//   0 → $0.00      0.5 → $0.50      0.002 → $0.002     1.2345 → $1.2345
// 之所以不直接用 renderQuota(v, 2)：默认签到额度是 $0.002~$0.02 这个量级，
// 砍成两位会全部显示成 $0.00。
// 注意 quota_display_type=TOKENS 时 renderQuota 返回的是不带小数点的整数，
// 正则匹配不上会原样返回，正是想要的行为。
const formatAward = (quota) => {
  // 先用高精度探一次量级。只看数值大小，不直接拿去显示。
  const probe = String(renderQuota(quota, 6));
  const m = probe.match(/^(\D*)([\d,]+)\.(\d+)$/);
  // quota_display_type=TOKENS 时 renderQuota 返回不带小数点的整数，原样返回
  if (!m) return probe;
  const num = Number(`${m[2].replace(/,/g, '')}.${m[3]}`);
  // >= 0.01 两位就够（$1.741536 这种六位小数读起来很蠢）；
  // 更小的额度留 4 位 —— 默认配置是 $0.002 量级，砍成两位会全变 $0.00。
  // 位数交给 renderQuota 处理，它自带「四舍五入后为 0 则显示最小可见值」的兜底。
  return renderQuota(quota, num >= 0.01 ? 2 : 4);
};

const CheckinCalendar = ({ t, status, turnstileEnabled, turnstileSiteKey }) => {
  const [loading, setLoading] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [turnstileModalVisible, setTurnstileModalVisible] = useState(false);
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0);
  // 开箱弹窗。amountText 在签到成功那一刻定格，不跟随后续状态刷新变化。
  const [reward, setReward] = useState({
    visible: false,
    amountText: '',
    isDouble: false,
  });
  const [checkinData, setCheckinData] = useState({
    enabled: false,
    stats: {
      checked_in_today: false,
      total_checkins: 0,
      total_quota: 0,
      checkin_count: 0,
      records: [],
    },
  });
  const [currentMonth, setCurrentMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  // 初始加载状态，用于避免折叠状态闪烁
  const [initialLoaded, setInitialLoaded] = useState(false);
  // 折叠状态：null 表示未确定（等待首次加载）
  const [isCollapsed, setIsCollapsed] = useState(null);

  // 翻倍日配置由后端下发（controller/checkin.go）。倍数无效时后端已把
  // double_weekdays 置空，前端不必再判一次，避免两处规则走偏。
  const doubleWeekdays = useMemo(() => {
    const raw = checkinData.double_weekdays;
    return Array.isArray(raw) ? raw : [];
  }, [checkinData.double_weekdays]);
  const doubleMultiplier = checkinData.double_multiplier || 2;
  const todayIsDouble = !!checkinData.today_is_double;

  // 创建日期到额度的映射，方便快速查找
  const checkinRecordsMap = useMemo(() => {
    const map = {};
    const records = checkinData.stats?.records || [];
    records.forEach((record) => {
      map[record.checkin_date] = record.quota_awarded;
    });
    return map;
  }, [checkinData.stats?.records]);

  // 计算本月获得的额度
  const monthlyQuota = useMemo(() => {
    const records = checkinData.stats?.records || [];
    return records.reduce(
      (sum, record) => sum + (record.quota_awarded || 0),
      0,
    );
  }, [checkinData.stats?.records]);

  // 获取签到状态
  const fetchCheckinStatus = async (month) => {
    const isFirstLoad = !initialLoaded;
    setLoading(true);
    try {
      const res = await API.get(`/api/user/checkin?month=${month}`);
      const { success, data, message } = res.data;
      if (success) {
        setCheckinData(data);
        // 首次加载时，根据签到状态设置折叠状态
        if (isFirstLoad) {
          setIsCollapsed(data.stats?.checked_in_today ?? false);
          setInitialLoaded(true);
        }
      } else {
        showError(message || t('获取签到状态失败'));
        if (isFirstLoad) {
          setIsCollapsed(false);
          setInitialLoaded(true);
        }
      }
    } catch (error) {
      showError(t('获取签到状态失败'));
      if (isFirstLoad) {
        setIsCollapsed(false);
        setInitialLoaded(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const postCheckin = async (token) => {
    const url = token
      ? `/api/user/checkin?turnstile=${encodeURIComponent(token)}`
      : '/api/user/checkin';
    return API.post(url);
  };

  const shouldTriggerTurnstile = (message) => {
    if (!turnstileEnabled) return false;
    if (typeof message !== 'string') return true;
    return message.includes('Turnstile');
  };

  const doCheckin = async (token) => {
    setCheckinLoading(true);
    try {
      const res = await postCheckin(token);
      const { success, data, message } = res.data;
      if (success) {
        // 开箱弹窗替代原来的 toast —— 签到是有仪式感的动作，
        // 一闪而过的提示条承载不了「今天领了双倍」这件事。
        setReward({
          visible: true,
          amountText: formatAward(data.quota_awarded),
          isDouble: !!checkinData.today_is_double,
        });
        // 刷新签到状态
        fetchCheckinStatus(currentMonth);
        setTurnstileModalVisible(false);
      } else {
        if (!token && shouldTriggerTurnstile(message)) {
          if (!turnstileSiteKey) {
            showError('Turnstile is enabled but site key is empty.');
            return;
          }
          setTurnstileModalVisible(true);
          return;
        }
        if (token && shouldTriggerTurnstile(message)) {
          setTurnstileWidgetKey((v) => v + 1);
        }
        showError(message || t('签到失败'));
      }
    } catch (error) {
      showError(t('签到失败'));
    } finally {
      setCheckinLoading(false);
    }
  };

  useEffect(() => {
    if (status?.checkin_enabled) {
      fetchCheckinStatus(currentMonth);
    }
  }, [status?.checkin_enabled, currentMonth]);

  // 如果签到功能未启用，不显示组件
  if (!status?.checkin_enabled) {
    return null;
  }

  // 今天的 YYYY-MM-DD，用于判断哪个翻倍日格子该带动效。
  // 用本地时间拼接而非 toISOString()（后者是 UTC，东八区凌晨会差一天）。
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // 日期渲染函数 - 显示签到状态和获得的额度
  const dateRender = (dateString) => {
    // Semi Calendar 传入的 dateString 是 Date.toString() 格式
    // 需要转换为 YYYY-MM-DD 格式来匹配后端数据
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return null;
    }
    // 使用本地时间格式化，避免时区问题
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`; // YYYY-MM-DD
    const quotaAwarded = checkinRecordsMap[formattedDate];
    const isCheckedIn = quotaAwarded !== undefined;

    if (isCheckedIn) {
      // 已签到 = 已开箱。原来是绿色对勾（且 bg-green-500 在本项目的
      // tailwind 配置下其实是透明的），换成打开的宝箱更贴合签到语境。
      return (
        <Tooltip
          content={`${t('获得')} ${formatAward(quotaAwarded)}`}
          position='top'
        >
          <div className='absolute inset-0 flex flex-col items-center justify-center cursor-pointer'>
            <ChestOpen size={32} className='mb-0.5' />
            <div className='checkin-award-text'>{formatAward(quotaAwarded)}</div>
          </div>
        </Tooltip>
      );
    }

    // 未签到的翻倍日：左下角一个大号渐变水印数字，不铺底色。
    // getDay() 取本地星期，与后端 time.Weekday() 同为 0=周日…6=周六。
    //
    // 水印放左下：日期数字（.semi-calendar-month-date）固定在右上角，
    // 早先把标记放右上角时实测被糊成「×26」。
    //
    // 渐变色用 semi-color-* 变量而非 amber/orange —— 本项目 tailwind.config.js
    // 把 theme.colors 整个替换掉了，默认色板不存在，写了只会渲染成透明。
    if (doubleWeekdays.includes(date.getDay())) {
      const label = `×${formatMultiplier(doubleMultiplier)}`;
      // 只给「今天」加呼吸动效，把注意力引到「今天就能领双倍」上，
      // 而不是让一个月里 8-9 个格子一起闪。
      const isToday = formattedDate === todayStr;
      // 浮动相位按日期错开：同步起伏会像阅兵，错开才有「一堆宝箱各自待开启」的活感。
      const bobDelay = `${(date.getDate() % 7) * 0.35}s`;
      return (
        <Tooltip content={`${t('该日签到额度')} ${label}`} position='top'>
          <div
            className={`checkin-double-cell cursor-pointer${isToday ? ' is-today' : ''}`}
          >
            {/* 徽章嵌在宝箱容器内，挂在箱子右上角当数量角标 —— 两者一起浮动，
                读起来是「一个带数量的物品」，而不是格子里两个独立元素。 */}
            <span className='checkin-chest-closed' style={{ animationDelay: bobDelay }}>
              <ChestClosed size={32} />
              <PixelTag size='sm' className='checkin-double-badge'>
                {label}
              </PixelTag>
            </span>
          </div>
        </Tooltip>
      );
    }
    return null;
  };

  // 处理月份变化
  const handleMonthChange = (date) => {
    const month = date.toISOString().slice(0, 7);
    setCurrentMonth(month);
  };

  return (
    <Card className='!rounded-2xl'>
      <Modal
        title='Security Check'
        visible={turnstileModalVisible}
        footer={null}
        centered
        onCancel={() => {
          setTurnstileModalVisible(false);
          setTurnstileWidgetKey((v) => v + 1);
        }}
      >
        <div className='flex justify-center py-2'>
          <Turnstile
            key={turnstileWidgetKey}
            sitekey={turnstileSiteKey}
            onVerify={(token) => {
              doCheckin(token);
            }}
            onExpire={() => {
              setTurnstileWidgetKey((v) => v + 1);
            }}
          />
        </div>
      </Modal>

      {/* 卡片头部 */}
      <div className='flex items-center justify-between'>
        <div
          className='flex items-center flex-1 cursor-pointer'
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <Avatar size='small' color='green' className='mr-3 shadow-md'>
            <CalendarCheck size={16} />
          </Avatar>
          <div className='flex-1'>
            <div className='flex items-center gap-2'>
              <Typography.Text className='text-lg font-medium'>
                {t('每日签到')}
              </Typography.Text>
              {isCollapsed ? (
                <ChevronDown size={16} className='text-gray-400' />
              ) : (
                <ChevronUp size={16} className='text-gray-400' />
              )}
            </div>
            <div className='text-xs text-gray-500 dark:text-gray-400'>
              {!initialLoaded
                ? t('正在加载签到状态...')
                : checkinData.topup_eligible === false
                  ? t('充值达标后可签到')
                  : checkinData.stats?.checked_in_today
                    ? t('今日已签到，累计签到') +
                      ` ${checkinData.stats?.total_checkins || 0} ` +
                      t('天')
                    : t('每日签到可获得随机额度奖励')}
            </div>
            {/* 今日翻倍提示：与日历徽章、宝箱同一套像素语言，保证「双倍」
                在整张卡片里是同一个视觉。已签到时也保留，让用户知道刚才
                那笔是加倍到账的。 */}
            {initialLoaded && todayIsDouble && (
              <PixelTag className='mt-1'>
                <PixelSparkle size={10} color='#2A1A0D' />
                {t('今日额度')} ×{formatMultiplier(doubleMultiplier)}
              </PixelTag>
            )}
          </div>
        </div>
        <Button
          type='primary'
          theme='solid'
          icon={<Gift size={16} />}
          onClick={() => doCheckin()}
          loading={checkinLoading || !initialLoaded}
          disabled={
            !initialLoaded ||
            checkinData.stats?.checked_in_today ||
            checkinData.topup_eligible === false
          }
          className='!bg-green-600 hover:!bg-green-700'
        >
          {!initialLoaded
            ? t('加载中...')
            : checkinData.topup_eligible === false
              ? t('充值不足')
              : checkinData.stats?.checked_in_today
                ? t('今日已签到')
                : t('立即签到')}
        </Button>
      </div>

      {/* 充值不足提示 */}
      {initialLoaded && checkinData.topup_eligible === false && (
        <Banner
          type='warning'
          description={
            t('累计充值满') +
            ` ${checkinData.min_topup_amount} ` +
            t('元后可使用签到功能') +
            (checkinData.user_topup_total !== undefined
              ? `，${t('当前累计充值')} ${checkinData.user_topup_total.toFixed(2)} ${t('元')}`
              : '')
          }
          className='mt-3'
          closeIcon={null}
        />
      )}

      {/* 可折叠内容 */}
      <Collapsible isOpen={isCollapsed === false} keepDOM>
        {/* 签到统计：三项合并到一条内，用竖分隔线区隔，比三个独立色块更紧凑。
            配色用 semi-color-* token —— slate/green/orange 这些默认色板在本项目
            的 tailwind 配置里被移除了，写了不生效（原来的 bg-slate-50 其实一直
            是透明的）。 */}
        <div className='flex items-stretch mb-4 mt-4 rounded-lg bg-semi-color-fill-0 overflow-hidden'>
          {[
            {
              icon: <CalendarCheck size={14} />,
              value: `${checkinData.stats?.total_checkins || 0} ${t('天')}`,
              label: t('累计签到'),
              color: 'text-semi-color-success',
            },
            {
              icon: <Gift size={14} />,
              value: formatAward(monthlyQuota),
              label: t('本月获得'),
              color: 'text-semi-color-warning',
            },
            {
              icon: <Wallet size={14} />,
              value: formatAward(checkinData.stats?.total_quota || 0),
              label: t('累计获得'),
              color: 'text-semi-color-primary',
            },
          ].map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && <div className='w-px my-2.5 bg-semi-color-border' />}
              <div className='flex-1 px-2 py-2.5 text-center min-w-0'>
                <div
                  className={`flex items-center justify-center gap-1 font-bold text-base ${item.color}`}
                >
                  <span className='shrink-0 opacity-70'>{item.icon}</span>
                  <span className='truncate'>{item.value}</span>
                </div>
                <div className='text-xs text-gray-500 mt-0.5'>{item.label}</div>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* 签到日历 - 使用更紧凑的样式 */}
        <Spin spinning={loading}>
          <div className='border rounded-lg overflow-hidden checkin-calendar'>
            <style>{`
            /* ---- 翻倍日格子：暖金分层视觉 ----
               1) 底层：左下发散的琥珀径向光晕 + 描边
               2) 中层：缓慢扫过的金色高光（::after）
               3) 顶层：关着的像素宝箱 + 像素徽章
               暖金是「宝箱里有货」的通用语言，也不会和站内蓝色主色打架。
               用固定 rgba 而非 semi token，保证明暗两种主题下都成立。 */
            .checkin-calendar .checkin-double-cell {
              position: absolute;
              inset: -2px;
              border-radius: 6px;
              overflow: hidden;
              background:
                radial-gradient(115% 85% at 12% 105%,
                  rgba(255,198,26,.20) 0%,
                  rgba(255,198,26,.06) 44%,
                  rgba(255,198,26,0) 72%);
              box-shadow: inset 0 0 0 1px rgba(107,68,35,.30);
            }
            /* 金色光泽扫过 —— 只给「今天」那一格。
               所有格子一起扫时动画是同步的，会在日历上拉出一排整齐的黄色斜条，
               既脏又把宝箱压下去了（实测确认）。留给今天一格反而成了指引。 */
            .checkin-calendar .checkin-double-cell.is-today::after {
              content: '';
              position: absolute;
              top: -20%;
              left: -70%;
              width: 30%;
              height: 140%;
              transform: skewX(-18deg);
              background: linear-gradient(100deg,
                transparent 0%,
                rgba(247,215,116,.30) 50%,
                transparent 100%);
              animation: checkinSheen 4.8s ease-in-out infinite;
              pointer-events: none;
            }
            /* 关着的宝箱：放左下，与右上角的日期数字错开。
               checkinChestBob 让宝箱上下浮动，相位靠内联 animationDelay 错开。
               这里是徽章的定位父级，所以不能设 overflow 或 filter（filter 会
               连带给徽章加一层重复的硬投影）。 */
            .checkin-calendar .checkin-chest-closed {
              position: absolute;
              left: 6px;
              bottom: 6px;
              line-height: 0;
              animation: checkinChestBob 2.8s ease-in-out infinite;
            }
            /* 硬投影只给箱体本身，不用柔阴影 —— 像素画配柔阴影会像贴了张纸 */
            .checkin-calendar .checkin-chest-closed > svg {
              filter: drop-shadow(2px 2px 0 rgba(42,26,13,.5));
            }
            @keyframes checkinChestBob {
              0%, 100% { transform: translateY(0); }
              50%      { transform: translateY(-3px); }
            }
            /* 像素徽章（样式在 PixelTag 里），这里只负责定位：
               挂在【宝箱】右上角当数量角标，略微出挑一点更像游戏物品。 */
            .checkin-calendar .checkin-double-badge {
              position: absolute;
              top: -5px;
              right: -11px;
            }
            /* 今天：光晕加浓 + 宝箱轻微跳动，引导「今天就能开」 */
            .checkin-calendar .checkin-double-cell.is-today {
              background:
                radial-gradient(115% 85% at 12% 105%,
                  rgba(255,198,26,.34) 0%,
                  rgba(255,198,26,.12) 46%,
                  rgba(255,198,26,0) 74%);
              box-shadow: inset 0 0 0 1px rgba(107,68,35,.55);
            }
            /* 今天的宝箱和其他翻倍日一起浮动；「今天」靠更浓的光晕、
               徽章闪烁和高光扫过区分，不再单独抖动。 */
            .checkin-calendar .checkin-double-cell.is-today .checkin-double-badge {
              animation: checkinBadgeBlink 2.2s ease-in-out infinite;
            }
            /* 已签到格子的金额文字 */
            .checkin-calendar .checkin-award-text {
              font-size: 10px;
              font-weight: 700;
              line-height: 1;
              color: #C88A00;
            }
            @keyframes checkinSheen {
              0%   { left: -70%; }
              55%  { left: 130%; }
              100% { left: 130%; }
            }
            /* 徽章闪烁只调亮度，drop-shadow 逐帧重写以保住像素硬投影 */
            @keyframes checkinBadgeBlink {
              0%, 100% { filter: drop-shadow(2px 2px 0 rgba(42,26,13,.45)) brightness(1); }
              50%      { filter: drop-shadow(2px 2px 0 rgba(42,26,13,.45)) brightness(1.22); }
            }
            /* 尊重系统「减少动态效果」：静态下依然看得出是双倍日 */
            @media (prefers-reduced-motion: reduce) {
              .checkin-calendar .checkin-double-cell::after { display: none; }
              .checkin-calendar .checkin-chest-closed,
              .checkin-calendar .checkin-double-cell.is-today .checkin-double-badge {
                animation: none;
              }
            }
            /* 窄屏：徽章已经挂在宝箱上、不再和它抢位置，所以留着；
               只把出挑收回箱体内，免得被格子的 overflow 裁掉。 */
            @media (max-width: 640px) {
              .checkin-calendar .checkin-chest-closed { left: 3px; bottom: 3px; }
              .checkin-calendar .checkin-double-badge { top: -4px; right: -4px; }
            }
            .checkin-calendar .semi-calendar {
              font-size: 13px;
            }
            .checkin-calendar .semi-calendar-month-header {
              padding: 8px 12px;
            }
            .checkin-calendar .semi-calendar-month-week-row {
              height: 28px;
            }
            .checkin-calendar .semi-calendar-month-week-row th {
              font-size: 12px;
              padding: 4px 0;
            }
            .checkin-calendar .semi-calendar-month-grid-row {
              height: auto;
            }
            .checkin-calendar .semi-calendar-month-grid-row td {
              height: 56px;
              padding: 2px;
            }
            .checkin-calendar .semi-calendar-month-grid-row-cell {
              position: relative;
              height: 100%;
            }
            .checkin-calendar .semi-calendar-month-grid-row-cell-day {
              position: absolute;
              top: 4px;
              left: 50%;
              transform: translateX(-50%);
              font-size: 12px;
              z-index: 1;
            }
            .checkin-calendar .semi-calendar-month-same {
              background: transparent;
            }
            .checkin-calendar .semi-calendar-month-today .semi-calendar-month-grid-row-cell-day {
              background: var(--semi-color-primary);
              color: white;border-radius: 50%;
              width: 20px;
              height: 20px;
              display: flex;
              align-items: center;
              justify-content: center;}
          `}</style>
            <Calendar
              mode='month'
              onChange={handleMonthChange}
              dateGridRender={(dateString, date) => dateRender(dateString)}
            />
          </div>
        </Spin>

        {/* 签到说明：只留有信息量的一条。
            原来三条里，「每日签到可获得随机额度奖励」与卡片顶部副标题完全重复，
            「每日仅可签到一次」点一次按钮就知道了 —— 都删掉。
            双倍规则只在配置了翻倍日时才提示。 */}
        <div className='mt-3 px-2.5 py-2 bg-semi-color-fill-0 rounded-lg'>
          <Typography.Text type='tertiary' className='text-xs'>
            {t('签到奖励将直接添加到您的账户余额')}
            {doubleWeekdays.length > 0 &&
              `，${t('标记')} ×${formatMultiplier(doubleMultiplier)} ${t('的日期额度加倍')}`}
          </Typography.Text>
        </div>
      </Collapsible>

      <CheckinRewardModal
        t={t}
        visible={reward.visible}
        amountText={reward.amountText}
        isDouble={reward.isDouble}
        multiplierLabel={`×${formatMultiplier(doubleMultiplier)}`}
        onClose={() => setReward((r) => ({ ...r, visible: false }))}
      />
    </Card>
  );
};

export default CheckinCalendar;
