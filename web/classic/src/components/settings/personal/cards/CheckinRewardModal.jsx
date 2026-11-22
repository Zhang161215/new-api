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
import { Modal } from '@douyinfe/semi-ui';
import { ChestClosed, ChestOpen, PixelSparkle, PixelTag } from './TreasureChest';

/**
 * 签到成功后的像素开箱弹窗：
 * 抖三下 → 箱子弹开 → 像素金币/火花爆发 → 光束 → 金额跳出。
 *
 * 分两个阶段（shaking / opened）而不是一整条 CSS 动画，
 * 因为「箱子换成打开的那张图」必须发生在抖动结束的那一帧，
 * 用一条动画没法精确切图。
 *
 * 尊重 prefers-reduced-motion：该场景下直接跳到结果，不播抖动、粒子与光束。
 */
const SHAKE_MS = 700;

// 粒子轨迹写死而非 Math.random()：每次开箱轨迹一致，re-render 不会换位置。
// dy 全为负 —— 像素金币只向上喷，落到箱外会破坏「弹开」的读感。
const BURST_PARTICLES = [
  { dx: -64, dy: -96, s: 8, c: '#F7D774', d: 0 },
  { dx: -40, dy: -112, s: 6, c: '#E0A83A', d: 25 },
  { dx: -14, dy: -88, s: 7, c: '#FFF3C4', d: 45 },
  { dx: 10, dy: -106, s: 6, c: '#F7D774', d: 10 },
  { dx: 32, dy: -94, s: 8, c: '#E0A83A', d: 55 },
  { dx: 58, dy: -82, s: 6, c: '#F7D774', d: 35 },
  { dx: -74, dy: -58, s: 6, c: '#9C6633', d: 65 },
  { dx: 72, dy: -54, s: 6, c: '#9C6633', d: 75 },
  { dx: -30, dy: -68, s: 5, c: '#B8860B', d: 90 },
  { dx: 20, dy: -64, s: 5, c: '#B8860B', d: 85 },
];

