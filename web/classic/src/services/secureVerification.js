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

import { API } from '../helpers';
import {
  buildOAuthAuthorizeUrl,
  getOAuthAuthorization,
} from '../helpers/api';
import {
  prepareCredentialRequestOptions,
  buildAssertionResult,
  isPasskeySupported,
} from '../helpers/passkey';

/**
 * 通用安全验证服务（对应上游 rc.36 的统一安全验证）
 *
 * 敏感操作按「scope + context」授权：
 *   1. GET /api/verify/methods?scope=... 取当前用户可用的验证方式（2fa / passkey / password / oauth）；
 *   2. 用其中一种方式验证，换到 5 分钟有效、只能用一次的 proof_token（绑定登录会话、scope 和 context）；
 *   3. 调业务接口时放在 X-Security-Proof 请求头里。
 *
 * scope 与 context：
 *   channel.key.read {channel_id}、passkey.register、passkey.delete、2fa.setup、2fa.disable、
 *   2fa.backup_codes.regenerate、access_token.generate、access_token.revoke、
 *   account.binding.bind {provider[, email | code]}、account.binding.unbind {provider_id}、
 *   account.password.set、account.password.change、account.delete
 *
 * 没开 2FA / Passkey 的用户：有密码的用密码验证，纯 OAuth 注册的用户用已绑定的 OAuth 账号验证（弹窗）。
 */

const ERROR_MESSAGES = {
  SECURITY_VERIFICATION_FAILED: '验证失败，请重试',
  SECURITY_VERIFICATION_LOCKED: '两步验证已临时锁定，请稍后再试',
  SECURITY_METHOD_UNAVAILABLE: '该验证方式当前不可用',
  SECURITY_VERIFICATION_FLOW_REQUIRED: '该验证方式需要走专门的验证流程',
  SECURITY_PROOF_REQUIRED: '需要安全验证',
  SECURITY_PROOF_EXPIRED: '安全验证已过期，请重新验证',
  SECURITY_PROOF_INVALID: '安全验证状态无效，请重新验证',
  SECURITY_PROOF_CONSUMED: '这次验证已经用过了，请重新验证',
  SECURITY_PROOF_SCOPE_MISMATCH: '安全验证与当前操作不匹配',
  SECURITY_PROOF_CONTEXT_MISMATCH: '安全验证与当前操作的内容不匹配，请重新验证',
  SECURITY_PROOF_METHOD_MISMATCH: '该验证方式不能用于当前操作',
  SECURITY_ACTION_FORBIDDEN: '没有权限执行此操作',
  SECURITY_CONTEXT_INVALID: '操作参数无效',
  AUTH_FLOW_INVALID: '验证流程已过期，请重新开始',
  TWOFA_CODE_INVALID: '验证码错误',
  TWOFA_SETUP_INVALID: '两步验证设置已失效，请重新开始',
  TWOFA_ALREADY_ENABLED: '两步验证已经启用',
  TWOFA_NOT_ENABLED: '尚未启用两步验证',
  PASSKEY_NOT_FOUND: '尚未绑定 Passkey',
  CURRENT_PASSWORD_INVALID: '原密码错误',
  PASSWORD_POLICY_REJECTED: '新密码不符合要求（8-128 位，且不能与原密码相同）',
  ACCOUNT_SECURITY_STATE_CHANGED: '账户安全状态已变化，请刷新页面后重试',
  LAST_LOGIN_METHOD: '这是你唯一的登录方式，不能解绑',
  OAUTH_ACCOUNT_MISMATCH: '授权的第三方账号与当前账户绑定的不一致',
  ACCOUNT_ALREADY_BOUND: '该第三方账号已绑定其他账户',
  EMAIL_ADDRESS_REJECTED: '邮箱地址不可用',
  EMAIL_ALREADY_TAKEN: '该邮箱已被占用',
  EMAIL_BINDING_DELIVERY_FAILED: '验证邮件发送失败，请稍后重试',
  EMAIL_BINDING_CODE_INVALID: '邮箱验证码错误',
  EMAIL_BINDING_LOCKED: '验证码错误次数过多，请重新获取',
  EMAIL_BINDING_RESEND_WAIT: '发送太频繁，请稍后再试',
  TELEGRAM_OAUTH_NOT_CONFIGURED: 'Telegram 登录未配置',
  AUTH_CANCELLED: '已取消验证',
};

export class SecurityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

// 把后端返回（或 axios 错误）转成中文提示
export function securityErrorMessage(source, fallback = '操作失败，请重试') {
  const body = source?.response?.data ?? source;
  const code = body?.code;
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (body?.message) return body.message;
  if (source?.response?.status === 429) return '操作太频繁，请稍后再试';
  if (source instanceof Error && source.message) return source.message;
  return fallback;
}

