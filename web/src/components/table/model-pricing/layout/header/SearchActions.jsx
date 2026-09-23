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

import React, { memo, useCallback } from 'react';
import { Input, Button, Select, Dropdown } from '@douyinfe/semi-ui';
import { IconSearch, IconCopy, IconFilter } from '@douyinfe/semi-icons';
import { ArrowUpDown, Check, LayoutGrid, Table2 } from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'default', label: '默认排序' },
  { value: 'name', label: '名称' },
  { value: 'price-asc', label: '价格：从低到高' },
  { value: 'price-desc', label: '价格：从高到低' },
];

// 分段切换（对齐上游 ToggleGroup）：options = [{ value, label, title }]
const ToggleGroup = ({ value, onChange, options, ariaLabel }) => (
  <div className='pricing-toggle-group' role='group' aria-label={ariaLabel}>
    {options.map((option) => (
      <button
        key={String(option.value)}
        type='button'
        title={option.title}
        aria-label={option.title}
        aria-pressed={value === option.value}
        data-active={value === option.value}
        onClick={() => onChange?.(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const SearchActions = memo(
  ({
    selectedRowKeys = [],
    copyText,
    handleChange,
    handleCompositionStart,
    handleCompositionEnd,
    isMobile = false,
    searchValue = '',
    setShowFilterModal,
    showWithRecharge,
    setShowWithRecharge,
    currency,
    setCurrency,
    siteDisplayType,
    showRatio,
    setShowRatio,
    viewMode,
    setViewMode,
    tokenUnit,
    setTokenUnit,
    sortBy = 'default',
    setSortBy,
    hideSearch = false,
    t,
  }) => {
    const supportsCurrencyDisplay = siteDisplayType !== 'TOKENS';
    const sortLabel =
      SORT_OPTIONS.find((option) => option.value === sortBy)?.label ||
      SORT_OPTIONS[0].label;

    const handleCopyClick = useCallback(() => {
      if (copyText && selectedRowKeys.length > 0) {
        copyText(selectedRowKeys);
      }
    }, [copyText, selectedRowKeys]);

    const handleFilterClick = useCallback(() => {
      setShowFilterModal?.(true);
    }, [setShowFilterModal]);

    return (
      <div className='flex flex-wrap items-center justify-end gap-2'>
        {!hideSearch && (
          <div className='flex-1'>
            <Input
              prefix={<IconSearch />}
              placeholder={t('搜索模型名称、供应商、端点或标签')}
              value={searchValue}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onChange={handleChange}
              showClear
            />
          </div>
        )}

        {selectedRowKeys.length > 0 && (
          <Button
            size='small'
            theme='light'
            type='primary'
            icon={<IconCopy />}
            onClick={handleCopyClick}
          >
            {t('复制已选 {{count}} 个', { count: selectedRowKeys.length })}
          </Button>
        )}

        {!isMobile && (
          <>
            {supportsCurrencyDisplay && (
              <ToggleGroup
                ariaLabel={t('价格口径')}
                value={Boolean(showWithRecharge)}
                onChange={setShowWithRecharge}
                options={[
                  {
                    value: false,
                    label: t('标准'),
                    title: t('按站点标准价显示'),
                  },
                  {
                    value: true,
                    label: t('充值'),
                    title: t('按充值汇率换算显示'),
                  },
                ]}
              />
            )}

            {supportsCurrencyDisplay && showWithRecharge && (
              <Select
                size='small'
                value={currency}
                onChange={setCurrency}
                style={{ width: 110 }}
                optionList={[
                  { value: 'USD', label: 'USD' },
                  { value: 'CNY', label: 'CNY' },
                  { value: 'CUSTOM', label: t('自定义货币') },
                ]}
              />
            )}

            <ToggleGroup
              ariaLabel={t('Token 单位')}
              value={tokenUnit}
              onChange={setTokenUnit}
              options={[
                { value: 'M', label: '/1M', title: t('每百万 tokens') },
                { value: 'K', label: '/1K', title: t('每千 tokens') },
              ]}
            />

            <button
              type='button'
              className='pricing-toolbar-btn'
              data-active={Boolean(showRatio)}
              aria-pressed={Boolean(showRatio)}
              onClick={() => setShowRatio?.(!showRatio)}
            >
              {t('倍率')}
            </button>

            <Dropdown
              trigger='click'
              position='bottomRight'
              render={
                <Dropdown.Menu>
                  {SORT_OPTIONS.map((option) => (
                    <Dropdown.Item
                      key={option.value}
                      active={option.value === sortBy}
                      onClick={() => setSortBy?.(option.value)}
                    >
                      <span className='inline-flex w-4'>
                        {option.value === sortBy && <Check size={14} />}
                      </span>
                      {t(option.label)}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              }
            >
              <button type='button' className='pricing-toolbar-btn'>
                <ArrowUpDown size={14} />
                {t(sortLabel)}
              </button>
            </Dropdown>

            <ToggleGroup
              ariaLabel={t('视图模式')}
              value={viewMode}
              onChange={setViewMode}
              options={[
                {
                  value: 'card',
                  label: <LayoutGrid size={15} />,
                  title: t('卡片视图'),
                },
                {
                  value: 'table',
                  label: <Table2 size={15} />,
                  title: t('表格视图'),
                },
              ]}
            />
          </>
        )}

        {isMobile && (
          <Button
            size='small'
            theme='outline'
            type='tertiary'
            icon={<IconFilter />}
            onClick={handleFilterClick}
          >
            {t('筛选')}
          </Button>
        )}
      </div>
    );
  },
);

SearchActions.displayName = 'SearchActions';

export default SearchActions;
