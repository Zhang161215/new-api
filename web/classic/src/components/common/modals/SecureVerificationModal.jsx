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

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Button,
  Input,
  Typography,
  Tabs,
  TabPane,
} from '@douyinfe/semi-ui';
import { IconGithubLogo, IconLock } from '@douyinfe/semi-icons';
import { getOAuthProviderIcon } from '../../../helpers';

const KeyIcon = ({ size = 16, style }) => (
  <svg
    style={{ width: size, height: size, flexShrink: 0, ...style }}
    fill='currentColor'
    viewBox='0 0 20 20'
  >
    <path
      fillRule='evenodd'
      d='M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z'
      clipRule='evenodd'
    />
  </svg>
);

const footerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  flexWrap: 'wrap',
};

const hintStyle = {
  display: 'block',
  marginBottom: '20px',
  fontSize: '13px',
  lineHeight: '1.5',
};

function providerIcon(slug) {
  if (slug === 'github') return <IconGithubLogo />;
  try {
    const icon = getOAuthProviderIcon?.(slug, 16);
    if (icon) return icon;
  } catch (e) {}
  return null;
}

/**
 * 通用安全验证模态框组件（配合 useSecureVerification Hook 使用）
 * 标签页由服务端返回的可用验证方式决定：两步验证 / Passkey / 密码 / 已绑定的第三方账号
 * @param {Object} props
 * @param {boolean} props.visible - 是否显示模态框
 * @param {Object} props.requirements - useSecureVerification 返回的 requirements
 * @param {Object} props.verificationState - 当前验证状态
 * @param {Function} props.onVerify - (method, codeOrPassword, extra) 验证回调
 * @param {Function} props.onCancel - 取消回调
 * @param {Function} props.onCodeChange - 验证码/密码输入回调
 * @param {Function} props.onMethodSwitch - 验证方式切换回调
 * @param {string} props.title - 模态框标题
 * @param {string} props.description - 验证描述文本
 */
