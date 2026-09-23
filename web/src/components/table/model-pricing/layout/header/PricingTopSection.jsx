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

import React, { useState, memo } from 'react';
import { Input } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import PricingFilterModal from '../../modal/PricingFilterModal';
import SearchActions from './SearchActions';

export const PricingSquareHeader = ({
  count,
  t,
  searchValue,
  handleChange,
  handleCompositionStart,
  handleCompositionEnd,
}) => (
  <header className='mx-auto w-full max-w-3xl shrink-0 px-4 pt-5 pb-3 text-center'>
    <h1 className='text-4xl font-bold tracking-tight'>{t('模型广场')}</h1>
    <p className='mt-2 text-sm' style={{ color: 'var(--semi-color-text-2)' }}>
      {t('本站当前已启用模型，总计 {{count}} 个', { count: count || 0 })}
    </p>
    <p
      className='mx-auto mt-1 max-w-2xl text-xs leading-relaxed'
      style={{ color: 'var(--semi-color-text-3)' }}
    >
      {t('探索精选 AI 模型，清晰比较价格与能力，为不同场景选择合适的模型。')}
    </p>
    <div className='mx-auto mt-4 max-w-2xl text-left'>
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
  </header>
);

const PricingTopSection = memo(
  ({
    selectedRowKeys,
    copyText,
    handleChange,
    handleCompositionStart,
    handleCompositionEnd,
    isMobile,
    sidebarProps,
    filterVendor,
    models,
    filteredModels,
    loading,
    searchValue,
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
    t,
  }) => {
    const [showFilterModal, setShowFilterModal] = useState(false);

    const search = (
      <SearchActions
        selectedRowKeys={selectedRowKeys}
        copyText={copyText}
        handleChange={handleChange}
        handleCompositionStart={handleCompositionStart}
        handleCompositionEnd={handleCompositionEnd}
        isMobile={isMobile}
        searchValue={searchValue}
        setShowFilterModal={setShowFilterModal}
        showWithRecharge={showWithRecharge}
        setShowWithRecharge={setShowWithRecharge}
        currency={currency}
        setCurrency={setCurrency}
        siteDisplayType={siteDisplayType}
        showRatio={showRatio}
        setShowRatio={setShowRatio}
        viewMode={viewMode}
        setViewMode={setViewMode}
        tokenUnit={tokenUnit}
        setTokenUnit={setTokenUnit}
        hideSearch
        t={t}
      />
    );

    return (
      <>
        <p
          className='mb-2 px-1 text-xs'
          style={{ color: 'var(--semi-color-text-2)' }}
        >
          {t('显示 {{count}} / {{total}} 个模型', {
            count: (filteredModels || []).length,
            total: (models || []).length,
          })}
        </p>
        {search}
        {isMobile && (
          <PricingFilterModal
            visible={showFilterModal}
            onClose={() => setShowFilterModal(false)}
            sidebarProps={sidebarProps}
            t={t}
          />
        )}
      </>
    );
  },
);

PricingTopSection.displayName = 'PricingTopSection';

export default PricingTopSection;
