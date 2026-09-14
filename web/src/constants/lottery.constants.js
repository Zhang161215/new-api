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

export const LOTTERY_WHEEL_PATH = '/lottery/wheel.html';
export const LOTTERY_ADMIN_PATH = '/lottery/admin.html';
export const LOTTERY_ADMIN_LAUNCH_PATH = '/console/lottery-admin';
export const LOTTERY_WHEEL_EMBED_SRC = '/lottery/wheel.html';
export const LOTTERY_ADMIN_EMBED_SRC = '/lottery/admin.html';

function openNamedPopup(url, name) {
  const width = Math.min(1440, Math.max(980, window.screen.availWidth - 80));
  const height = Math.min(920, Math.max(720, window.screen.availHeight - 80));
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
  const feat = `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  const win = window.open(url, name, feat);
  if (!win) {
    window.open(url, name);
  } else {
    try {
      win.focus();
    } catch (e) {
      // ignore
    }
  }
  return win;
}

function isLotteryAdminUser() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return Boolean(user && Number(user.role) >= 10);
  } catch (e) {
    return false;
  }
}

export function openLotteryWindow() {
  if (isLotteryAdminUser()) {
    return openLotteryAdminWindow();
  }
  return openNamedPopup(LOTTERY_WHEEL_PATH, 'synai996-lottery');
}

export function openLotteryAdminWindow() {
  return openNamedPopup(LOTTERY_ADMIN_PATH, 'synai996-lottery-admin');
}
export const LOTTERY_MACHINE_SRC = '/lottery/assets/machine.png';
export const LOTTERY_REEL_SRC = '/lottery/assets/reel.png';
export const LOTTERY_TICKET_SRC = '/lottery/assets/ticket.png';
export const LOTTERY_WHEEL_FRAME_SRC = '/lottery/assets/wheel-frame.png?v=w2';
export const LOTTERY_WHEEL_RING_SRC = '/lottery/assets/wheel-ring.png?v=w2';
export const LOTTERY_WHEEL_HUB_SRC = '/lottery/assets/wheel-hub.png?v=w2';

export const LOTTERY_GRANT_SEEN_PREFIX = 'synai996.lottery.grant.seen.';
export const LOTTERY_GRANT_MUTE_PREFIX = 'synai996.lottery.grant.mute.';
export const LOTTERY_GRANT_FRESH_MS = 20 * 60 * 1000;

export function lotteryGrantSeenKey(userId) {
  return `${LOTTERY_GRANT_SEEN_PREFIX}${userId}`;
}

export function lotteryGrantMuteKey(userId) {
  return `${LOTTERY_GRANT_MUTE_PREFIX}${userId}`;
}

export function isLotteryGrantMuted(userId) {
  try {
    return localStorage.getItem(lotteryGrantMuteKey(userId)) === '1';
  } catch (e) {
    return false;
  }
}

export function writeLotteryGrantMuted(userId) {
  try {
    localStorage.setItem(lotteryGrantMuteKey(userId), '1');
  } catch (e) {
    // ignore
  }
}

export function readLotteryGrantSeen(userId) {
  try {
    return Number(localStorage.getItem(lotteryGrantSeenKey(userId)) || 0);
  } catch (e) {
    return 0;
  }
}

export function writeLotteryGrantSeen(userId, logId) {
  try {
    localStorage.setItem(lotteryGrantSeenKey(userId), String(logId));
  } catch (e) {
    // ignore
  }
}
