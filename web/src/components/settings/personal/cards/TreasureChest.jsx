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

/**
 * 签到「奖励」像素视觉 kit：16×16 点阵宝箱 + 配套徽章。
 *
 * 点阵用「位图行 + 调色板」渲染成 SVG <rect>，配合 crispEdges 放大不糊。
 * 尺寸必须取 16 的整数倍（日历 32px、弹窗 112px 用 7 倍略有取舍），
 * 非整数倍缩放会让像素宽窄不一、边缘出现粗细不均的锯齿。
 *
 * 配色要点（前几版「看着像黄色不像金子」的根因）：
 *   1. 木头要够深（#6B4423），金才压得出来。木浅金棕、两者明度接近时，
 *      金件会糊进木头里，只剩单一色相的黄。
 *   2. 金要 5 阶且跨度大：镜面近白 → 亮 → 中（高饱和）→ 暗 → 阴影。
 *      少了近白镜面就没有反光，少了偏棕阴影就没有体积。
 *   3. 金件竖向分层（上亮下暗），单行纯色永远只是一根黄条。
 */

const PALETTE = {
  d: '#2A1A0D', // 描边（近黑棕）
  W: '#8B5A2B', // 木·高光
  w: '#6B4423', // 木·主色
  s: '#4A2E17', // 木·暗部
  K: '#1C1108', // 锁孔 / 盖内衬
  H: '#FFF7D0', // 金·镜面高光
  g: '#FFE873', // 金·亮
  G: '#FFC61A', // 金·中（高饱和主金色）
  N: '#C88A00', // 金·暗
  n: '#8A5D00', // 金·阴影
  o: '#FFD93D', // 金币
};

// 关着的宝箱：未领取（含未签到的翻倍日）。
// 造型 = 四角金护件 + 中央大锁牌 + 盖底/箱底金边，
// 是参考图里辨识度最高的一组特征，且 32px 下轮廓最稳。
const CLOSED_ROWS = [
  '................',
  '....dddddddd....',
  '..ddwwwwwwwwdd..',
  '.dWwwwwwwwwwwWd.',
  '.dwwwwwwwwwwwwd.',
  '.dwwwwwwwwwwwwd.',
  '.dHGGGGGGGGGGHd.',
  '.dNNNNggggNNNNd.',
  '.dGGwwGKKGwwGGd.',
  '.dGGwwGGGGwwGGd.',
  '.dwwwwwnnwwwwwd.',
  '.dwwwwwwwwwwwwd.',
  '.dGGssssssssGGd.',
  '.dddddddddddddd.',
  '................',
  '................',
];

// 打开的宝箱：盖子翻到背后露出内衬，箱口金光溢出 + 金币错落。
const OPEN_ROWS = [
  '................',
  '................',
  '...dddddddddd...',
  '..dwwwwwwwwwwd..',
  '..dKKKKKKKKKKd..',
  '..dddddddddddd..',
  '...H..Hg..H.....',
  '.dgHHHHHHHHHHgd.',
  '.dGoGooGGooGoGd.',
  '.dNNNNNNNNNNNNd.',
  '.dGGwwwwwwwwGGd.',
  '.dwwwwwwwwwwwwd.',
  '.dGGssssssssGGd.',
  '.dddddddddddddd.',
  '................',
  '................',
];

const PixelSprite = ({ rows, size, className }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 16 16'
    shapeRendering='crispEdges'
    className={className}
    aria-hidden='true'
  >
    {rows.flatMap((row, y) =>
      [...row].map((ch, x) =>
        PALETTE[ch] ? (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={1}
            height={1}
            fill={PALETTE[ch]}
          />
        ) : null,
      ),
    )}
  </svg>
);

/** 关着的宝箱：未领取（含未签到的翻倍日） */
export const ChestClosed = ({ size = 32, className = '' }) => (
  <PixelSprite rows={CLOSED_ROWS} size={size} className={className} />
);

/** 打开的宝箱：已领取，箱口有金币与金光 */
export const ChestOpen = ({ size = 32, className = '' }) => (
  <PixelSprite rows={OPEN_ROWS} size={size} className={className} />
);

/** 像素四角星：徽章、粒子里用的小火花 */
export const PixelSparkle = ({
  size = 10,
  color = PALETTE.H,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 5 5'
    shapeRendering='crispEdges'
    className={className}
    aria-hidden='true'
  >
    {[
      [2, 0],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [2, 3],
      [2, 4],
    ].map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
    ))}
  </svg>
);

// 阶梯切角：上下左右各削一个 2 级像素角，是像素 UI 的标志性轮廓。
// 外层深棕描边 + 内层金底，clip-path 会同时裁切后代，内层不用单独切。
const PIXEL_CORNER_CLIP = `polygon(
  4px 0, calc(100% - 4px) 0,
  calc(100% - 4px) 2px, calc(100% - 2px) 2px, calc(100% - 2px) 4px, 100% 4px,
  100% calc(100% - 4px),
  calc(100% - 2px) calc(100% - 4px), calc(100% - 2px) calc(100% - 2px),
  calc(100% - 4px) calc(100% - 2px), calc(100% - 4px) 100%,
  4px 100%,
  4px calc(100% - 2px), 2px calc(100% - 2px), 2px calc(100% - 4px), 0 calc(100% - 4px),
  0 4px,
  2px 4px, 2px 2px, 4px 2px
)`;

/**
 * 像素标签：金底深棕描边、阶梯切角、右下角硬阴影。
 * 「今日额度 ×2」「双倍奖励」这类短文案专用，和宝箱共用一套语言。
 *
 * size='sm' 是日历格子用的小号版 —— 默认尺寸放格子里会跟宝箱抢戏。
 * 默认（弹窗用）刻意做得高一些，好压住开箱后的大片金光。
 */
export const PixelTag = ({ children, size: tagSize, style, className = '' }) => (
  <span
    className={`pixel-tag${tagSize === 'sm' ? ' pixel-tag-sm' : ''}${className ? ' ' + className : ''}`}
    style={style}
  >
    <style>{`
      /* Semi 日历对 cell 内 span 有 display/line-height 覆盖（层级更高），
         关键布局属性必须 !important，否则徽章会被撑成两倍高。 */
      .pixel-tag {
        display: inline-block !important;
        padding: 2px !important;
        background: ${PALETTE.d};
        clip-path: ${PIXEL_CORNER_CLIP};
        filter: drop-shadow(2px 2px 0 rgba(42,26,13,.45));
        line-height: 0 !important;
      }
      .pixel-tag-inner {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px;
        padding: 7px 12px !important;
        background: linear-gradient(180deg, ${PALETTE.g} 0%, ${PALETTE.G} 55%, ${PALETTE.N} 100%);
        color: ${PALETTE.d};
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .5px;
        line-height: 1 !important;
        white-space: nowrap;
      }
      .pixel-tag-sm .pixel-tag-inner {
        gap: 2px;
        padding: 1px 4px !important;
        font-size: 8px;
        letter-spacing: .3px;
        background: linear-gradient(180deg, ${PALETTE.g} 0%, ${PALETTE.G} 100%);
      }
    `}</style>
    <span className='pixel-tag-inner'>{children}</span>
  </span>
);

export default ChestClosed;
