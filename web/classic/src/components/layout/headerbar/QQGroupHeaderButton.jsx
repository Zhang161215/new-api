/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
    13|but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React from 'react';
import { Tooltip } from '@douyinfe/semi-ui';
import { QQ_GROUP_JOIN_URL } from '../../../constants/community.constants';

const QQPenguinIcon = () => (
  <svg
    viewBox='0 0 1024 1024'
    width='15'
    height='15'
    fill='currentColor'
    aria-hidden='true'
  >
    <path d='M824.8 613.2c-16-51.4-34.4-94.6-62.7-165.3C766.5 262.2 689.3 112 512 112 334.7 112 257.5 262.2 261.8 447.9c-28.4 70.8-46.7 113.7-62.7 165.3-34 109.5-23 154.8-14.6 155.8 18 2.2 70.1-82.4 70.1-82.4 0 49 25.2 112.9 79.8 159-26.4 8.1-85.7 29.9-71.6 53.8 11.4 19.3 196.2 12.3 249.2 6.8 53 5.5 237.8 12.5 249.2-6.8 14.1-23.8-45.3-45.7-71.6-53.8 54.6-46.2 79.8-110.1 79.8-159 0 0 52.1 84.6 70.1 82.4 8.5-1.1 19.5-46.4-14.6-155.8z' />
  </svg>
);

const QQGroupHeaderButton = ({ t }) => {
  return (
    <Tooltip content={t('加入QQ群')} position='bottom'>
      <a
        href={QQ_GROUP_JOIN_URL}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={t('加入QQ群')}
        className='lz-hdr-qq'
      >
        <QQPenguinIcon />
        <span>{t('QQ群')}</span>
      </a>
    </Tooltip>
  );
};

export default QQGroupHeaderButton;