// 统一解析：success=false 或 HTTP 错误都抛 SecurityError（不走全局错误弹窗，由调用方提示）
export async function securityResult(request, fallback) {
  try {
    const res = await request;
    const body = res?.data;
    if (!body?.success) {
      throw new SecurityError(securityErrorMessage(body, fallback), body?.code);
    }
    return body.data;
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError(
      securityErrorMessage(error, fallback),
      error?.response?.data?.code,
    );
  }
}

export const securityRequestConfig = { skipErrorHandler: true };

// 带 proof 调业务接口时用的请求配置
export function withProof(proof, config = {}) {
  return {
    ...securityRequestConfig,
    ...config,
    headers: { ...(config.headers || {}), 'X-Security-Proof': proof },
  };
}

function operationFields(operation) {
  return {
    scope: operation.scope,
    ...(operation.context ? { context: operation.context } : {}),
  };
}

// ---------------- OAuth 验证弹窗 ----------------
// 弹窗走完第三方授权后会回到本站 /oauth/<provider>（OAuth2Callback），
// 回调页看到 localStorage 里有这个 state 的标记，就把 code/state 通过 postMessage 交回本页面，
// 由本页面带着当前会话的 Bearer 去换 proof（回调页自己不调接口）。
export const OAUTH_POPUP_CALLBACK_MESSAGE = 'newapi:oauth-popup-callback';
const OAUTH_POPUP_MARK_PREFIX = 'oauth_popup:';
const OAUTH_POPUP_TIMEOUT_MS = 10 * 60 * 1000;

export function getOAuthPopupMark(state) {
  if (!state) return null;
  try {
    return JSON.parse(
      localStorage.getItem(OAUTH_POPUP_MARK_PREFIX + state) || 'null',
    );
  } catch (e) {
    return null;
  }
}

function setOAuthPopupMark(state, provider) {
  localStorage.setItem(
    OAUTH_POPUP_MARK_PREFIX + state,
    JSON.stringify({ provider, at: Date.now() }),
  );
}

function clearOAuthPopupMark(state) {
  if (state) localStorage.removeItem(OAUTH_POPUP_MARK_PREFIX + state);
}

// 必须在点击事件里同步调用（任何 await 之前），否则会被浏览器拦截
export function openOAuthPopupWindow() {
  const width = 520;
  const height = 680;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  return window.open(
    '',
    'newapi_oauth_verify',
    `width=${width},height=${height},left=${left},top=${top}`,
  );
}

function waitForOAuthPopupCallback(popup, provider, state) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      clearTimeout(deadline);
      fn(value);
    };
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (
        !msg ||
        msg.type !== OAUTH_POPUP_CALLBACK_MESSAGE ||
        msg.provider !== provider ||
        msg.state !== state
      ) {
        return;
      }
      finish(resolve, msg);
    };
    window.addEventListener('message', onMessage);
    const closedTimer = setInterval(() => {
      if (popup.closed) {
        finish(reject, new SecurityError('已取消授权', 'AUTH_CANCELLED'));
      }
    }, 500);
    const deadline = setTimeout(() => {
      finish(reject, new SecurityError('授权超时，请重试'));
    }, OAUTH_POPUP_TIMEOUT_MS);
  });
}

async function verifyOAuth(provider, operation, popup) {
  if (!popup || popup.closed) {
    throw new SecurityError('授权弹窗被浏览器拦截了，请允许弹窗后重试');
  }
  let state = '';
  try {
    const auth = await getOAuthAuthorization(provider, 'verify', {
      operation,
      skipErrorHandler: true,
    }).catch((error) => {
      throw new SecurityError(securityErrorMessage(error, 'OAuth 初始化失败'));
    });
    state = auth.state;
    let status = {};
    try {
      status = JSON.parse(localStorage.getItem('status') || '{}');
    } catch (e) {}
    const url =
      auth.authorizationUrl || buildOAuthAuthorizeUrl(provider, state, status);
    if (!state || !url) {
      throw new SecurityError('OAuth 配置错误，无法发起授权');
    }
    setOAuthPopupMark(state, provider);
    popup.location.replace(url);
    const callback = await waitForOAuthPopupCallback(popup, provider, state);
    const proof = await securityResult(
      API.get(`/api/oauth/${provider}`, {
        ...securityRequestConfig,
        disableDuplicate: true,
        params: {
          state,
          code: callback.code,
          error: callback.error,
          error_description: callback.error_description,
        },
      }),
      '授权验证失败',
    );
    return proof;
  } finally {
    clearOAuthPopupMark(state);
    if (popup && !popup.closed) popup.close();
  }
}

