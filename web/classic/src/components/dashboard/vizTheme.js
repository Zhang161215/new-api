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

// 看板图表配色：分类色按固定顺序取（已用色盲校验脚本验证相邻对），深色模式用同色相的深色档，不是自动反转。
const CATEGORICAL = {
  light: [
    '#2a78d6',
    '#eb6834',
    '#1baf7a',
    '#eda100',
    '#e87ba4',
    '#008300',
    '#6250d6',
  ],
  dark: [
    '#3987e5',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#0ca30c',
    '#9085e9',
  ],
};
// 「其他」/「未拆分」用中性灰，不占分类色
const NEUTRAL = { light: '#b5b3ab', dark: '#5d5c58' };

// Token 构成：非缓存输入 / 缓存读取 / 缓存创建 / 输出（这个顺序两种模式都通过校验）
const TOKEN_PARTS = {
  light: {
    uncached: '#2a78d6',
    readIn: '#1baf7a',
    writeIn: '#eda100',
    output: '#6250d6',
  },
  dark: {
    uncached: '#3987e5',
    readIn: '#199e70',
    writeIn: '#c98500',
    output: '#9085e9',
  },
};

export const MAX_MODEL_SERIES = CATEGORICAL.light.length;

const modeOf = (theme) => (theme === 'dark' ? 'dark' : 'light');

export function seriesColors(theme) {
  return CATEGORICAL[modeOf(theme)];
}

export function neutralColor(theme) {
  return NEUTRAL[modeOf(theme)];
}

export function tokenPartColors(theme) {
  return { ...TOKEN_PARTS[modeOf(theme)], legacy: NEUTRAL[modeOf(theme)] };
}

// 名称 -> 颜色（按传入顺序固定分配；otherLabel 用中性灰）
export function colorMapFor(names, theme, otherLabel) {
  const palette = seriesColors(theme);
  const map = {};
  let slot = 0;
  names.forEach((name) => {
    if (name === otherLabel) {
      map[name] = neutralColor(theme);
    } else {
      map[name] = palette[slot % palette.length];
      slot += 1;
    }
  });
  return map;
}

// 图表画在卡片底色上，柱子之间的 2px 缝用卡片底色
export function surfaceColor(theme) {
  if (typeof window !== 'undefined') {
    const v = getComputedStyle(document.body)
      .getPropertyValue('--semi-color-bg-0')
      .trim();
    if (v) return v.startsWith('rgb') || v.startsWith('#') ? v : `rgb(${v})`;
  }
  return modeOf(theme) === 'dark' ? '#232429' : '#ffffff';
}

export const CHART_OPTION = { mode: 'desktop-browser' };

// 坐标轴 / 网格：实线细线、弱化
export function quietAxes(valueFormat) {
  return [
    {
      orient: 'left',
      label: valueFormat ? { formatMethod: (v) => valueFormat(v) } : undefined,
      grid: { style: { lineDash: [], lineWidth: 1 } },
      domainLine: { visible: false },
      tick: { visible: false },
    },
    {
      orient: 'bottom',
      label: { autoHide: true, autoRotate: false },
      // 底边线会被柱子之间的 2px 缝切成虚线，交给 0 刻度的网格线
      domainLine: { visible: false },
      tick: { visible: false },
    },
  ];
}

// 标签文字用正文色，不用系列色
export function textColor(level = 1) {
  if (typeof window !== 'undefined') {
    const v = getComputedStyle(document.body)
      .getPropertyValue(`--semi-color-text-${level}`)
      .trim();
    if (v) return v.startsWith('rgb') || v.startsWith('#') ? v : `rgb(${v})`;
  }
  return level === 2 ? '#52514e' : '#1c1f23';
}
