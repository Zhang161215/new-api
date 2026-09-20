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

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { UserContext } from '../../context/User';
import { API } from '../../helpers';
import {
  LOTTERY_GRANT_FRESH_MS,
  LOTTERY_REEL_SRC,
  LOTTERY_TICKET_SRC,
  LOTTERY_WHEEL_FRAME_SRC,
  isLotteryGiftPreview,
  isLotteryGiftSeen,
  isLotteryGrantMuted,
  lotteryGiftPeriod,
  openLotteryWindow,
  readLotteryGrantSeen,
  shouldSkipLotteryGiftPath,
  writeLotteryGiftSeen,
  writeLotteryGrantMuted,
  writeLotteryGrantSeen,
} from '../../constants/lottery.constants';

const latestPaymentGrant = (logs) => {
  const rows = Array.isArray(logs) ? logs : [];
  return rows.find((row) => row?.reason === 'payment_grant' && Number(row.delta) > 0);
};

const LotteryGrantWatcher = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [userState] = useContext(UserContext);
  const userId = userState?.user?.id;
  const [grant, setGrant] = useState(null);
  const [gift, setGift] = useState(null);
  const [muteLater, setMuteLater] = useState(false);
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    if (!userId || busyRef.current) {
      return;
    }
    if (isLotteryGrantMuted(userId)) {
      return;
    }
    busyRef.current = true;
    try {
      const res = await API.get('/api/lottery', { skipErrorHandler: true });
      const data = res?.data?.success ? res.data.data : null;
      if (!data) {
        return;
      }
      const latest = latestPaymentGrant(data.ticket_log || data.ticketLog);
      if (!latest?.id) {
        return;
      }
      const seenId = readLotteryGrantSeen(userId);
      if (latest.id <= seenId) {
        return;
      }
      const age = Date.now() - Number(latest.at || 0);
      if (seenId === 0 && age > LOTTERY_GRANT_FRESH_MS) {
        writeLotteryGrantSeen(userId, latest.id);
        return;
      }
      setGrant({
        id: latest.id,
        delta: Number(latest.delta) || 1,
        tickets: Number(data.tickets) || 0,
      });
    } catch (e) {
      // lottery route missing or not logged in
    } finally {
      busyRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };
    const timer = window.setInterval(check, 30000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);

    const q = new URLSearchParams(window.location.search);
    const justPaid =
      q.get('pay') === 'success' || q.get('show_history') === 'true';
    let fast;
    let stop;
    if (justPaid) {
      fast = window.setInterval(check, 2000);
      stop = window.setTimeout(() => window.clearInterval(fast), 30000);
    }

    return () => {
      window.clearInterval(timer);
      if (fast) window.clearInterval(fast);
      if (stop) window.clearTimeout(stop);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [userId, check]);

  useEffect(() => {
    setGift(null);
  }, [userId]);

  const maybeShowGift = useCallback(() => {
    const period = lotteryGiftPeriod();
    const preview = isLotteryGiftPreview();
    if (!userId || !period) {
      return;
    }
    if (shouldSkipLotteryGiftPath(location.pathname)) {
      return;
    }
    if (!preview && isLotteryGiftSeen(userId, period)) {
      return;
    }
    setGift((cur) => cur || { delta: 1, period });
  }, [userId, location.pathname]);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }
    maybeShowGift();
    return undefined;
  }, [userId, maybeShowGift]);

  const closeGrant = () => {
    if (grant?.id) {
      writeLotteryGrantSeen(userId, grant.id);
    }
    if (muteLater) {
      writeLotteryGrantMuted(userId);
    }
    setGrant(null);
    setMuteLater(false);
  };

  const closeGift = () => {
    writeLotteryGiftSeen(userId, gift?.period || lotteryGiftPeriod());
    setGift(null);
  };

  const hideGift = shouldSkipLotteryGiftPath(location.pathname);
  const view = grant
    ? { kind: 'payment', delta: grant.delta, close: closeGrant }
    : !hideGift && gift
      ? { kind: 'gift', delta: gift.delta, close: closeGift }
      : null;

  const goDraw = () => {
    if (!view) {
      return;
    }
    view.close();
    openLotteryWindow();
  };

  if (!view) {
    return null;
  }

  const isGift = view.kind === 'gift';
  const plus = `+${view.delta || 1}`;

  return createPortal(
    <div className={`lz-grant-root${isGift ? ' is-gift' : ''}`}>
      <button
        type='button'
        className='lz-grant-mask'
        aria-label={t('关闭')}
        onClick={view.close}
      />
      <div className='lz-grant-card' role='dialog' aria-modal='true'>
        <button
          type='button'
          className='lz-grant-close'
          aria-label={t('关闭')}
          onClick={view.close}
        >
          ×
        </button>
        <div className='lz-grant-hero'>
          <div className='lz-grant-stage'>
            <img className='lz-grant-wheel' src={LOTTERY_REEL_SRC} alt='' />
            <img className='lz-grant-ticket' src={LOTTERY_TICKET_SRC} alt='' />
            <img className='lz-grant-frame' src={LOTTERY_WHEEL_FRAME_SRC} alt='' />
          </div>
          {isGift ? <div className='lz-grant-badge'>{t('本月礼包')}</div> : null}
          {isGift ? (
            <div className='lz-grant-kicker'>{t('礼包赠送')}</div>
          ) : null}
          <div className='lz-grant-title'>
            {t('抽奖次数')} {plus}
          </div>
          <p className='lz-grant-sub'>
            {isGift
              ? t('本月礼包已到账，赠送一次抽奖次数，点进去试试手气。')
              : t('充值已到账，点进去试试手气。')}
          </p>
          <div className='lz-grant-actions'>
            <Button className='lz-grant-go' theme='solid' block onClick={goDraw}>
              {t('去抽奖')}
            </Button>
            <Button
              className='lz-grant-later'
              theme='borderless'
              type='tertiary'
              block
              onClick={view.close}
            >
              {t('稍后再说')}
            </Button>
          </div>
        </div>
        {isGift ? null : (
          <label className='lz-grant-mute-row'>
            <input
              type='checkbox'
              checked={muteLater}
              onChange={(e) => setMuteLater(e.target.checked)}
            />
            <span>{t('不再显示抽奖次数 +1 提醒')}</span>
          </label>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default LotteryGrantWatcher;