// ---------------- Passkey ----------------
async function requestPasskeyAssertion(options) {
  const publicKey = prepareCredentialRequestOptions(options);
  let credential;
  try {
    credential = await navigator.credentials.get({ publicKey });
  } catch (error) {
    if (error?.name === 'NotAllowedError') {
      throw new SecurityError('Passkey 验证被取消或超时', 'AUTH_CANCELLED');
    }
    if (error?.name === 'InvalidStateError') {
      throw new SecurityError('Passkey 验证状态无效');
    }
    throw error;
  }
  if (!credential) {
    throw new SecurityError('Passkey 验证被取消', 'AUTH_CANCELLED');
  }
  const assertion = buildAssertionResult(credential);
  if (!assertion) {
    throw new SecurityError('无法生成 Passkey 验证数据');
  }
  return assertion;
}

async function verifyPasskey(operation) {
  const begin = await securityResult(
    API.post(
      '/api/user/passkey/verify/begin',
      operationFields(operation),
      securityRequestConfig,
    ),
    '开始验证失败',
  );
  if (!begin?.flow_token) {
    throw new SecurityError('验证流程已过期，请重试');
  }
  const assertion = await requestPasskeyAssertion(begin.options ?? begin);
  return securityResult(
    API.post(
      '/api/user/passkey/verify/finish',
      { flow_token: begin.flow_token, credential: assertion },
      securityRequestConfig,
    ),
    '验证失败',
  );
}

export class SecureVerificationService {
  /**
   * 取某个操作可用的验证方式（服务端按用户已开启的 2FA/Passkey、是否有密码、绑定的 OAuth 决定）
   * @returns {Promise<{scope, methods: Array<{method, available, reason}>, oauth_providers: Array<{slug, name}>, password_encryption_enabled: boolean}>}
   */
  static async getRequirements(scope) {
    const [requirements, passkeySupported] = await Promise.all([
      securityResult(
        API.get('/api/verify/methods', {
          ...securityRequestConfig,
          params: { scope },
          disableDuplicate: true,
        }),
        '获取验证方式失败',
      ),
      isPasskeySupported().catch(() => false),
    ]);
    const methods = (requirements?.methods || []).map((option) => {
      if (option.method === 'passkey' && option.available && !passkeySupported) {
        return {
          ...option,
          available: false,
          reason: '当前设备不支持 Passkey',
        };
      }
      return option;
    });
    return {
      ...requirements,
      methods,
      oauth_providers: requirements?.oauth_providers || [],
      passkeySupported,
    };
  }

  /**
   * 执行验证，返回 proof_token
   * @param {string} method - '2fa' | 'passkey' | 'password' | 'oauth'
   * @param {Object} input - { code } | { password } | { provider, popup }
   * @param {Object} operation - { scope, context }
   */
  static async verify(method, input = {}, operation, options = {}) {
    let proof;
    switch (method) {
      case '2fa': {
        const code = (input.code || '').trim();
        if (!code) throw new SecurityError('请输入验证码或备用码');
        proof = await securityResult(
          API.post(
            '/api/verify',
            { method, ...operationFields(operation), code },
            securityRequestConfig,
          ),
          '验证失败',
        );
        break;
      }
      case 'password': {
        if (!input.password) throw new SecurityError('请输入当前密码');
        if (options.passwordEncryptionEnabled) {
          // 本站没开密码传输加密（PASSWORD_LOGIN_ENCRYPTION_ENABLED），classic 也没实现加密
          throw new SecurityError('站点开启了密码加密传输，classic 界面暂不支持密码验证');
        }
        proof = await securityResult(
          API.post(
            '/api/verify',
            { method, ...operationFields(operation), password: input.password },
            securityRequestConfig,
          ),
          '验证失败',
        );
        break;
      }
      case 'passkey':
        proof = await verifyPasskey(operation);
        break;
      case 'oauth':
        proof = await verifyOAuth(input.provider, operation, input.popup);
        break;
      default:
        throw new SecurityError(`不支持的验证方式: ${method}`);
    }
    if (!proof?.proof_token || proof.scope !== operation.scope) {
      throw new SecurityError('没有拿到有效的验证凭证，请重试');
    }
    return proof.proof_token;
  }
}

/**
 * 预设的API调用函数工厂
 */
export const createApiCalls = {
  /**
   * 查看渠道密钥（scope channel.key.read，context {channel_id}）
   * @param {number} channelId - 渠道ID
   */
  viewChannelKey: (channelId) => async (proof) => {
    const data = await securityResult(
      API.post(`/api/channel/${channelId}/key`, {}, withProof(proof)),
      '获取密钥失败',
    );
    return { success: true, data };
  },
};
