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

import React, { useMemo, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { getLobeHubIcon } from '../../../../helpers';
import { resetPricingFilters } from '../../../../helpers/utils';

// 对齐上游新版：选项是可换行的小胶囊，数量/倍率放在胶囊内的小徽标里
const FilterChip = ({ option, active, onClick }) => {
  const hasSuffix =
    option.suffix !== undefined &&
    option.suffix !== null &&
    option.suffix !== '';
  return (
    <button
      type='button'
      aria-pressed={active}
      title={option.label}
      onClick={onClick}
      className='pricing-filter-chip'
      data-active={active ? 'true' : undefined}
    >
      {option.icon ? <span className='shrink-0'>{option.icon}</span> : null}
      <span className='truncate'>{option.label}</span>
      {hasSuffix && (
        <span className='pricing-filter-chip-suffix'>{option.suffix}</span>
      )}
    </button>
  );
};

const FilterSection = ({ title, value, options, onChange }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className='pricing-filter-section'>
      <button
        type='button'
        onClick={() => setOpen((prev) => !prev)}
        className='flex w-full items-center justify-between py-2.5 text-left'
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          color: 'var(--semi-color-text-0)',
        }}
      >
        <span className='text-sm font-semibold'>{title}</span>
        <ChevronDown
          size={16}
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms',
            color: 'var(--semi-color-text-2)',
          }}
        />
      </button>
      {open && (
        <div className='flex flex-wrap gap-1.5'>
          {options.map((option) => (
            <FilterChip
              key={String(option.value)}
              option={option}
              active={value === option.value}
              onClick={() => onChange(option.value)}
            />
          ))}
        </div>
      )}
    </section>
  );
};

const formatRatio = (ratio) => {
  if (ratio == null || Number.isNaN(Number(ratio))) return undefined;
  const value = Number(ratio);
  const text = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return `x${text}`;
};

