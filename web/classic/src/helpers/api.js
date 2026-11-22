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

import { showError, formatMessageForAPI, isValidMessage } from './utils';
import axios from 'axios';
import { MESSAGE_ROLES } from '../constants/playground.constants';
import {
  applyAuthBundle,
  applyAuthRotation,
  ensureAccessToken,
  getAccessToken,
  hasLocalUser,
  isAuthBundle,
  logoutAuth,
  refreshAuth,
} from './authSession';

// 上游 7-20 起面板鉴权改为 Bearer access token，New-Api-User 头不再参与鉴权。
// token 由下面的请求拦截器按需补上，见 ./authSession.js。
export let API = axios.create({
  baseURL: import.meta.env.VITE_REACT_APP_SERVER_URL
    ? import.meta.env.VITE_REACT_APP_SERVER_URL
    : '',
  withCredentials: true,
  headers: {
    'Cache-Control': 'no-store',
  },
});


function redirectToOAuthUrl(url, options = {}) {
  const { openInNewTab = false } = options;
  const targetUrl = typeof url === 'string' ? url : url.toString();

  if (openInNewTab) {
    window.open(targetUrl, '_blank');
    return;
  }

  window.location.assign(targetUrl);
}


function patchAPIInstance(instance) {
  const originalGet = instance.get.bind(instance);
  const inFlightGetRequests = new Map();

  const genKey = (url, config = {}) => {
    const params = config.params ? JSON.stringify(config.params) : '{}';
    return `${url}?${params}`;
  };

  instance.get = (url, config = {}) => {
    if (config?.disableDuplicate) {
      return originalGet(url, config);
    }

    const key = genKey(url, config);
    if (inFlightGetRequests.has(key)) {
      return inFlightGetRequests.get(key);
    }

    const reqPromise = originalGet(url, config).finally(() => {
      inFlightGetRequests.delete(key);
    });

    inFlightGetRequests.set(key, reqPromise);
    return reqPromise;
  };
}

function hasAuthorizationHeader(headers) {
  if (!headers) return false;
  if (typeof headers.has === 'function') return headers.has('Authorization');
  return Boolean(headers.Authorization || headers.authorization);
}