// 白色像素四角星：开箱瞬间在箱口上方左右各闪，强化「稀有掉落」感。
// x 相对弹窗中线对称取位 —— 只在一侧闪会像光源打偏了。
const BURST_SPARKLES = [
  { x: -56, y: 60, size: 12, d: 60 },
  { x: 48, y: 44, size: 10, d: 130 },
  { x: -6, y: 22, size: 14, d: 90 },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CheckinRewardModal = ({ t, visible, amountText, isDouble, multiplierLabel, onClose }) => {
  const [phase, setPhase] = useState('shaking');

  useEffect(() => {
    if (!visible) return;
    if (prefersReducedMotion()) {
      setPhase('opened');
      return;
    }
    setPhase('shaking');
    const timer = setTimeout(() => setPhase('opened'), SHAKE_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  const opened = phase === 'opened';

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      centered
      // Semi 关掉右上角叉要用 closable，closeIcon={null} 会退回默认图标（实测仍渲染）。
      // 这里靠点遮罩关闭，弹窗里也有「点击任意处关闭」的提示。
      closable={false}
      maskClosable
      width={320}
      bodyStyle={{ padding: 0 }}
      className='checkin-reward-modal'
    >
      <style>{`
        .checkin-reward-modal .semi-modal-content {
          background: linear-gradient(160deg, #241408 0%, #4A2F14 55%, #241408 100%);
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 18px 50px rgba(36,20,8,.5);
        }
        /* .semi-modal-content 是 flex 容器，.ckr-wrap 作为 flex item 默认按内容
           收缩（实测只有 246px 而容器 270px），整块内容就偏左 12px。
           width:100% + flex:1 让它撑满，内部的 text-align:center 才真的居中。 */
        .checkin-reward-modal .semi-modal-body-wrapper,
        .checkin-reward-modal .semi-modal-body {
          width: 100%;
        }
        .ckr-wrap {
          position: relative;
          width: 100%;
          flex: 1 1 auto;
          padding: 30px 20px 26px;
          text-align: center;
          overflow: hidden;
        }
        /* 背景放射光束，开箱后才出现并旋转。
           圆心对准宝箱中心（上 padding 30 + 箱高 128/2 = 94），
           否则光从箱顶发出，整个开箱看着是歪的。 */
        .ckr-rays {
          position: absolute;
          top: 94px; left: 50%;
          width: 320px; height: 320px;
          margin-left: -160px; margin-top: -160px;
          /* repeating-conic 铺满整圈 —— 普通 conic-gradient 只写 132° 的
             色标时，剩下 228° 全是透明的，光束会只出现在一侧 */
          background: repeating-conic-gradient(
            from 0deg,
            rgba(247,215,116,.30) 0deg 10deg,
            transparent 10deg 24deg
          );
          /* 光束边缘淡出，收成从箱心发散的圆盘 */
          -webkit-mask-image: radial-gradient(circle, #000 0%, transparent 68%);
          mask-image: radial-gradient(circle, #000 0%, transparent 68%);
          opacity: 0;
          pointer-events: none;
        }
        .ckr-wrap.is-opened .ckr-rays {
          animation: ckrRays 1.1s ease-out forwards, ckrSpin 14s linear infinite;
        }
        @keyframes ckrRays {
          0%   { opacity: 0; transform: scale(.4); }
          60%  { opacity: 1; }
          100% { opacity: .55; transform: scale(1); }
        }
        @keyframes ckrSpin { to { transform: rotate(360deg); } }

        .ckr-chest { position: relative; display: inline-block; line-height: 0; }
        .ckr-wrap:not(.is-opened) .ckr-chest {
          animation: ckrShake .16s ease-in-out 4;
        }
        @keyframes ckrShake {
          0%,100% { transform: translateX(0) rotate(0); }
          25%     { transform: translateX(-4px) rotate(-5deg); }
          75%     { transform: translateX(4px) rotate(5deg); }
        }
        .ckr-wrap.is-opened .ckr-chest {
          animation: ckrPop .5s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes ckrPop {
          0%   { transform: scale(.7); }
          60%  { transform: scale(1.15); }
          100% { transform: scale(1); }
        }

        /* 像素金币爆发：从箱口向上喷，轨迹写在 --dx/--dy 里。
           top 对准箱口（上 padding 30 + 箱口在点阵中的位置 ≈ 52）。 */
        .ckr-particle {
          position: absolute;
          left: 50%; top: 82px;
          opacity: 0;
          pointer-events: none;
        }
        .ckr-wrap.is-opened .ckr-particle {
          animation: ckrBurst .85s cubic-bezier(.15,.6,.35,1) both;
          animation-delay: var(--d);
        }
        @keyframes ckrBurst {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(.5); }
          12%  { opacity: 1; }
          100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); }
        }
        .ckr-sparkle-bit {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        .ckr-wrap.is-opened .ckr-sparkle-bit {
          animation: ckrTwinkle .7s ease-out both;
          animation-delay: var(--d);
        }
        @keyframes ckrTwinkle {
          0%   { opacity: 0; transform: scale(.3); }
          30%  { opacity: 1; transform: scale(1.25); }
          100% { opacity: 0; transform: scale(.9); }
        }

        /* 金额与文案在开箱后向上跳出 */
        .ckr-reveal { opacity: 0; }
        .ckr-wrap.is-opened .ckr-reveal {
          animation: ckrRise .45s .12s ease-out forwards;
        }
        @keyframes ckrRise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ckr-amount {
          font-size: 30px;
          font-weight: 800;
          letter-spacing: .5px;
          /* line-height 必须显式给且大于 1 —— 继承来的行高只有 20px，
             比 30px 字还矮，background-clip:text 的渐变盒会把字上下裁掉。
             padding 再留一点余量，容下 $ 和数字的上伸/下伸部分。 */
          line-height: 1.35;
          padding: 2px 0 4px;
          background: linear-gradient(135deg, #FFE873, #FFC61A 55%, #FFE873);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: #FFE873; /* 渐变裁切不支持时的兜底，否则文字整个消失 */
        }
        .ckr-title { color: rgba(255,255,255,.72); font-size: 13px; }
        .ckr-hint { margin-top: 16px; font-size: 11px; color: rgba(255,255,255,.4); }

        @media (prefers-reduced-motion: reduce) {
          .ckr-wrap .ckr-chest,
          .ckr-wrap.is-opened .ckr-chest,
          .ckr-wrap.is-opened .ckr-rays { animation: none; }
          .ckr-wrap.is-opened .ckr-rays { opacity: .45; }
          .ckr-particle, .ckr-sparkle-bit { display: none; }
          .ckr-reveal, .ckr-wrap.is-opened .ckr-reveal { opacity: 1; animation: none; }
        }
      `}</style>

      <div className={`ckr-wrap${opened ? ' is-opened' : ''}`}>
        <div className='ckr-rays' />

        {/* 像素粒子层：与宝箱同一坐标系，箱口对齐 top:82px */}
        {opened &&
          BURST_PARTICLES.map((p, i) => (
            <span
              key={i}
              className='ckr-particle'
              style={{
                width: p.s,
                height: p.s,
                background: p.c,
                '--dx': `${p.dx}px`,
                '--dy': `${p.dy}px`,
                '--d': `${p.d}ms`,
              }}
            />
          ))}
        {opened &&
          BURST_SPARKLES.map((s, i) => (
            <span
              key={i}
              className='ckr-sparkle-bit'
              style={{ left: `calc(50% + ${s.x}px)`, top: s.y, '--d': `${s.d}ms` }}
            >
              <PixelSparkle size={s.size} color='#FFF3C4' />
            </span>
          ))}

        <div className='ckr-chest'>
          {opened ? <ChestOpen size={128} /> : <ChestClosed size={128} />}
        </div>

        <div className='ckr-reveal' style={{ marginTop: 14 }}>
          <div className='ckr-title'>{t('签到成功，获得')}</div>
          <div className='ckr-amount'>{amountText}</div>
          {isDouble && (
            <div style={{ marginTop: 10 }}>
              <PixelTag>
                <PixelSparkle size={10} color='#3A2310' />
                {t('双倍奖励')} {multiplierLabel}
              </PixelTag>
            </div>
          )}
          <div className='ckr-hint'>{t('点击任意处关闭')}</div>
        </div>
      </div>
    </Modal>
  );
};

export default CheckinRewardModal;
