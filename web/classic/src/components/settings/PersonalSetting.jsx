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

import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  API,
  copy,
  showError,
  showInfo,
  showSuccess,
  setStatusData,
  prepareCredentialCreationOptions,
  buildRegistrationResult,
  isPasskeySupported,
  setUserData,
  logout as logoutSession,
} from '../../helpers';
import { UserContext } from '../../context/User';
import { Modal } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

// 导入子组件
import UserInfoHeader from './personal/components/UserInfoHeader';
import AccountManagement from './personal/cards/AccountManagement';
import NotificationSettings from './personal/cards/NotificationSettings';
import PreferencesSettings from './personal/cards/PreferencesSettings';
import CheckinCalendar from './personal/cards/CheckinCalendar';
import EmailBindModal from './personal/modals/EmailBindModal';
import WeChatBindModal from './personal/modals/WeChatBindModal';
import AccountDeleteModal from './personal/modals/AccountDeleteModal';
import ChangePasswordModal from './personal/modals/ChangePasswordModal';
import SecureVerificationModal from '../common/modals/SecureVerificationModal';
import { useSecureVerification } from '../../hooks/common/useSecureVerification';
import {
  securityResult,
  securityRequestConfig,
  withProof,
} from '../../services/secureVerification';

const PersonalSetting = () => {
  const [userState, userDispatch] = useContext(UserContext);
  let navigate = useNavigate();
  const { t } = useTranslation();

  const [inputs, setInputs] = useState({
    wechat_verification_code: '',
    email_verification_code: '',
    email_old_code: '',
    email: '',
    self_account_deletion_confirmation: '',
    original_password: '',
    set_new_password: '',
    set_new_password_confirmation: '',
  });
  const [status, setStatus] = useState({});
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showWeChatBindModal, setShowWeChatBindModal] = useState(false);
  const [showEmailBindModal, setShowEmailBindModal] = useState(false);
  const [showAccountDeleteModal, setShowAccountDeleteModal] = useState(false);
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0);
  // token 只能用一次：每次提交后清空并重新挂载组件，拿新的 token
  const resetTurnstile = () => {
    setTurnstileToken('');
    setTurnstileWidgetKey((v) => v + 1);
  };
  const [loading, setLoading] = useState(false);
  const [disableButton, setDisableButton] = useState(false);
  const [countdown, setCountdown] = useState(30);
  // 上游 rc.36 邮箱绑定：start 返回 flow_token，换绑时还要原邮箱的验证码
  const [emailBindFlow, setEmailBindFlow] = useState(null);
  const [passkeyStatus, setPasskeyStatus] = useState({ enabled: false });
  const [passkeyRegisterLoading, setPasskeyRegisterLoading] = useState(false);
  const [passkeyDeleteLoading, setPasskeyDeleteLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState({
    warningType: 'email',
    warningThreshold: 100000,
    webhookUrl: '',
    webhookSecret: '',
    notificationEmail: '',
    barkUrl: '',
    gotifyUrl: '',
    gotifyToken: '',
    gotifyPriority: 5,
    upstreamModelUpdateNotifyEnabled: false,
    acceptUnsetModelRatioModel: false,
    recordIpLog: false,
  });

  // 上游 rc.36：所有敏感操作都要先做安全验证（按 scope 取可用方式，验证后拿一次性 proof）
  const security = useSecureVerification();
  const startSecurity = (apiCall, options) =>
    security.startVerification(apiCall, { title: t('安全验证'), ...options });
  const hasPassword = userState?.user?.has_password !== false;

  useEffect(() => {
    let saved = localStorage.getItem('status');
    if (saved) {
      const parsed = JSON.parse(saved);
      setStatus(parsed);
      if (parsed.turnstile_check) {
        setTurnstileEnabled(true);
        setTurnstileSiteKey(parsed.turnstile_site_key);
      } else {
        setTurnstileEnabled(false);
        setTurnstileSiteKey('');
      }
    }
    // Always refresh status from server to avoid stale flags (e.g., admin just enabled OAuth)
    (async () => {
      try {
        const res = await API.get('/api/status');
        const { success, data } = res.data;
        if (success && data) {
          setStatus(data);
          setStatusData(data);
          if (data.turnstile_check) {
            setTurnstileEnabled(true);
            setTurnstileSiteKey(data.turnstile_site_key);
          } else {
            setTurnstileEnabled(false);
            setTurnstileSiteKey('');
          }
        }
      } catch (e) {
        // ignore and keep local status
      }
    })();

    getUserData();

    isPasskeySupported()
      .then(setPasskeySupported)
      .catch(() => setPasskeySupported(false));
  }, []);

  useEffect(() => {
    let countdownInterval = null;
    if (disableButton && countdown > 0) {
      countdownInterval = setInterval(() => {
        setCountdown(countdown - 1);
      }, 1000);
    } else if (countdown === 0) {
      setDisableButton(false);
      setCountdown(30);
    }
    return () => clearInterval(countdownInterval); // Clean up on unmount
  }, [disableButton, countdown]);

  useEffect(() => {
    if (userState?.user?.setting) {
      const settings = JSON.parse(userState.user.setting);
      setNotificationSettings({
        warningType: settings.notify_type || 'email',
        warningThreshold: settings.quota_warning_threshold || 500000,
        webhookUrl: settings.webhook_url || '',
        webhookSecret: settings.webhook_secret || '',
        notificationEmail: settings.notification_email || '',
        barkUrl: settings.bark_url || '',
        gotifyUrl: settings.gotify_url || '',
        gotifyToken: settings.gotify_token || '',
        gotifyPriority:
          settings.gotify_priority !== undefined ? settings.gotify_priority : 5,
        upstreamModelUpdateNotifyEnabled:
          settings.upstream_model_update_notify_enabled === true,
        acceptUnsetModelRatioModel:
          settings.accept_unset_model_ratio_model || false,
        recordIpLog: settings.record_ip_log || false,
      });
    }
  }, [userState?.user?.setting]);

  const handleInputChange = (name, value) => {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const loadPasskeyStatus = async () => {
    try {
      const res = await API.get('/api/user/passkey');
      const { success, data, message } = res.data;
      if (success) {
        setPasskeyStatus({
          enabled: data?.enabled || false,
          last_used_at: data?.last_used_at || null,
          backup_eligible: data?.backup_eligible || false,
          backup_state: data?.backup_state || false,
        });
      } else {
        showError(message);
      }
    } catch (error) {
      // 忽略错误，保留默认状态
    }
  };

  // 注册 Passkey：begin 带 passkey.register 的 X-Security-Proof，finish 只认 begin 返回的 flow_token
  const registerPasskey = async (proof) => {
    setPasskeyRegisterLoading(true);
    try {
      const data = await securityResult(
        API.post('/api/user/passkey/register/begin', null, withProof(proof)),
        t('无法发起 Passkey 注册'),
      );

      const publicKey = prepareCredentialCreationOptions(
        data?.options || data?.publicKey || data,
      );
      let credential;
      try {
        credential = await navigator.credentials.create({ publicKey });
      } catch (error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
          showInfo(t('已取消 Passkey 注册'));
          return { cancelled: true };
        }
        throw error;
      }
      const payload = buildRegistrationResult(credential);
      if (!payload) {
        throw new Error(t('Passkey 注册失败，请重试'));
      }

      const finish = await securityResult(
        API.post(
          '/api/user/passkey/register/finish',
          { flow_token: data?.flow_token, credential: payload },
          securityRequestConfig,
        ),
        t('Passkey 注册失败，请重试'),
      );

      showSuccess(t('Passkey 注册成功'));
      await loadPasskeyStatus();
      return finish;
    } finally {
      setPasskeyRegisterLoading(false);
    }
  };

  const handleRegisterPasskey = async () => {
    if (!passkeySupported || !window.PublicKeyCredential) {
      showInfo(t('当前设备不支持 Passkey'));
      return;
    }
    await startSecurity(registerPasskey, { scope: 'passkey.register' });
  };

  const removePasskey = async (proof) => {
    setPasskeyDeleteLoading(true);
    try {
      await securityResult(
        API.delete('/api/user/passkey', withProof(proof)),
        t('操作失败，请重试'),
      );
      showSuccess(t('Passkey 已解绑'));
      await loadPasskeyStatus();
    } finally {
      setPasskeyDeleteLoading(false);
    }
  };

  const handleRemovePasskey = async () => {
    await startSecurity(removePasskey, { scope: 'passkey.delete' });
  };

  // 绑定第三方账号：先验证（account.binding.bind {provider}），再带 proof 申请 OAuth state 并跳转授权
  const startOAuthBind = (provider, launch) =>
    startSecurity(
      async (proof) => {
        const ok = await launch(proof);
        if (ok === false) throw new Error(t('发起绑定失败'));
      },
      {
        scope: 'account.binding.bind',
        context: { provider },
        description: t(
          '绑定新的登录方式前需要验证身份，验证后会跳转到授权页面。',
        ),
      },
    );

  // 解绑自定义 OAuth：account.binding.unbind {provider_id}
  const startCustomOAuthUnbind = (providerId, onDone) =>
    startSecurity(
      async (proof) => {
        await securityResult(
          API.delete(
            `/api/user/oauth/bindings/${providerId}`,
            withProof(proof),
          ),
          t('操作失败'),
        );
        showSuccess(t('解绑成功'));
        await onDone?.();
      },
      {
        scope: 'account.binding.unbind',
        context: { provider_id: Number(providerId) },
        description: t('解绑后将不能再用这个账号登录，请先验证身份。'),
      },
    );

  const getUserData = async () => {
    let res = await API.get(`/api/user/self`);
    const { success, message, data } = res.data;
    if (success) {
      userDispatch({ type: 'login', payload: data });
      setUserData(data);
      await loadPasskeyStatus();
    } else {
      showError(message);
    }
  };

  const deleteAccount = async () => {
    if (inputs.self_account_deletion_confirmation !== userState.user.username) {
      showError(t('请输入你的账户名以确认删除！'));
      return;
    }
    await startSecurity(
      async (proof) => {
        await securityResult(
          API.delete('/api/user/self', withProof(proof)),
          t('删除账户失败'),
        );
        showSuccess(t('账户已删除！'));
        setShowAccountDeleteModal(false);
        await logoutSession();
        userDispatch({ type: 'logout' });
        localStorage.removeItem('user');
        navigate('/login');
      },
      {
        scope: 'account.delete',
        title: t('确认删除账户'),
        description: t('删除后账户数据无法恢复，请验证身份。'),
      },
    );
  };

  const bindWeChat = async () => {
    const code = inputs.wechat_verification_code.trim();
    if (code === '') return;
    await startSecurity(
      async (proof) => {
        await securityResult(
          API.post('/api/oauth/wechat/bind', { code }, withProof(proof)),
          t('微信绑定失败'),
        );
        showSuccess(t('微信账户绑定成功！'));
        setShowWeChatBindModal(false);
        getUserData();
      },
      { scope: 'account.binding.bind', context: { provider: 'wechat', code } },
    );
  };

  const changePassword = async () => {
    if (hasPassword && inputs.original_password === '') {
      showError(t('请输入原密码！'));
      return;
    }
    if (inputs.set_new_password === '') {
      showError(t('请输入新密码！'));
      return;
    }
    if (inputs.original_password === inputs.set_new_password) {
      showError(t('新密码需要和原密码不一致！'));
      return;
    }
    if (inputs.set_new_password !== inputs.set_new_password_confirmation) {
      showError(t('两次输入的密码不一致！'));
      return;
    }
    // 上游 rc.36：改密码（account.password.change）/ 首次设置密码（account.password.set）都要先验证；
    // 成功后返回当前会话的 token 轮换，其他登录会话全部失效
    await startSecurity(
      async (proof) => {
        await securityResult(
          API.put(
            '/api/user/self',
            {
              ...(hasPassword
                ? { original_password: inputs.original_password }
                : {}),
              password: inputs.set_new_password,
            },
            withProof(proof),
          ),
          t('密码修改失败'),
        );
        showSuccess(hasPassword ? t('密码修改成功！') : t('密码设置成功！'));
        setShowChangePasswordModal(false);
        setInputs((prev) => ({
          ...prev,
          original_password: '',
          set_new_password: '',
          set_new_password_confirmation: '',
        }));
        getUserData();
      },
      {
        scope: hasPassword ? 'account.password.change' : 'account.password.set',
        description: t('修改密码后，其他设备上的登录会全部退出。'),
      },
    );
  };

  const startResendCountdown = (resendAt) => {
    const wait = resendAt
      ? Math.max(1, Math.ceil(resendAt - Date.now() / 1000))
      : 30;
    setCountdown(wait);
    setDisableButton(true);
  };

  const resetEmailBind = () => {
    setEmailBindFlow(null);
    setInputs((prev) => ({
      ...prev,
      email_verification_code: '',
      email_old_code: '',
    }));
  };

  // 上游 rc.36 邮箱绑定：验证身份（account.binding.bind {provider: email, email}）→ start 发验证码 →
  // 输入新邮箱（换绑时还有原邮箱）的验证码 → bind
  const sendVerificationCode = async () => {
    const email = inputs.email.trim();
    if (email === '') {
      showError(t('请输入邮箱！'));
      return;
    }
    if (emailBindFlow?.flow_token && emailBindFlow.email === email) {
      setLoading(true);
      try {
        const data = await securityResult(
          API.post(
            '/api/oauth/email/bind/resend',
            { flow_token: emailBindFlow.flow_token },
            securityRequestConfig,
          ),
          t('发送验证码失败'),
        );
        setEmailBindFlow((prev) => ({ ...prev, ...data }));
        showSuccess(t('验证码发送成功，请检查邮箱！'));
        startResendCountdown(data?.resend_at);
      } catch (error) {
        showError(error.message);
      } finally {
        setLoading(false);
      }
      return;
    }
    await startSecurity(
      async (proof) => {
        const data = await securityResult(
          API.post('/api/oauth/email/bind/start', { email }, withProof(proof)),
          t('发送验证码失败'),
        );
        setEmailBindFlow(data);
        showSuccess(
          data?.old_email_required
            ? t('验证码已发送到新邮箱和原邮箱，请检查邮箱！')
            : t('验证码发送成功，请检查邮箱！'),
        );
        if (data?.notification_warning) {
          showInfo(t('部分安全通知邮件发送失败'));
        }
        startResendCountdown(data?.resend_at);
      },
      {
        scope: 'account.binding.bind',
        context: { provider: 'email', email },
        description: t('绑定或更换邮箱前需要验证身份。'),
      },
    );
  };

  const bindEmail = async () => {
    if (!emailBindFlow?.flow_token) {
      showError(t('请先获取邮箱验证码！'));
      return;
    }
    if (inputs.email_verification_code.trim() === '') {
      showError(t('请输入邮箱验证码！'));
      return;
    }
    if (
      emailBindFlow.old_email_required &&
      inputs.email_old_code.trim() === ''
    ) {
      showError(t('请输入原邮箱收到的验证码！'));
      return;
    }
    setLoading(true);
    try {
      await securityResult(
        API.post(
          '/api/oauth/email/bind',
          {
            flow_token: emailBindFlow.flow_token,
            new_code: inputs.email_verification_code.trim(),
            ...(emailBindFlow.old_email_required
              ? { old_code: inputs.email_old_code.trim() }
              : {}),
          },
          securityRequestConfig,
        ),
        t('邮箱绑定失败'),
      );
      showSuccess(t('邮箱账户绑定成功！'));
      setShowEmailBindModal(false);
      resetEmailBind();
      getUserData();
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text) => {
    if (await copy(text)) {
      showSuccess(t('已复制：') + text);
    } else {
      // setSearchKeyword(text);
      Modal.error({ title: t('无法复制到剪贴板，请手动复制'), content: text });
    }
  };

  const handleNotificationSettingChange = (type, value) => {
    setNotificationSettings((prev) => ({
      ...prev,
      [type]: value.target
        ? value.target.value !== undefined
          ? value.target.value
          : value.target.checked
        : value, // handle checkbox properly
    }));
  };

  const saveNotificationSettings = async () => {
    try {
      const res = await API.put('/api/user/setting', {
        notify_type: notificationSettings.warningType,
        quota_warning_threshold: parseFloat(
          notificationSettings.warningThreshold,
        ),
        webhook_url: notificationSettings.webhookUrl,
        webhook_secret: notificationSettings.webhookSecret,
        notification_email: notificationSettings.notificationEmail,
        bark_url: notificationSettings.barkUrl,
        gotify_url: notificationSettings.gotifyUrl,
        gotify_token: notificationSettings.gotifyToken,
        gotify_priority: (() => {
          const parsed = parseInt(notificationSettings.gotifyPriority);
          return isNaN(parsed) ? 5 : parsed;
        })(),
        upstream_model_update_notify_enabled:
          notificationSettings.upstreamModelUpdateNotifyEnabled === true,
        accept_unset_model_ratio_model:
          notificationSettings.acceptUnsetModelRatioModel,
        record_ip_log: notificationSettings.recordIpLog,
      });

      if (res.data.success) {
        showSuccess(t('设置保存成功'));
        await getUserData();
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('设置保存失败'));
    }
  };

  return (
    <div className='mt-[60px]'>
      <div className='flex justify-center'>
        <div className='w-full max-w-7xl mx-auto px-2'>
          {/* 顶部用户信息区域 */}
          <UserInfoHeader t={t} userState={userState} />

          {/* 签到日历 - 仅在启用时显示 */}
          {status?.checkin_enabled && (
            <div className='mt-4 md:mt-6'>
              <CheckinCalendar
                t={t}
                status={status}
                turnstileEnabled={turnstileEnabled}
                turnstileSiteKey={turnstileSiteKey}
              />
            </div>
          )}

          {/* 账户管理和其他设置 */}
          <div className='grid grid-cols-1 xl:grid-cols-2 items-start gap-4 md:gap-6 mt-4 md:mt-6'>
            {/* 左侧：账户管理设置 */}
            <div className='flex flex-col gap-4 md:gap-6'>
              <AccountManagement
                t={t}
                userState={userState}
                status={status}
                setShowEmailBindModal={setShowEmailBindModal}
                setShowWeChatBindModal={setShowWeChatBindModal}
                hasPassword={hasPassword}
                onOAuthBind={startOAuthBind}
                onCustomOAuthUnbind={startCustomOAuthUnbind}
                setShowChangePasswordModal={setShowChangePasswordModal}
                setShowAccountDeleteModal={setShowAccountDeleteModal}
                passkeyStatus={passkeyStatus}
                passkeySupported={passkeySupported}
                passkeyRegisterLoading={passkeyRegisterLoading}
                passkeyDeleteLoading={passkeyDeleteLoading}
                onPasskeyRegister={handleRegisterPasskey}
                onPasskeyDelete={handleRemovePasskey}
              />

              {/* 偏好设置（语言等） */}
              <PreferencesSettings t={t} />
            </div>

            {/* 右侧：其他设置 */}
            <NotificationSettings
              t={t}
              notificationSettings={notificationSettings}
              handleNotificationSettingChange={handleNotificationSettingChange}
              saveNotificationSettings={saveNotificationSettings}
            />
          </div>
        </div>
      </div>

      {/* 模态框组件 */}
      <EmailBindModal
        t={t}
        showEmailBindModal={showEmailBindModal}
        setShowEmailBindModal={(visible) => {
          setShowEmailBindModal(visible);
          if (!visible) resetEmailBind();
        }}
        inputs={inputs}
        handleInputChange={handleInputChange}
        sendVerificationCode={sendVerificationCode}
        bindEmail={bindEmail}
        emailBindFlow={emailBindFlow}
        disableButton={disableButton}
        loading={loading}
        countdown={countdown}
      />

      <WeChatBindModal
        t={t}
        showWeChatBindModal={showWeChatBindModal}
        setShowWeChatBindModal={setShowWeChatBindModal}
        inputs={inputs}
        handleInputChange={handleInputChange}
        bindWeChat={bindWeChat}
        status={status}
      />

      <AccountDeleteModal
        t={t}
        showAccountDeleteModal={showAccountDeleteModal}
        setShowAccountDeleteModal={setShowAccountDeleteModal}
        inputs={inputs}
        handleInputChange={handleInputChange}
        deleteAccount={deleteAccount}
        userState={userState}
        turnstileEnabled={turnstileEnabled}
        turnstileSiteKey={turnstileSiteKey}
        setTurnstileToken={setTurnstileToken}
      />

      <ChangePasswordModal
        t={t}
        showChangePasswordModal={showChangePasswordModal}
        setShowChangePasswordModal={setShowChangePasswordModal}
        inputs={inputs}
        handleInputChange={handleInputChange}
        changePassword={changePassword}
        hasPassword={hasPassword}
        turnstileEnabled={turnstileEnabled}
        turnstileSiteKey={turnstileSiteKey}
        setTurnstileToken={setTurnstileToken}
      />

      <SecureVerificationModal
        visible={security.isModalVisible}
        requirements={security.requirements}
        verificationState={security.verificationState}
        onVerify={security.executeVerification}
        onCancel={security.cancelVerification}
        onCodeChange={security.setVerificationCode}
        onMethodSwitch={security.switchVerificationMethod}
        title={security.verificationState.title}
        description={security.verificationState.description}
      />
    </div>
  );
};

export default PersonalSetting;
