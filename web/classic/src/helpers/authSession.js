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

// classic 前端的面板鉴权（对应上游 7-20 31d70fca3 的 Bearer access token + HttpOnly refresh cookie）。
//
// - access token（15 分钟 JWT）只放内存，不写 localStorage；页面刷新后用 refresh cookie 换新的。
// - localStorage 里的 'user' 只是界面用的用户资料，表示“这个浏览器登录过”，不再是凭据。
// - refresh 单飞：同一标签页内合并成一次请求，多标签页之间用 Web Locks 串行（和上游新版前端同一把锁）。
// - 设计说明见上游 docs/authentication.md。

import axios from 'axios';

const AUTH_REFRESH_LOCK = 'new-api:auth-refresh';
const REFRESH_RACE_DELAYS = [80, 200, 500];
// access token 剩余不到这么多秒就提前刷新，避免请求在路上过期
const REFRESH_LEEWAY_SECONDS = 30;

const authClient = axios.create({
  baseURL: import.meta.env.VITE_REACT_APP_SERVER_URL
    ? import.meta.env.VITE_REACT_APP_SERVER_URL
    : '',
  withCredentials: true,
  headers: {
    'Cache-Control': 'no-store',
  },
});

let accessToken = '';
let accessExpiresAt = 0;
let loginSession = null;
let refreshPromise = null;
// 每次登录/退出/换 token 都 +1；refresh 返回时如果已经变了，说明结果过期，丢弃
let authEpoch = 0;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object';
}

function hasValidTokenFields(value) {
  return (
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    typeof value.token_type === 'string' &&
    value.token_type.length > 0 &&
    typeof value.access_expires_at === 'number' &&
    Number.isFinite(value.access_expires_at) &&
    value.access_expires_at > 0
  );
}

function isLoginSession(value) {
  return (
    isRecord(value) && typeof value.sid === 'string' && value.sid.length > 0
  );
}

// 登录类接口（密码/2FA/Passkey/OAuth/微信/Telegram/refresh）统一返回的 AuthBundle
export function isAuthBundle(value) {
  return (
    isRecord(value) &&
    hasValidTokenFields(value) &&
    isRecord(value.user) &&
    Number(value.user.id) > 0 &&
    isLoginSession(value.session)
  );
}

// 改密码、开关 2FA、重置备用码、注册/删除 Passkey 后返回的 token 轮换（没有 user 字段）
export function isAuthRotation(value) {
  return (
    isRecord(value) &&
    hasValidTokenFields(value) &&
    value.token_type === 'Bearer' &&
    isLoginSession(value.session) &&
    !isRecord(value.user)
  );
}

// 登录接口返回的是 AuthBundle，界面要的是其中的 user；旧格式（直接是用户对象）原样返回
export function authUserFromData(data) {
  return isAuthBundle(data) ? data.user : data;
}

export function applyAuthBundle(bundle) {
  if (!isAuthBundle(bundle)) return null;
  authEpoch += 1;
  accessToken = bundle.access_token;
  accessExpiresAt = bundle.access_expires_at;
  loginSession = bundle.session;
  try {
    localStorage.setItem('user', JSON.stringify(bundle.user));
  } catch (e) {
    // 存储不可用时只影响界面资料，不影响鉴权
  }
  return bundle.user;
}

export function applyAuthRotation(rotation) {
  if (!isAuthRotation(rotation)) return false;
  if (loginSession && rotation.session.sid !== loginSession.sid) return false;
  authEpoch += 1;
  accessToken = rotation.access_token;
  accessExpiresAt = rotation.access_expires_at;
  loginSession = rotation.session;
  return true;
}

export function clearAuthSession({ keepUser = false } = {}) {
  authEpoch += 1;
  accessToken = '';
  accessExpiresAt = 0;
  loginSession = null;
  if (!keepUser) {
    try {
      localStorage.removeItem('user');
    } catch (e) {
      // ignore
    }
  }
}

export function getAccessToken() {
  return accessToken;
}

export function getAuthSessionId() {
  return loginSession?.sid || '';
}

