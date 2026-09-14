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

import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Modal, Typography } from '@douyinfe/semi-ui';
import { ScrollText } from 'lucide-react';
import MarkdownRenderer from '../../common/markdown/MarkdownRenderer';
import { DEFAULT_TOPUP_AGREEMENT } from '../../../constants/topup.constants';

const { Text } = Typography;

const TopupAgreementModal = ({
  t,
  visible,
  onCancel,
  onContinue,
  hasUserAgreement = false,
}) => {
  const [skipLater, setSkipLater] = useState(false);

  useEffect(() => {
    if (visible) {
      setSkipLater(false);
    }
  }, [visible]);

  const footer = (
    <div className='space-y-3 pt-1'>
      <Checkbox
        checked={skipLater}
        onChange={(e) => setSkipLater(e.target.checked)}
      >
        <Text size='small'>{t('后续不再提醒')}</Text>
      </Checkbox>
      <Button
        theme='solid'
        type='primary'
        block
        className='!ml-0'
        onClick={() => onContinue(skipLater)}
      >
        {t('同意并继续')}
      </Button>
      <div className='text-center'>
        <Text size='small' type='tertiary'>
          {t('点击即表示您已阅读并同意《充值说明》')}
          {hasUserAgreement ? (
            <>
              {t('和')}
              <a
                href='/user-agreement'
                target='_blank'
                rel='noopener noreferrer'
                className='mx-1 text-blue-600 hover:text-blue-800'
              >
                {t('用户协议')}
              </a>
            </>
          ) : null}
        </Text>
      </div>
    </div>
  );

  return (
    <Modal
      title={
        <div className='flex items-center'>
          <ScrollText className='mr-2' size={18} />
          {t('充值说明与协议')}
        </div>
      }
      visible={visible}
      onCancel={onCancel}
      footer={footer}
      width={580}
      centered
      maskClosable={false}
      bodyStyle={{ maxHeight: 'min(62vh, 520px)', overflow: 'auto' }}
    >
      <div
        className='rounded-xl'
        style={{ border: '1px solid var(--semi-color-border)' }}
      >
        <div className='px-3 pt-2'>
          <Text size='small' type='tertiary'>
            {t('充值说明')}
          </Text>
        </div>
        <div className='overflow-y-auto px-3 pb-2' style={{ maxHeight: 280 }}>
          <MarkdownRenderer content={DEFAULT_TOPUP_AGREEMENT} />
        </div>
      </div>
    </Modal>
  );
};

export default TopupAgreementModal;