function installAuthInterceptors(instance) {
  // 自带 Authorization（如用令牌 key 调接口）的请求不覆盖；
  // skipAuth：完全不带面板 token；skipAuthRefresh：不为这次请求触发 refresh（登录类接口）。
  instance.interceptors.request.use(async (config) => {
    if (config.skipAuth || hasAuthorizationHeader(config.headers)) {
      return config;
    }
    const token = config.skipAuthRefresh
      ? getAccessToken()
      : await ensureAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => {
      // 登录类接口返回 AuthBundle，安全设置类接口返回 token 轮换：统一在这里接管
      const body = response.data;
      if (body?.success === true && body.data && typeof body.data === 'object') {
        if (isAuthBundle(body.data)) {
          applyAuthBundle(body.data);
        } else {
          applyAuthRotation(body.data);
        }
      }
      return response;
    },
    async (error) => {
      const config = error?.config;
      if (
        error?.response?.status === 401 &&
        config &&
        !config.skipAuth &&
        !config.skipAuthRefresh &&
        !config._authRetry &&
        hasLocalUser()
      ) {
        // access token 过期或被轮换：refresh 一次后重放原请求
        config._authRetry = true;
        const outcome = await refreshAuth();
        if (outcome.kind === 'authenticated') {
          config.headers.Authorization = `Bearer ${getAccessToken()}`;
          return instance.request(config);
        }
      }
      // 如果请求配置中显式要求跳过全局错误处理，则不弹出默认错误提示
      if (config && config.skipErrorHandler) {
        return Promise.reject(error);
      }
      showError(error);
      return Promise.reject(error);
    },
  );
}

patchAPIInstance(API);
installAuthInterceptors(API);

// 以前登录后要重建实例来更新 New-Api-User 头；现在 token 由拦截器动态补上，保留空实现兼容旧调用。
export function updateAPI() {}

// 退出登录（撤销服务端登录会话、清 refresh cookie 和本地资料）
export async function logout() {
  await logoutAuth();
}

// playground

// 构建API请求负载
export const buildApiPayload = (
  messages,
  systemPrompt,
  inputs,
  parameterEnabled,
) => {
  const processedMessages = messages
    .filter(isValidMessage)
    .map(formatMessageForAPI)
    .filter(Boolean);

  // 如果有系统提示，插入到消息开头
  if (systemPrompt && systemPrompt.trim()) {
    processedMessages.unshift({
      role: MESSAGE_ROLES.SYSTEM,
      content: systemPrompt.trim(),
    });
  }

  const payload = {
    model: inputs.model,
    group: inputs.group,
    messages: processedMessages,
    stream: inputs.stream,
  };

  // 添加启用的参数
  const parameterMappings = {
    temperature: 'temperature',
    top_p: 'top_p',
    max_tokens: 'max_tokens',
    frequency_penalty: 'frequency_penalty',
    presence_penalty: 'presence_penalty',
    seed: 'seed',
  };

  Object.entries(parameterMappings).forEach(([key, param]) => {
    const enabled = parameterEnabled[key];
    const value = inputs[param];
    const hasValue = value !== undefined && value !== null;

    if (!enabled) {
      return;
    }

    if (param === 'max_tokens') {
      if (typeof value === 'number') {
        payload[param] = value;
      }
      return;
    }

    if (hasValue) {
      payload[param] = value;
    }
  });

  return payload;
};

// 处理API错误响应
export const handleApiError = (error, response = null) => {
  const errorInfo = {
    error: error.message || '未知错误',
    timestamp: new Date().toISOString(),
    stack: error.stack,
  };

  if (response) {
    errorInfo.status = response.status;
    errorInfo.statusText = response.statusText;
  }

  if (error.message.includes('HTTP error')) {
    errorInfo.details = '服务器返回了错误状态码';
  } else if (error.message.includes('Failed to fetch')) {
    errorInfo.details = '网络连接失败或服务器无响应';
  }

  return errorInfo;
};

// 处理模型数据
export const processModelsData = (data, currentModel) => {
  const modelOptions = data.map((model) => ({
    label: model,
    value: model,
  }));

  const hasCurrentModel = modelOptions.some(
    (option) => option.value === currentModel,
  );
  const selectedModel =
    hasCurrentModel && modelOptions.length > 0
      ? currentModel
      : modelOptions[0]?.value;

  return { modelOptions, selectedModel };
};

// 处理分组数据
export const processGroupsData = (data, userGroup) => {
  let groupOptions = Object.entries(data).map(([group, info]) => ({
    label:
      info.desc.length > 20 ? info.desc.substring(0, 20) + '...' : info.desc,
    value: group,
    ratio: info.ratio,
    fullLabel: info.desc,
  }));

  if (groupOptions.length === 0) {
    groupOptions = [
      {
        label: '用户分组',
        value: '',
        ratio: 1,
      },
    ];
  } else if (userGroup) {
    const userGroupIndex = groupOptions.findIndex((g) => g.value === userGroup);
    if (userGroupIndex > -1) {
      const userGroupOption = groupOptions.splice(userGroupIndex, 1)[0];
      groupOptions.unshift(userGroupOption);
    }
  }

  return groupOptions;
};

// 原来components中的utils.js

// 上游 7-20：OAuth state 改为 POST 创建一次性 AuthFlow（flow_token），区分登录与绑定。
// 绑定要带当前登录会话的 Bearer，回调页也要带同一会话的 Bearer 才能完成绑定。
export async function getOAuthState(provider, intent = 'login') {
  const body = { provider, intent };
  if (intent === 'login') {
    const affCode = localStorage.getItem('aff');
    if (affCode && affCode.length > 0 && affCode.length <= 32) {
      body.aff = affCode;
    }
  }
  const res = await API.post('/api/oauth/state', body, {
    skipAuthRefresh: intent === 'login',
  });
  const { success, message, data } = res.data;
  if (success) {
    if (typeof data === 'string') return data;
    return data?.flow_token || '';
  } else {
    showError(message);
    return '';
  }
}

async function prepareOAuthState(provider, options = {}) {
  const { shouldLogout = false } = options;
  // 登录/注册页发起的是登录流程（先退出当前账号）；个人设置里发起的是绑定流程
  if (shouldLogout) {
    try {
      await logoutAuth();
    } catch (err) {}
    return await getOAuthState(provider, 'login');
  }
  return await getOAuthState(provider, hasLocalUser() ? 'bind' : 'login');
}

export async function onDiscordOAuthClicked(client_id, options = {}) {
  const state = await prepareOAuthState('discord', options);
  if (!state) return;
  const redirect_uri = `${window.location.origin}/oauth/discord`;
  const response_type = 'code';
  const scope = 'identify+openid';
  redirectToOAuthUrl(
    `https://discord.com/oauth2/authorize?client_id=${client_id}&redirect_uri=${redirect_uri}&response_type=${response_type}&scope=${scope}&state=${state}`,
  );
}

export async function onOIDCClicked(
  auth_url,
  client_id,
  openInNewTab = false,
  options = {},
) {
  const state = await prepareOAuthState('oidc', options);
  if (!state) return;
  const url = new URL(auth_url);
  url.searchParams.set('client_id', client_id);
  url.searchParams.set('redirect_uri', `${window.location.origin}/oauth/oidc`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  redirectToOAuthUrl(url, { openInNewTab });
}

export async function onGitHubOAuthClicked(github_client_id, options = {}) {
  const state = await prepareOAuthState('github', options);
  if (!state) return;
  redirectToOAuthUrl(
    `https://github.com/login/oauth/authorize?client_id=${github_client_id}&state=${state}&scope=user:email`,
  );
}

export async function onLinuxDOOAuthClicked(
  linuxdo_client_id,
  options = { shouldLogout: false },
) {
  const state = await prepareOAuthState('linuxdo', options);
  if (!state) return;
  redirectToOAuthUrl(
    `https://connect.linux.do/oauth2/authorize?response_type=code&client_id=${linuxdo_client_id}&state=${state}`,
  );
}

/**
 * Initiate custom OAuth login
 * @param {Object} provider - Custom OAuth provider config from status API
 * @param {string} provider.slug - Provider slug (used for callback URL)
 * @param {string} provider.client_id - OAuth client ID
 * @param {string} provider.authorization_endpoint - Authorization URL
 * @param {string} provider.scopes - OAuth scopes (space-separated)
 * @param {Object} options - Options
 * @param {boolean} options.shouldLogout - Whether to logout first
 */
export async function onCustomOAuthClicked(provider, options = {}) {
  const state = await prepareOAuthState(provider.slug, options);
  if (!state) return;

  try {
    const redirect_uri = `${window.location.origin}/oauth/${provider.slug}`;

    // Check if authorization_endpoint is a full URL or relative path
    let authUrl;
    if (
      provider.authorization_endpoint.startsWith('http://') ||
      provider.authorization_endpoint.startsWith('https://')
    ) {
      authUrl = new URL(provider.authorization_endpoint);
    } else {
      // Relative path - this is a configuration error, show error message
      console.error(
        'Custom OAuth authorization_endpoint must be a full URL:',
        provider.authorization_endpoint,
      );
      showError(
        'OAuth 配置错误：授权端点必须是完整的 URL（以 http:// 或 https:// 开头）',
      );
      return;
    }

    authUrl.searchParams.set('client_id', provider.client_id);
    authUrl.searchParams.set('redirect_uri', redirect_uri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      provider.scopes || 'openid profile email',
    );
    authUrl.searchParams.set('state', state);

    redirectToOAuthUrl(authUrl);
  } catch (error) {
    console.error('Failed to initiate custom OAuth:', error);
    showError('OAuth 登录失败：' + (error.message || '未知错误'));
  }
}

let channelModels = undefined;
export async function loadChannelModels() {
  const res = await API.get('/api/models');
  const { success, data } = res.data;
  if (!success) {
    return;
  }
  channelModels = data;
  localStorage.setItem('channel_models', JSON.stringify(data));
}

export function getChannelModels(type) {
  if (channelModels !== undefined && type in channelModels) {
    if (!channelModels[type]) {
      return [];
    }
    return channelModels[type];
  }
  let models = localStorage.getItem('channel_models');
  if (!models) {
    return [];
  }
  channelModels = JSON.parse(models);
  if (type in channelModels) {
    return channelModels[type];
  }
  return [];
}
