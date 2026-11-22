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

import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SecureVerificationService,
  openOAuthPopupWindow,
} from '../../services/secureVerification';
import { showError, showSuccess } from '../../helpers';
import { isVerificationRequiredError } from '../../helpers/secureApiCall';

// 默认选中顺序：Passkey > 两步验证 > 密码 > 第三方账号
const METHOD_ORDER = ['passkey', '2fa', 'password', 'oauth'];

const EMPTY_REQUIREMENTS = {
  methods: [],
  oauth_providers: [],
  password_encryption_enabled: false,
};

function summarize(requirements) {
  const available = (method) =>
    requirements.methods.some((m) => m.method === method && m.available);
  return {
    has2FA: available('2fa'),
    hasPasskey: available('passkey'),
    passkeySupported: requirements.passkeySupported !== false,
    hasPassword: available('password'),
    hasOAuth: available('oauth') && requirements.oauth_providers.length > 0,
  };
}

/**
 * 通用安全验证 Hook（上游 rc.36：按操作 scope + context 取验证方式，验证后拿一次性 proof）
 * @param {Object} options - 配置选项
 * @param {Function} options.onSuccess - 业务调用成功回调
 * @param {Function} options.onError - 验证或业务调用失败回调
 * @param {string} options.successMessage - 成功提示消息
 * @param {boolean} options.autoReset - 完成后是否自动关闭弹窗，默认为 true
 */
export const useSecureVerification = ({
  onSuccess,
  onError,
  successMessage,
  autoReset = true,
} = {}) => {
  const { t } = useTranslation();

  const [requirements, setRequirements] = useState(EMPTY_REQUIREMENTS);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [verificationState, setVerificationState] = useState({
    method: null, // '2fa' | 'passkey' | 'password' | 'oauth'
    loading: false,
    code: '',
    apiCall: null,
  });
  // 防止连点重复提交（2FA 验证码、proof 都只能用一次）
  const submittingRef = useRef(false);

  const resetState = useCallback(() => {
    setVerificationState({
      method: null,
      loading: false,
      code: '',
      apiCall: null,
    });
    setRequirements(EMPTY_REQUIREMENTS);
    setIsModalVisible(false);
  }, []);

  /**
   * 开始验证流程
   * @param {Function} apiCall - (proof) => Promise，拿到 proof 后执行的业务调用
   * @param {Object} options - { scope, context, title, description, preferredMethod }
   */
  const startVerification = useCallback(
    async (apiCall, options = {}) => {
      const { preferredMethod, title, description, scope, context } = options;
      if (!scope) {
        showError(t('验证配置错误'));
        return false;
      }

      let loaded;
      try {
        loaded = await SecureVerificationService.getRequirements(scope);
      } catch (error) {
        showError(error.message || t('获取验证方式失败'));
        onError?.(error);
        return false;
      }

      const usable = loaded.methods.filter(
        (m) =>
          m.available && (m.method !== 'oauth' || loaded.oauth_providers.length),
      );
      if (usable.length === 0) {
        const reason =
          loaded.methods.find((m) => m.reason)?.reason ||
          t('当前没有可用的验证方式');
        showError(reason);
        onError?.(new Error(reason));
        return false;
      }

      let defaultMethod = usable.some((m) => m.method === preferredMethod)
        ? preferredMethod
        : METHOD_ORDER.find((method) =>
            usable.some((m) => m.method === method),
          );

      setRequirements(loaded);
      setVerificationState({
        method: defaultMethod,
        loading: false,
        code: '',
        apiCall,
        title,
        description,
        scope,
        context,
      });
      setIsModalVisible(true);
      return true;
    },
    [onError, t],
  );

  /**
   * 执行验证
   * @param {string} method - 验证方式
   * @param {string} code - 2FA 验证码 / 密码
   * @param {Object} extra - { provider }（OAuth）
   */
  const executeVerification = useCallback(
    async (method, code = '', extra = {}) => {
      if (!verificationState.apiCall) {
        showError(t('验证配置错误'));
        return;
      }
      if (submittingRef.current) return;
      submittingRef.current = true;

      // OAuth 弹窗必须在点击事件里同步打开
      const popup = method === 'oauth' ? openOAuthPopupWindow() : null;

      setVerificationState((prev) => ({ ...prev, loading: true }));
      const apiCall = verificationState.apiCall;
      let proof;
      try {
        const input =
          method === 'password'
            ? { password: code }
            : method === 'oauth'
              ? { provider: extra.provider, popup }
              : { code };
        proof = await SecureVerificationService.verify(
          method,
          input,
          {
            scope: verificationState.scope,
            context: verificationState.context,
          },
          {
            passwordEncryptionEnabled: requirements.password_encryption_enabled,
          },
        );
      } catch (error) {
        // 验证本身失败：弹窗保留，让用户重输或换方式
        if (popup && !popup.closed) popup.close();
        if (error?.code !== 'AUTH_CANCELLED') {
          showError(error.message || t('验证失败，请重试'));
        }
        onError?.(error);
        submittingRef.current = false;
        setVerificationState((prev) => ({ ...prev, loading: false }));
        return;
      }

      // 验证已通过（proof 一次性，业务调用会把它用掉）：和上游新版一样先关验证弹窗，
      // 业务失败只提示错误，重试时重新走一遍验证
      if (autoReset) {
        resetState();
      }
      try {
        // 带上 proof 调用业务 API（X-Security-Proof 请求头）
        const result = await apiCall(proof);
        if (successMessage) {
          showSuccess(successMessage);
        }
        onSuccess?.(result, method);
        return result;
      } catch (error) {
        showError(error.message || t('操作失败，请重试'));
        onError?.(error);
      } finally {
        submittingRef.current = false;
        setVerificationState((prev) => ({ ...prev, loading: false }));
      }
    },
    [
      verificationState.apiCall,
      verificationState.scope,
      verificationState.context,
      requirements.password_encryption_enabled,
      successMessage,
      onSuccess,
      onError,
      autoReset,
      resetState,
      t,
    ],
  );

  const setVerificationCode = useCallback((code) => {
    setVerificationState((prev) => ({ ...prev, code }));
  }, []);

  const switchVerificationMethod = useCallback((method) => {
    setVerificationState((prev) => ({ ...prev, method, code: '' }));
  }, []);

  const cancelVerification = useCallback(() => {
    resetState();
  }, [resetState]);

  /**
   * 包装 API 调用：先不带 proof 调一次，后端要求安全验证（403 SECURITY_PROOF_*）时再弹出验证
   */
  const withVerification = useCallback(
    async (apiCall, options = {}) => {
      try {
        return await apiCall();
      } catch (error) {
        if (isVerificationRequiredError(error)) {
          await startVerification(apiCall, options);
          return null;
        }
        throw error;
      }
    },
    [startVerification],
  );

  const verificationMethods = summarize(requirements);

  return {
    // 状态
    isModalVisible,
    verificationMethods,
    requirements,
    verificationState,

    // 方法
    startVerification,
    executeVerification,
    cancelVerification,
    resetState,
    setVerificationCode,
    switchVerificationMethod,
    withVerification,

    // 便捷属性
    isLoading: verificationState.loading,
    currentMethod: verificationState.method,
    code: verificationState.code,
  };
};
