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
import { Button, Input, Modal, Typography } from '@douyinfe/semi-ui';
import { IconMail, IconKey } from '@douyinfe/semi-icons';

// 上游 rc.36 邮箱绑定：先验证身份并发送验证码（start），再提交新邮箱验证码；
// 已有邮箱时是换绑，还要原邮箱收到的验证码。
const EmailBindModal = ({
  t,
  showEmailBindModal,
  setShowEmailBindModal,
  inputs,
  handleInputChange,
  sendVerificationCode,
  bindEmail,
  emailBindFlow,
  disableButton,
  loading,
  countdown,
}) => {
  const started = Boolean(emailBindFlow?.flow_token);
  const sameEmail = started && emailBindFlow.email === inputs.email.trim();
  return (
    <Modal
      title={
        <div className='flex items-center'>
          <IconMail className='mr-2 text-blue-500' />
          {t('绑定邮箱地址')}
        </div>
      }
      visible={showEmailBindModal}
      onCancel={() => setShowEmailBindModal(false)}
      onOk={bindEmail}
      okButtonProps={{ disabled: !sameEmail, loading }}
      size={'small'}
      centered={true}
      maskClosable={false}
      className='modern-modal'
    >
      <div className='space-y-4 py-4'>
        <div className='flex gap-3'>
          <Input
            placeholder={t('输入邮箱地址')}
            value={inputs.email}
            onChange={(value) => handleInputChange('email', value)}
            name='email'
            type='email'
            size='large'
            className='!rounded-lg flex-1'
            prefix={<IconMail />}
          />
          <Button
            onClick={sendVerificationCode}
            disabled={(sameEmail && disableButton) || loading}
            className='!rounded-lg'
            type='primary'
            theme='outline'
            size='large'
          >
            {sameEmail && disableButton
              ? `${t('重新发送')} (${countdown})`
              : sameEmail
                ? t('重新发送')
                : t('获取验证码')}
          </Button>
        </div>

        {sameEmail && (
          <>
            <Typography.Text type='tertiary' size='small' className='block'>
              {t('验证码已发送到 {{email}}', { email: emailBindFlow.email })}
            </Typography.Text>
            <Input
              placeholder={t('新邮箱收到的验证码')}
              name='email_verification_code'
              value={inputs.email_verification_code}
              onChange={(value) =>
                handleInputChange('email_verification_code', value)
              }
              size='large'
              className='!rounded-lg'
              prefix={<IconKey />}
            />
            {emailBindFlow.old_email_required && (
              <Input
                placeholder={t('原邮箱 {{email}} 收到的验证码', {
                  email: emailBindFlow.current_email || '',
                })}
                name='email_old_code'
                value={inputs.email_old_code}
                onChange={(value) => handleInputChange('email_old_code', value)}
                size='large'
                className='!rounded-lg'
                prefix={<IconKey />}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default EmailBindModal;
