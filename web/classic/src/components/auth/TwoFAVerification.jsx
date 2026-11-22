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
import {
  API,
  showError,
  showSuccess,
  prepareCredentialRequestOptions,
  buildAssertionResult,
  isPasskeySupported,
} from '../../helpers';
import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  Typography,
} from '@douyinfe/semi-ui';
import React, { useEffect, useRef, useState } from 'react';

const { Title, Text, Paragraph } = Typography;

// 上游 rc.36 登录验证：methods 来自登录挑战，可能是 2FA、Passkey 或两者都有
const TwoFAVerification = ({
  flowToken = '',
  methods = [],
  onSuccess,
  onBack,
  isModal = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const methodAvailable = (name) =>
    methods.some((m) => m.method === name && m.available !== false);
  // 旧调用方不传 methods 时按只有 2FA 处理
  const allow2FA = methods.length === 0 || methodAvailable('2fa');
  const allowPasskey = methodAvailable('passkey') && passkeySupported;
  const passkeyOnly = !allow2FA && methodAvailable('passkey');

  useEffect(() => {
    isPasskeySupported()
      .then(setPasskeySupported)
      .catch(() => setPasskeySupported(false));
  }, []);

  const handlePasskey = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPasskeyLoading(true);
    try {
      const beginRes = await API.post(
        '/api/user/login/passkey/begin',
        { flow_token: flowToken },
        { skipAuthRefresh: true, skipErrorHandler: true },
      );
      if (!beginRes.data?.success) {
        throw new Error(beginRes.data?.message || '无法发起 Passkey 验证');
      }
      const begin = beginRes.data.data;
      const publicKey = prepareCredentialRequestOptions(begin.options);
      let credential;
      try {
        credential = await navigator.credentials.get({ publicKey });
      } catch (error) {
        if (error?.name === 'NotAllowedError') {
          throw new Error('Passkey 验证被取消或超时');
        }
        throw error;
      }
      const assertion = credential && buildAssertionResult(credential);
      if (!assertion) {
        throw new Error('Passkey 验证被取消');
      }
      const finishRes = await API.post(
        '/api/user/login/passkey/finish',
        {
          flow_token: flowToken,
          passkey_flow_token: begin.flow_token,
          credential: assertion,
        },
        { skipAuthRefresh: true, skipErrorHandler: true },
      );
      if (!finishRes.data?.success) {
        throw new Error(finishRes.data?.message || 'Passkey 验证失败');
      }
      onSuccess?.(finishRes.data.data);
    } catch (error) {
      showError(
        error?.response?.data?.message || error.message || '验证失败，请重试',
      );
    } finally {
      submittingRef.current = false;
      setPasskeyLoading(false);
    }
  };
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  // 输入框在 Form 里，回车会同时触发 onKeyPress 和表单 onSubmit；flow_token 只能用一次，
  // 第二次请求必然失败并弹「会话已过期」，所以同一时间只放行一次提交
  const submittingRef = useRef(false);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!verificationCode) {
      showError('请输入验证码');
      return;
    }
    // 备用码展示成 XXXX-XXXX，用户照抄会带横杠/空格；后端本来就会去掉横杠再比对，
    // 这里先清洗再校验（原来直接比长度 8，照抄的备用码永远提示「必须是8位」）
    const code = useBackupCode
      ? verificationCode.replace(/[\s-]/g, '').toUpperCase()
      : verificationCode.trim();
    if (useBackupCode && !/^[A-Z0-9]{8}$/.test(code)) {
      showError('备用码必须是8位');
      return;
    } else if (!useBackupCode && !/^\d{6}$/.test(code)) {
      showError('验证码必须是6位数字');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const res = await API.post(
        '/api/user/login/verify',
        {
          method: '2fa',
          code,
          flow_token: flowToken,
        },
        { skipAuthRefresh: true, skipErrorHandler: true },
      );

      if (res.data.success) {
        // 成功提示由父组件给出；用户资料已由 API 拦截器从 AuthBundle 写入 localStorage
        if (onSuccess) {
          onSuccess(res.data.data);
        }
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error?.response?.data?.message || '验证失败，请重试');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const passkeyButton = allowPasskey ? (
    <Button
      type={passkeyOnly ? 'primary' : 'tertiary'}
      theme={passkeyOnly ? 'solid' : 'outline'}
      loading={passkeyLoading}
      disabled={loading}
      block
      size='large'
      style={{ marginBottom: 16 }}
      onClick={handlePasskey}
    >
      使用 Passkey 验证
    </Button>
  ) : null;

  const passkeyUnsupportedHint =
    passkeyOnly && !passkeySupported ? (
      <Paragraph type='danger'>
        这个账户需要用 Passkey 完成登录验证，但当前设备或浏览器不支持 Passkey。
      </Paragraph>
    ) : null;

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  if (isModal) {
    return (
      <div className='space-y-4'>
        <Paragraph className='text-gray-600 dark:text-gray-300'>
          {allow2FA
            ? '请输入认证器应用显示的验证码完成登录'
            : '请使用已绑定的 Passkey 完成登录验证'}
        </Paragraph>

        {passkeyUnsupportedHint}
        {passkeyOnly && passkeyButton}

        {allow2FA && (
        <Form onSubmit={handleSubmit}>
          <Form.Input
            field='code'
            label={useBackupCode ? '备用码' : '验证码'}
            placeholder={useBackupCode ? '请输入8位备用码' : '请输入6位验证码'}
            value={verificationCode}
            onChange={setVerificationCode}
            onKeyPress={handleKeyPress}
            size='large'
            style={{ marginBottom: 16 }}
            autoFocus
          />

          <Button
            htmlType='submit'
            type='primary'
            loading={loading}
            block
            size='large'
            style={{ marginBottom: 16 }}
          >
            验证并登录
          </Button>
        </Form>
        )}

        {!passkeyOnly && passkeyButton}

        <Divider />

        <div style={{ textAlign: 'center' }}>
          {allow2FA && (
          <Button
            theme='borderless'
            type='tertiary'
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setVerificationCode('');
            }}
            style={{ marginRight: 16, color: '#1890ff', padding: 0 }}
          >
            {useBackupCode ? '使用认证器验证码' : '使用备用码'}
          </Button>
          )}

          {onBack && (
            <Button
              theme='borderless'
              type='tertiary'
              onClick={onBack}
              style={{ color: '#1890ff', padding: 0 }}
            >
              返回登录
            </Button>
          )}
        </div>

        <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-3'>
          <Text size='small' type='secondary'>
            <strong>提示：</strong>
            <br />
            • 验证码每30秒更新一次
            <br />
            • 如果无法获取验证码，请使用备用码
            <br />• 每个备用码只能使用一次
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
      }}
    >
      <Card style={{ width: 400, padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title heading={3}>两步验证</Title>
          <Paragraph type='secondary'>
            {allow2FA
              ? '请输入认证器应用显示的验证码完成登录'
              : '请使用已绑定的 Passkey 完成登录验证'}
          </Paragraph>
        </div>

        {passkeyUnsupportedHint}
        {passkeyOnly && passkeyButton}

        {allow2FA && (
        <Form onSubmit={handleSubmit}>
          <Form.Input
            field='code'
            label={useBackupCode ? '备用码' : '验证码'}
            placeholder={useBackupCode ? '请输入8位备用码' : '请输入6位验证码'}
            value={verificationCode}
            onChange={setVerificationCode}
            onKeyPress={handleKeyPress}
            size='large'
            style={{ marginBottom: 16 }}
            autoFocus
          />

          <Button
            htmlType='submit'
            type='primary'
            loading={loading}
            block
            size='large'
            style={{ marginBottom: 16 }}
          >
            验证并登录
          </Button>
        </Form>
        )}

        {!passkeyOnly && passkeyButton}

        <Divider />

        <div style={{ textAlign: 'center' }}>
          {allow2FA && (
          <Button
            theme='borderless'
            type='tertiary'
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setVerificationCode('');
            }}
            style={{ marginRight: 16, color: '#1890ff', padding: 0 }}
          >
            {useBackupCode ? '使用认证器验证码' : '使用备用码'}
          </Button>
          )}

          {onBack && (
            <Button
              theme='borderless'
              type='tertiary'
              onClick={onBack}
              style={{ color: '#1890ff', padding: 0 }}
            >
              返回登录
            </Button>
          )}
        </div>

        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: '#f6f8fa',
            borderRadius: 6,
          }}
        >
          <Text size='small' type='secondary'>
            <strong>提示：</strong>
            <br />
            • 验证码每30秒更新一次
            <br />
            • 如果无法获取验证码，请使用备用码
            <br />• 每个备用码只能使用一次
          </Text>
        </div>
      </Card>
    </div>
  );
};

export default TwoFAVerification;