const SecureVerificationModal = ({
  visible,
  requirements,
  verificationState,
  onVerify,
  onCancel,
  onCodeChange,
  onMethodSwitch,
  title,
  description,
}) => {
  const { t } = useTranslation();
  const { method, loading, code } = verificationState;
  const methods = requirements?.methods || [];
  const oauthProviders = requirements?.oauth_providers || [];

  const find = (name) => methods.find((m) => m.method === name);
  const enabled = (name) => Boolean(find(name)?.available);
  const show2FA = Boolean(find('2fa'));
  const showPasskey = Boolean(find('passkey'));
  const showPassword = Boolean(find('password'));
  const showOAuth = Boolean(find('oauth'));

  const unavailableHint = (name) => {
    const option = find(name);
    if (!option || option.available) return null;
    return (
      <Typography.Text type='warning' style={hintStyle}>
        {option.reason ? t(option.reason) : t('该验证方式当前不可用')}
      </Typography.Text>
    );
  };

  const handleKeyDown = (e) => {
    if (
      e.key === 'Enter' &&
      code &&
      !loading &&
      (method === '2fa' || method === 'password') &&
      enabled(method)
    ) {
      onVerify(method, code);
    }
    if (e.key === 'Escape' && !loading) {
      onCancel();
    }
  };

  const cancelButton = (
    <Button onClick={onCancel} disabled={loading}>
      {t('取消')}
    </Button>
  );

  return (
    <Modal
      title={title || t('安全验证')}
      visible={visible}
      onCancel={loading ? undefined : onCancel}
      closeOnEsc={!loading}
      footer={null}
      width={460}
      centered
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      bodyStyle={{ padding: '20px 24px' }}
    >
      <div style={{ width: '100%' }}>
        {description && (
          <Typography.Paragraph
            type='tertiary'
            style={{ margin: '0 0 20px 0', fontSize: '14px', lineHeight: '1.6' }}
          >
            {description}
          </Typography.Paragraph>
        )}

        <Tabs
          activeKey={method}
          onChange={onMethodSwitch}
          type='line'
          size='default'
          style={{ margin: 0 }}
        >
          {show2FA && (
            <TabPane tab={t('两步验证')} itemKey='2fa'>
              <div style={{ paddingTop: '20px' }}>
                {unavailableHint('2fa')}
                <div style={{ marginBottom: '12px' }}>
                  <Input
                    placeholder={t('请输入6位验证码或8位备用码')}
                    value={method === '2fa' ? code : ''}
                    onChange={onCodeChange}
                    size='large'
                    maxLength={10}
                    onKeyDown={handleKeyDown}
                    autoFocus={method === '2fa'}
                    disabled={loading || !enabled('2fa')}
                    prefix={<KeyIcon style={{ marginRight: 8 }} />}
                    style={{ width: '100%' }}
                  />
                </div>
                <Typography.Text type='tertiary' size='small' style={hintStyle}>
                  {t('从认证器应用中获取验证码，或使用备用码')}
                </Typography.Text>
                <div style={footerStyle}>
                  {cancelButton}
                  <Button
                    theme='solid'
                    type='primary'
                    loading={loading}
                    disabled={!code?.trim() || loading || !enabled('2fa')}
                    onClick={() => onVerify('2fa', code)}
                  >
                    {t('验证')}
                  </Button>
                </div>
              </div>
            </TabPane>
          )}

          {showPasskey && (
            <TabPane tab={t('Passkey')} itemKey='passkey'>
              <div style={{ paddingTop: '20px' }}>
                {unavailableHint('passkey')}
                <div
                  style={{
                    textAlign: 'center',
                    padding: '24px 16px',
                    marginBottom: '20px',
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      margin: '0 auto 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      background: 'var(--semi-color-primary-light-default)',
                    }}
                  >
                    <KeyIcon size={28} style={{ color: 'var(--semi-color-primary)' }} />
                  </div>
                  <Typography.Title
                    heading={5}
                    style={{ margin: '0 0 8px', fontSize: '16px' }}
                  >
                    {t('使用 Passkey 验证')}
                  </Typography.Title>
                  <Typography.Text
                    type='tertiary'
                    style={{ display: 'block', margin: 0, fontSize: '13px', lineHeight: '1.5' }}
                  >
                    {t('点击验证按钮，使用您的生物特征或安全密钥')}
                  </Typography.Text>
                </div>
                <div style={footerStyle}>
                  {cancelButton}
                  <Button
                    theme='solid'
                    type='primary'
                    loading={loading}
                    disabled={loading || !enabled('passkey')}
                    onClick={() => onVerify('passkey')}
                  >
                    {t('验证 Passkey')}
                  </Button>
                </div>
              </div>
            </TabPane>
          )}

          {showPassword && (
            <TabPane tab={t('密码')} itemKey='password'>
              <div style={{ paddingTop: '20px' }}>
                {unavailableHint('password')}
                <div style={{ marginBottom: '12px' }}>
                  <Input
                    mode='password'
                    placeholder={t('请输入当前登录密码')}
                    value={method === 'password' ? code : ''}
                    onChange={onCodeChange}
                    size='large'
                    onKeyDown={handleKeyDown}
                    autoFocus={method === 'password'}
                    disabled={loading || !enabled('password')}
                    prefix={<IconLock />}
                    style={{ width: '100%' }}
                  />
                </div>
                <Typography.Text type='tertiary' size='small' style={hintStyle}>
                  {t('为了账户安全，请输入当前登录密码确认是本人操作')}
                </Typography.Text>
                <div style={footerStyle}>
                  {cancelButton}
                  <Button
                    theme='solid'
                    type='primary'
                    loading={loading}
                    disabled={!code || loading || !enabled('password')}
                    onClick={() => onVerify('password', code)}
                  >
                    {t('验证')}
                  </Button>
                </div>
              </div>
            </TabPane>
          )}

          {showOAuth && (
            <TabPane tab={t('第三方账号')} itemKey='oauth'>
              <div style={{ paddingTop: '20px' }}>
                {unavailableHint('oauth')}
                <Typography.Text type='tertiary' size='small' style={hintStyle}>
                  {t('使用已绑定的第三方账号重新授权，确认是本人操作（会打开一个授权窗口）')}
                </Typography.Text>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    marginBottom: '20px',
                  }}
                >
                  {oauthProviders.map((provider) => (
                    <Button
                      key={provider.slug}
                      size='large'
                      icon={providerIcon(provider.slug)}
                      loading={loading}
                      disabled={loading || !enabled('oauth')}
                      onClick={() =>
                        onVerify('oauth', '', { provider: provider.slug })
                      }
                    >
                      {t('使用 {{name}} 验证', { name: provider.name })}
                    </Button>
                  ))}
                </div>
                <div style={footerStyle}>{cancelButton}</div>
              </div>
            </TabPane>
          )}
        </Tabs>
      </div>
    </Modal>
  );
};

export default SecureVerificationModal;
