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
import { Tooltip } from '@douyinfe/semi-ui';
import {
  LOTTERY_MACHINE_SRC,
  LOTTERY_REEL_SRC,
  openLotteryWindow,
} from '../../../constants/lottery.constants';

const LotteryHeaderButton = ({ t }) => {
  return (
    <Tooltip content={t('幸运抽奖')} position='bottom'>
      <button
        type='button'
        aria-label={t('幸运抽奖')}
        className='lz-hdr-btn'
        onClick={() => {
          openLotteryWindow();
        }}
      >
        <span className='lz-hdr-machine'>
          <span className='lz-hdr-reel'>
            <img src={LOTTERY_REEL_SRC} alt='' draggable={false} />
          </span>
          <img
            className='lz-hdr-frame'
            src={LOTTERY_MACHINE_SRC}
            alt=''
            draggable={false}
          />
        </span>
      </button>
    </Tooltip>
  );
};

export default LotteryHeaderButton;
