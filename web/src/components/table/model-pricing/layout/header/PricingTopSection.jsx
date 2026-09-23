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

import React, { useEffect, useRef, useState, memo } from 'react';
import { Input } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import PricingFilterModal from '../../modal/PricingFilterModal';
import SearchActions from './SearchActions';

const isMacLike = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

export const PricingSquareHeader = ({
  count,
  t,
  searchValue,
  handleChange,
  handleCompositionStart,
  handleCompositionEnd,
}) => {
  const inputRef = useRef(null);

  // ⌘K / Ctrl+K 聚焦搜索（对齐上游）
  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        String(event.key).toLowerCase() === 'k'
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className='pricing-hero'>
      <h1 className='pricing-hero-title'>{t('模型广场')}</h1>
      <p className='pricing-hero-subtitle'>
        {t('本站当前已启用模型，总计 {{count}} 个', { count: count || 0 })}
      </p>
      <p className='pricing-hero-desc'>
        {t('探索精选 AI 模型，清晰比较价格与能力，为不同场景选择合适的模型。')}
      </p>
      <div className='pricing-hero-search'>
        <Input
          ref={inputRef}
          prefix={<IconSearch />}
          suffix={
            <kbd className='pricing-hero-kbd'>
              {isMacLike() ? '⌘K' : 'Ctrl K'}
            </kbd>
          }
          placeholder={t('搜索模型名称、供应商、端点或标签...')}
          aria-label={t('搜索模型')}
          value={searchValue}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onChange={handleChange}
          showClear
        />
      </div>
    </header>
  );
};

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
    sortBy,
    setSortBy,
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
        sortBy={sortBy}
        setSortBy={setSortBy}
        hideSearch
        t={t}
      />
    );

    const shown = (filteredModels || []).length;
    const total = (models || []).length;

    return (
      <>
        <div className='pricing-toolbar'>
          <div className='pricing-toolbar-count'>
            <strong>{shown}</strong>
            <span>{t('个模型')}</span>
            {shown !== total && (
              <span className='pricing-toolbar-total'>
                {t('/ 共 {{total}} 个', { total })}
              </span>
            )}
          </div>
          {search}
        </div>
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
