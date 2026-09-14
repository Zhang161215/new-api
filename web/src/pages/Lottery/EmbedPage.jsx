/*
Copyright (C) 2025 QuantumNous
*/

import React, { useEffect } from 'react';
import { Button } from '@douyinfe/semi-ui';
import {
  openLotteryAdminWindow,
  openLotteryWindow,
} from '../../constants/lottery.constants';

export const LotteryLaunchPage = () => {
  useEffect(() => {
    openLotteryWindow();
  }, []);

  return (
    <div className='lz-launch'>
      <p>抽奖已在新窗口打开。若浏览器拦截了弹窗，请点下面按钮。</p>
      <Button theme='solid' type='primary' onClick={() => openLotteryWindow()}>
        打开抽奖窗口
      </Button>
    </div>
  );
};

export const LotteryAdminLaunchPage = () => {
  useEffect(() => {
    openLotteryAdminWindow();
  }, []);

  return (
    <div className='lz-launch'>
      <p>抽奖管理已在新窗口打开。若浏览器拦截了弹窗，请点下面按钮。</p>
      <Button
        theme='solid'
        type='primary'
        onClick={() => openLotteryAdminWindow()}
      >
        打开抽奖管理
      </Button>
    </div>
  );
};

export default LotteryLaunchPage;
