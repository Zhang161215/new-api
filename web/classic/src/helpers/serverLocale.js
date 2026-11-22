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

// 本站：上游 rc.43 起部分接口只返回英文文案键（如访问令牌权限目录的 label_key），
// 由新版前端用 web/src/i18n/locales 翻译。classic 没有这些键，这里按需懒加载同一份 locale 文件
// （单独打成一个 chunk，只在用到的页面加载）。接口提示（message）已由服务端按请求语言渲染，不走这里。

const cache = {};

function localeKey(language) {
  const lang = String(language || '').toLowerCase();
  if (
    lang.startsWith('zh-tw') ||
    lang.startsWith('zh-hk') ||
    lang.startsWith('zh-hant')
  ) {
    return 'zh-TW';
  }
  if (lang.startsWith('zh')) return 'zh';
  return null;
}

export async function loadServerLocale(language) {
  const key = localeKey(language);
  if (!key) return null;
  if (!cache[key]) {
    const loader =
      key === 'zh-TW'
        ? import('../../../src/i18n/locales/zh-TW.json')
        : import('../../../src/i18n/locales/zh.json');
    cache[key] = loader
      .then((mod) => (mod.default || mod).translation || {})
      .catch(() => ({}));
  }
  return cache[key];
}

// 用已加载的翻译表渲染文案键，{{name}} 占位符用 params 填充；没有译文时原样返回英文。
export function translateServerKey(dict, key, params) {
  if (!key) return '';
  const template = (dict && dict[key]) || key;
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    params[name] !== undefined ? String(params[name]) : match,
  );
}
