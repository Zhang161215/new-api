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

// 模型广场卡片与详情共用的展示工具（样式对齐上游新版模型广场）

// 计费类型用纯文字着色：按量=info 蓝，按次=purple
export const billingTypeOf = (model, t) =>
  model?.quota_type === 1
    ? { label: t('按次计费'), color: '#9333ea' }
    : { label: t('按量计费'), color: '#0084cc' };

// "$5.0000" -> "$5"，"$0.5000/M" -> "$0.5/M"；只去小数末尾的 0，不动整数部分
export const trimPrice = (value) =>
  typeof value === 'string'
    ? value.replace(/(\d)\.(\d*?)0+(?!\d)/g, (_, int, frac) =>
        frac ? `${int}.${frac}` : int,
      )
    : value;

// 分组名按名字哈希取色，同一分组在概览、性能、侧栏里颜色一致
const GROUP_COLORS = [
  '#059669',
  '#d97706',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#0891b2',
];

export const groupColor = (name) => {
  let hash = 0;
  const text = String(name || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
};