export function hasLocalUser() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return Boolean(user && Number(user.id) > 0);
  } catch (e) {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestRefresh(sid) {
  try {
    const res = await authClient.post('/api/user/auth/refresh', undefined, {
      headers: sid ? { 'X-Auth-Session': sid } : undefined,
    });
    return { status: res.status, data: res.data };
  } catch (error) {
    return {
      status: error?.response?.status || 0,
      data: error?.response?.data,
      error,
    };
  }
}

async function runRefresh() {
  const startEpoch = authEpoch;
  let raceAttempt = 0;
  let allowMismatchRetry = true;
  for (;;) {
    const res = await requestRefresh(getAuthSessionId());
    if (authEpoch !== startEpoch) {
      // 等待期间已经重新登录或退出，结果作废
      return { kind: 'superseded' };
    }
    const body = isRecord(res.data) ? res.data : {};
    const code = typeof body.code === 'string' ? body.code : undefined;
    if (body.success === true && isAuthBundle(body.data)) {
      applyAuthBundle(body.data);
      return { kind: 'authenticated', bundle: body.data };
    }
    if (res.status === 409 && code === 'AUTH_REFRESH_RACE') {
      const delay = REFRESH_RACE_DELAYS[raceAttempt];
      raceAttempt += 1;
      if (delay !== undefined) {
        await wait(delay);
        continue;
      }
      clearAuthSession();
      return { kind: 'out_of_sync', code };
    }
    if (res.status === 409 && code === 'AUTH_SESSION_MISMATCH') {
      if (allowMismatchRetry) {
        // 内存里的 SID 和 cookie 对不上（比如别的标签页换了账号）：丢掉旧 SID 再试一次
        allowMismatchRetry = false;
        raceAttempt = 0;
        accessToken = '';
        accessExpiresAt = 0;
        loginSession = null;
        continue;
      }
      clearAuthSession();
      return { kind: 'out_of_sync', code };
    }
    if (res.status === 401) {
      clearAuthSession();
      return { kind: 'anonymous' };
    }
    if (!res.status || res.status >= 500) {
      // 网络或服务端临时故障：保留登录状态，下次请求再试
      return { kind: 'transient_error', error: res.error };
    }
    clearAuthSession();
    return { kind: 'out_of_sync', code: code || 'AUTH_INVALID_REFRESH_RESPONSE' };
  }
}

export function refreshAuth() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
          return await navigator.locks.request(
            AUTH_REFRESH_LOCK,
            { mode: 'exclusive' },
            () => runRefresh(),
          );
        }
        return await runRefresh();
      } catch (error) {
        return { kind: 'transient_error', error };
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// 返回可用的 access token；没登录过（localStorage 没有 user）就不去 refresh，直接返回空串。
export async function ensureAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (accessToken && accessExpiresAt > now + REFRESH_LEEWAY_SECONDS) {
    return accessToken;
  }
  if (!accessToken && !hasLocalUser()) {
    return '';
  }
  const outcome = await refreshAuth();
  if (outcome.kind === 'authenticated') return accessToken;
  if (accessToken && accessExpiresAt > Math.floor(Date.now() / 1000)) {
    return accessToken;
  }
  return '';
}

// 给 fetch / SSE 这类不走 axios 实例的请求用
export async function getAuthHeaders() {
  const token = await ensureAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 退出当前登录会话：撤销服务端 Session 并清 refresh cookie；无论成败本地都清掉。
export async function logoutAuth() {
  const attempt = (sid) =>
    authClient.post('/api/user/auth/logout', undefined, {
      headers: {
        ...(sid ? { 'X-Auth-Session': sid } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  try {
    await attempt(getAuthSessionId());
  } catch (error) {
    if (
      error?.response?.status === 409 &&
      error.response.data?.code === 'AUTH_SESSION_MISMATCH'
    ) {
      const outcome = await refreshAuth();
      if (outcome.kind === 'authenticated') {
        try {
          await attempt(getAuthSessionId());
        } catch (e) {
          // ignore
        }
      }
    }
  } finally {
    clearAuthSession();
  }
}
