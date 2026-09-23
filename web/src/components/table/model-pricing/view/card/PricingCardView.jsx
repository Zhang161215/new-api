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
import {
  Card,
  Tag,
  Checkbox,
  Empty,
  Pagination,
  Button,
  Avatar,
  Tooltip,
} from '@douyinfe/semi-ui';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import { ChevronRight, Copy } from 'lucide-react';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import {
  calculateModelPrice,
  getLobeHubIcon,
  getModelPriceItems,
  stringToColor,
} from '../../../../../helpers';
import { renderLimitedItems } from '../../../../common/ui/RenderUtils';
import { billingTypeOf, trimPrice } from '../../squareUtils';
import PricingCardSkeleton from './PricingCardSkeleton';
import ModelStatusRow from './ModelStatusRow';
import { useMinimumLoadingTime } from '../../../../../hooks/common/useMinimumLoadingTime';
import { useIsMobile } from '../../../../../hooks/common/useIsMobile';

const PriceCell = ({ label, value, unit }) => {
  const unitText = unit === 'M' || unit === 'K' ? `1${unit}` : unit;
  return (
    <div className='min-w-0'>
      <div className='text-xs' style={{ color: 'var(--semi-color-text-2)' }}>
        {label}
      </div>
      <div className='font-mono text-sm font-semibold tabular-nums'>
        {trimPrice(value) || '—'}
        {unitText && (
          <span
            className='ml-1 text-xs font-normal'
            style={{ color: 'var(--semi-color-text-2)' }}
          >
            / {unitText}
          </span>
        )}
      </div>
    </div>
  );
};

// 统一走 getModelPriceItems：USD/CNY 显示价格，TOKENS 显示倍率，按次显示单价；
// 前三项放主格，其余（缓存创建、图片、音频）收成一行小字，原价单独一行删除线。
const buildCardPrices = (priceData, t, displayType) => {
  const items = getModelPriceItems(priceData, t, displayType);
  const main = items.find((item) => item.isMainPrice);
  const original = items.find((item) => item.isOriginalPrice);
  const rest = items.filter(
    (item) => !item.isMainPrice && !item.isOriginalPrice,
  );
  if (main) {
    const unit = priceData.unitLabel;
    const cache = rest.find((item) => item.key === 'cache');
    const cells = [
      { key: 'input', label: t('输入'), value: priceData.inputPrice, unit },
      {
        key: 'output',
        label: t('输出'),
        value: priceData.completionPrice,
        unit,
      },
    ];
    if (cache)
      cells.push({ key: 'cache', label: t('缓存'), value: cache.value, unit });
    return {
      cells,
      extras: rest.filter((item) => item.key !== 'cache'),
      original,
    };
  }
  if (priceData.isPerToken) {
    return {
      cells: rest.slice(0, 3).map((item) => ({
        key: item.key,
        label: item.label,
        value: `${item.value}${item.suffix || ''}`,
      })),
      extras: rest.slice(3),
      original: null,
    };
  }
  return {
    cells: [
      { key: 'price', label: t('价格'), value: priceData.price, unit: t('次') },
    ],
    extras: [],
    original: null,
  };
};