// 与上游 ENDPOINT_TYPES 一致；固定列出，数量为 0 的也显示
const ENDPOINT_LABELS = [
  ['openai', 'Chat'],
  ['openai-response', 'Response'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Gemini'],
  ['jina-rerank', 'Rerank'],
  ['image-generation', '图片'],
  ['embeddings', '嵌入'],
  ['openai-video', '视频'],
];

const PricingSidebar = ({
  handleChange,
  setShowWithRecharge,
  setCurrency,
  setShowRatio,
  setViewMode,
  filterGroup,
  handleGroupClick,
  setSelectedGroup,
  setFilterGroup,
  filterQuotaType,
  setFilterQuotaType,
  filterEndpointType,
  setFilterEndpointType,
  filterVendor,
  setFilterVendor,
  filterTag,
  setFilterTag,
  setCurrentPage,
  setTokenUnit,
  t,
  ...categoryProps
}) => {
  const models = categoryProps.models || [];

  const vendors = useMemo(() => {
    const icons = new Map();
    const names = new Set();
    let unknown = false;
    models.forEach((model) => {
      if (!model.vendor_name) {
        unknown = true;
        return;
      }
      names.add(model.vendor_name);
      if (model.vendor_icon && !icons.has(model.vendor_name)) {
        icons.set(model.vendor_name, model.vendor_icon);
      }
    });
    return {
      unknown,
      items: Array.from(names)
        .sort()
        .map((name) => ({
          value: name,
          label: name,
          suffix: models.filter((model) => model.vendor_name === name).length,
          icon: icons.get(name) ? getLobeHubIcon(icons.get(name), 14) : null,
        })),
    };
  }, [models]);

  const tags = useMemo(() => {
    const counts = new Map();
    models.forEach((model) => {
      String(model.tags || '')
        .split(/[,;|]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => {
          const key = tag.toLowerCase();
          if (!counts.has(key)) counts.set(key, { label: tag, count: 0 });
          counts.get(key).count += 1;
        });
    });
    return Array.from(counts.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [models]);

  const endpoints = useMemo(() => {
    const counts = new Map();
    models.forEach((model) => {
      (model.supported_endpoint_types || []).forEach((endpoint) => {
        counts.set(endpoint, (counts.get(endpoint) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [models]);

  const groups = Object.keys(categoryProps.usableGroup || {}).filter(
    (group) => group && group !== 'auto',
  );

  const handleResetFilters = () =>
    resetPricingFilters({
      handleChange,
      setShowWithRecharge,
      setCurrency,
      setShowRatio,
      setViewMode,
      setFilterGroup: (group) => {
        setSelectedGroup?.(group);
        setFilterGroup?.(group);
      },
      setFilterQuotaType,
      setFilterEndpointType,
      setFilterVendor,
      setFilterTag,
      setCurrentPage,
      setTokenUnit,
    });

  const hasActiveFilters =
    filterGroup !== 'all' ||
    filterVendor !== 'all' ||
    filterTag !== 'all' ||
    filterQuotaType !== 'all' ||
    filterEndpointType !== 'all';

  const knownEndpoints = new Set(ENDPOINT_LABELS.map(([value]) => value));
  const endpointCounts = new Map(endpoints);
  const endpointOptions = [
    { value: 'all', label: t('所有类型'), suffix: models.length },
    ...ENDPOINT_LABELS.map(([value, label]) => ({
      value,
      label: t(label),
      suffix: endpointCounts.get(value) || 0,
    })),
    ...endpoints
      .filter(([endpoint]) => !knownEndpoints.has(endpoint))
      .map(([endpoint, count]) => ({
        value: endpoint,
        label: endpoint,
        suffix: count,
      })),
  ];

  return (
    <aside className='pricing-sidebar-card'>
      <div className='mb-2.5 flex items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h2
            className='text-sm font-bold'
            style={{ color: 'var(--semi-color-text-0)' }}
          >
            {t('筛选')}
          </h2>
          <p
            className='mt-1 text-xs'
            style={{ color: 'var(--semi-color-text-2)' }}
          >
            {t('按供应商、分组、类型和标签细化模型。')}
          </p>
        </div>
        <button
          type='button'
          onClick={handleResetFilters}
          disabled={!hasActiveFilters}
          className='pricing-filter-reset'
        >
          <RotateCcw size={14} />
          {t('重置')}
        </button>
      </div>
      {hasActiveFilters && (
        <span className='pricing-filter-active-badge'>{t('筛选已启用')}</span>
      )}

      <div className='space-y-1'>
        <FilterSection
          title={t('分组')}
          value={filterGroup}
          onChange={handleGroupClick}
          options={[
            { value: 'all', label: t('所有分组') },
            ...groups.map((group) => ({
              value: group,
              label: group,
              suffix: formatRatio(categoryProps.groupRatio?.[group]),
            })),
          ]}
        />
        <FilterSection
          title={t('供应商')}
          value={filterVendor}
          onChange={setFilterVendor}
          options={[
            { value: 'all', label: t('所有供应商'), suffix: models.length },
            ...vendors.items,
            ...(vendors.unknown
              ? [
                  {
                    value: 'unknown',
                    label: t('未知供应商'),
                    suffix: models.filter((model) => !model.vendor_name).length,
                  },
                ]
              : []),
          ]}
        />
        <FilterSection
          title={t('模型标签')}
          value={filterTag}
          onChange={setFilterTag}
          options={[
            { value: 'all', label: t('所有标签'), suffix: models.length },
            ...tags.map((tag) => ({
              value: tag.label,
              label: tag.label,
              suffix: tag.count,
            })),
          ]}
        />
        <FilterSection
          title={t('定价类型')}
          value={filterQuotaType}
          onChange={setFilterQuotaType}
          options={[
            { value: 'all', label: t('所有模型'), suffix: models.length },
            {
              value: 0,
              label: t('按量计费'),
              suffix: models.filter((model) => model.quota_type === 0).length,
            },
            {
              value: 1,
              label: t('按次计费'),
              suffix: models.filter((model) => model.quota_type === 1).length,
            },
          ]}
        />
        <FilterSection
          title={t('端点类型')}
          value={filterEndpointType}
          onChange={setFilterEndpointType}
          options={endpointOptions}
        />
      </div>
    </aside>
  );
};

export default PricingSidebar;