const splitTags = (tags) =>
  String(tags || '')
    .split(/[,;|]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

const MetaLine = ({ label, values }) => {
  if (!values || values.length === 0) return null;
  return (
    <div className='flex min-w-0 items-baseline gap-1'>
      <span className='shrink-0' style={{ color: 'var(--semi-color-text-2)' }}>
        {label}
      </span>
      <span className='truncate' title={values.join(', ')}>
        {values[0]}
      </span>
      {values.length > 1 && (
        <span
          className='shrink-0'
          style={{ color: 'var(--semi-color-text-2)' }}
        >
          +{values.length - 1}
        </span>
      )}
    </div>
  );
};

const CARD_STYLES = {
  container:
    'w-12 h-12 rounded-2xl flex items-center justify-center relative shadow-md',
  icon: 'w-8 h-8 flex items-center justify-center',
  selected: 'border-blue-500 bg-blue-50',
  default: 'border-gray-200 hover:border-gray-300',
};

const PricingCardView = ({
  filteredModels,
  loading,
  rowSelection,
  pageSize,
  setPageSize,
  currentPage,
  setCurrentPage,
  selectedGroup,
  groupRatio,
  copyText,
  setModalImageUrl,
  setIsModalOpenurl,
  currency,
  siteDisplayType,
  tokenUnit,
  displayPrice,
  showRatio,
  t,
  selectedRowKeys = [],
  setSelectedRowKeys,
  openModelDetail,
}) => {
  const showSkeleton = useMinimumLoadingTime(loading);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedModels = filteredModels.slice(
    startIndex,
    startIndex + pageSize,
  );
  const getModelKey = (model) => model.key ?? model.model_name ?? model.id;
  const isMobile = useIsMobile();

  const handleCheckboxChange = (model, checked) => {
    if (!setSelectedRowKeys) return;
    const modelKey = getModelKey(model);
    const newKeys = checked
      ? Array.from(new Set([...selectedRowKeys, modelKey]))
      : selectedRowKeys.filter((key) => key !== modelKey);
    setSelectedRowKeys(newKeys);
    rowSelection?.onChange?.(newKeys, null);
  };

  // 获取模型图标
  const getModelIcon = (model) => {
    if (!model || !model.model_name) {
      return (
        <div className={CARD_STYLES.container}>
          <Avatar size='large'>?</Avatar>
        </div>
      );
    }
    // 1) 优先使用模型自定义图标
    if (model.icon) {
      return (
        <div className={CARD_STYLES.container}>
          <div className={CARD_STYLES.icon}>
            {getLobeHubIcon(model.icon, 32)}
          </div>
        </div>
      );
    }
    // 2) 退化为供应商图标
    if (model.vendor_icon) {
      return (
        <div className={CARD_STYLES.container}>
          <div className={CARD_STYLES.icon}>
            {getLobeHubIcon(model.vendor_icon, 32)}
          </div>
        </div>
      );
    }

    // 如果没有供应商图标，使用模型名称生成头像

    const avatarText = model.model_name.slice(0, 2).toUpperCase();
    return (
      <div className={CARD_STYLES.container}>
        <Avatar
          size='large'
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            fontSize: 16,
            fontWeight: 'bold',
          }}
        >
          {avatarText}
        </Avatar>
      </div>
    );
  };

  // 获取模型描述
  const getModelDescription = (record) => {
    return record.description || '';
  };

  // 显示骨架屏
  if (showSkeleton) {
    return (
      <PricingCardSkeleton
        rowSelection={!!rowSelection}
        showRatio={showRatio}
      />
    );
  }

  if (!filteredModels || filteredModels.length === 0) {
    return (
      <div className='flex justify-center items-center py-20'>
        <Empty
          image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
          }
          description={t('搜索无结果')}
        />
      </div>
    );
  }

  return (
    <div className='pt-2'>
      <div className='pricing-card-grid'>
        {paginatedModels.map((model, index) => {
          const modelKey = getModelKey(model);
          const isSelected = selectedRowKeys.includes(modelKey);

          const priceData = calculateModelPrice({
            record: model,
            selectedGroup,
            groupRatio,
            tokenUnit,
            displayPrice,
            currency,
            quotaDisplayType: siteDisplayType,
          });
          const cardPrices = buildCardPrices(priceData, t, siteDisplayType);

          return (
            <Card
              key={modelKey || index}
              className={`!rounded-2xl transition-all duration-200 hover:shadow-lg border cursor-pointer ${isSelected ? CARD_STYLES.selected : CARD_STYLES.default}`}
              bodyStyle={{ height: '100%' }}
              onClick={() => openModelDetail && openModelDetail(model)}
            >
              <div className='flex h-full flex-col gap-3'>
                <div className='flex items-start gap-3'>
                  <div className='shrink-0'>{getModelIcon(model)}</div>
                  <div className='min-w-0 flex-1'>
                    <h3 className='line-clamp-2 break-all font-mono text-[15px] font-semibold'>
                      {model.model_name}
                    </h3>
                    {model.vendor_name && (
                      <p
                        className='mt-1 truncate text-xs'
                        style={{ color: 'var(--semi-color-text-2)' }}
                      >
                        {model.vendor_name}
                      </p>
                    )}
                  </div>
                  <Button
                    size='small'
                    theme='borderless'
                    type='tertiary'
                    icon={<Copy size={14} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      copyText(model.model_name);
                    }}
                  />
                  {rowSelection && (
                    <Checkbox
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleCheckboxChange(model, e.target.checked);
                      }}
                    />
                  )}
                </div>

                <p
                  className='line-clamp-2 text-[13px] leading-5'
                  style={{ color: 'var(--semi-color-text-2)' }}
                >
                  {getModelDescription(model) || t('暂无描述。')}
                </p>

                <div className='mt-auto flex flex-col gap-2'>
                  <div className='flex min-w-0 flex-wrap items-center gap-1'>
                    <span
                      className='text-xs'
                      style={{ color: billingTypeOf(model, t).color }}
                    >
                      {billingTypeOf(model, t).label}
                    </span>
                    {splitTags(model.tags).length > 0 &&
                      renderLimitedItems({
                        items: splitTags(model.tags).map((tag) => ({
                          key: tag,
                          element: (
                            <Tag
                              key={tag}
                              size='small'
                              shape='circle'
                              color={stringToColor(tag)}
                            >
                              {tag}
                            </Tag>
                          ),
                        })),
                        renderItem: (item) => item.element,
                        maxDisplay: 3,
                      })}
                  </div>
                  <div className='grid grid-cols-3 gap-2'>
                    {cardPrices.cells.map((cell) => (
                      <PriceCell
                        key={cell.key}
                        label={cell.label}
                        value={cell.value}
                        unit={cell.unit}
                      />
                    ))}
                  </div>
                  {cardPrices.original && (
                    <div
                      className='text-xs italic line-through'
                      style={{ color: 'var(--semi-color-text-2)' }}
                    >
                      {cardPrices.original.label} {cardPrices.original.value}
                    </div>
                  )}
                  {cardPrices.extras.length > 0 && (
                    <div
                      className='flex flex-wrap gap-x-3 gap-y-0.5 text-xs'
                      style={{ color: 'var(--semi-color-text-2)' }}
                    >
                      {cardPrices.extras.map((item) => (
                        <span key={item.key}>
                          {item.label}{' '}
                          <span
                            className='font-mono'
                            style={{ color: 'var(--semi-color-text-1)' }}
                          >
                            {item.value}
                            {item.suffix}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className='grid grid-cols-2 gap-2 text-xs'>
                    <MetaLine
                      label={t('分组')}
                      values={model.enable_groups || []}
                    />
                    <MetaLine
                      label={t('端点')}
                      values={model.supported_endpoint_types || []}
                    />
                  </div>
                </div>

                {showRatio && (
                  <div
                    className='text-xs'
                    style={{ color: 'var(--semi-color-text-2)' }}
                  >
                    <div className='mb-1 flex items-center gap-1'>
                      <span className='font-medium'>{t('倍率信息')}</span>
                      <Tooltip content={t('倍率是为了方便换算不同价格的模型')}>
                        <IconHelpCircle
                          className='cursor-pointer text-blue-500'
                          size='small'
                          onClick={(e) => {
                            e.stopPropagation();
                            setModalImageUrl?.('/ratio.png');
                            setIsModalOpenurl?.(true);
                          }}
                        />
                      </Tooltip>
                    </div>
                    <div className='grid grid-cols-3 gap-2'>
                      <div>
                        {t('模型')}:{' '}
                        {model.quota_type === 0 ? model.model_ratio : t('无')}
                      </div>
                      <div>
                        {t('补全')}:{' '}
                        {model.quota_type === 0
                          ? parseFloat(
                              Number(model.completion_ratio || 0).toFixed(3),
                            )
                          : t('无')}
                      </div>
                      <div>
                        {t('分组')}: {priceData?.usedGroupRatio ?? '-'}
                      </div>
                    </div>
                  </div>
                )}

                <div
                  className='border-t pt-2'
                  style={{ borderColor: 'var(--semi-color-border)' }}
                >
                  <ModelStatusRow status={model.status} t={t}>
                    <Button
                      size='small'
                      theme='borderless'
                      onClick={(e) => {
                        e.stopPropagation();
                        openModelDetail && openModelDetail(model);
                      }}
                    >
                      <span className='inline-flex items-center gap-0.5'>
                        {t('详情')}
                        <ChevronRight size={14} />
                      </span>
                    </Button>
                  </ModelStatusRow>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* 分页 */}
      {filteredModels.length > 0 && (
        <div className='flex justify-center mt-6 py-4 border-t pricing-pagination-divider'>
          <Pagination
            currentPage={currentPage}
            pageSize={pageSize}
            total={filteredModels.length}
            showSizeChanger={true}
            pageSizeOptions={[10, 20, 50, 100]}
            size={isMobile ? 'small' : 'default'}
            showQuickJumper={isMobile}
            onPageChange={(page) => setCurrentPage(page)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default PricingCardView;
