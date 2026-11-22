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

import React, { useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { Copy, HeartPulse, Info, Code2, Timer, Zap } from 'lucide-react';
import {
  calculateModelPrice,
  getLobeHubIcon,
  getModelPriceItems,
} from '../../../../../helpers';
import {
  formatLatency,
  formatThroughput,
} from '../../view/card/ModelStatusRow';
import ModelPerformancePanel from './ModelPerformancePanel';
import ModelApiSamples from './ModelApiSamples';
import {
  billingTypeOf,
  groupColor,
  successTextColor,
  trimPrice,
} from '../../squareUtils';

const sectionTitleStyle = {
  margin: '0 0 12px',
  color: 'var(--semi-color-text-2)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const unitText = (unit) =>
  unit === 'K' || unit === 'M' ? `1${unit}` : unit || '';

const PriceValue = ({ value, unit }) => (
  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
    {trimPrice(value) || '—'}
    {unit ? (
      <span
        style={{
          marginLeft: 4,
          color: 'var(--semi-color-text-2)',
          fontSize: 12,
          fontWeight: 400,
        }}
      >
        / {unitText(unit)}
      </span>
    ) : null}
  </span>
);

const ModelSquareHeader = ({ modelData, t }) => {
  const icon = modelData?.icon || modelData?.vendor_icon;
  const description = modelData?.description || modelData?.vendor_description;
  return (
    <header>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon ? <span>{getLobeHubIcon(icon, 20)}</span> : null}
        <h2
          style={{
            margin: 0,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          {modelData?.model_name || t('未知模型')}
        </h2>
        <button
          type='button'
          aria-label={t('复制模型名称')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(modelData?.model_name || '');
              Toast.success(t('已复制'));
            } catch (e) {
              Toast.error(t('复制失败'));
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            border: 0,
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--semi-color-text-2)',
            cursor: 'pointer',
          }}
        >
          <Copy size={14} />
        </button>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          marginTop: 6,
          color: 'var(--semi-color-text-2)',
          fontSize: 12,
        }}
      >
        {modelData?.vendor_name ? <span>{modelData.vendor_name}</span> : null}
        <span style={{ opacity: 0.4 }}>·</span>
        <span
          style={{
            color: billingTypeOf(modelData, t).color,
            fontWeight: 500,
          }}
        >
          {billingTypeOf(modelData, t).label}
        </span>
      </div>
      {description ? (
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--semi-color-text-1)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {description}
        </p>
      ) : null}
    </header>
  );
};

// 上游 OverviewMetric：左侧小图标，右侧标签 + 数值，格子之间竖线分隔
const Metric = ({ icon: Icon, label, value, color }) => (
  <div className='flex min-w-0 items-center gap-2 px-3 py-2'>
    {Icon ? (
      <Icon
        size={14}
        style={{
          flexShrink: 0,
          color: 'var(--semi-color-text-2)',
          opacity: 0.8,
        }}
      />
    ) : null}
    <div className='min-w-0 flex-1'>
      <div
        className='truncate text-[10px] font-medium uppercase tracking-wider'
        style={{ color: 'var(--semi-color-text-2)' }}
      >
        {label}
      </div>
      <div
        className='truncate font-mono text-sm font-semibold tabular-nums'
        style={{ color: color || 'var(--semi-color-text-0)' }}
      >
        {value}
      </div>
    </div>
  </div>
);

const OverviewPrices = ({
  modelData,
  groupRatio,
  usableGroup,
  autoGroups,
  currency,
  siteDisplayType,
  tokenUnit,
  displayPrice,
  t,
}) => {
  const priceArgs = {
    record: modelData,
    groupRatio,
    tokenUnit,
    displayPrice,
    currency,
    quotaDisplayType: siteDisplayType,
  };
  const base = calculateModelPrice({
    ...priceArgs,
    selectedGroup: '_base',
    groupRatio: { ...(groupRatio || {}), _base: 1 },
  });
  const unit = modelData?.quota_type === 1 ? t('次') : base.unitLabel;
  const groups = Object.keys(usableGroup || {})
    .filter((group) => group && group !== 'auto')
    .filter((group) => (modelData?.enable_groups || []).includes(group));
  const autoChain = (autoGroups || []).filter((group) =>
    (modelData?.enable_groups || []).includes(group),
  );
  const secondary = [
    base.cachePrice ? { label: t('缓存读取'), value: base.cachePrice } : null,
    base.createCachePrice
      ? { label: t('缓存写入'), value: base.createCachePrice }
      : null,
    base.imagePrice ? { label: t('图片输入'), value: base.imagePrice } : null,
  ].filter(Boolean);

  return (
    <section
      style={{
        marginTop: 16,
        border: '1px solid var(--semi-color-border)',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h3 style={sectionTitleStyle}>{t('定价')}</h3>
      <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
        {t('基础价格')}
      </div>
      {base.isTokensDisplay ? (
        // 站点按 TOKENS 显示额度时 calculateModelPrice 只给倍率，没有价格字段
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
        >
          {getModelPriceItems(base, t, siteDisplayType).map((item) => (
            <div
              key={item.key}
              style={{
                border: '1px solid var(--semi-color-border)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>
                {item.label}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                }}
              >
                {item.value}
                {item.suffix}
              </div>
            </div>
          ))}
        </div>
      ) : modelData?.quota_type === 0 ? (
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
        >
          <div
            style={{
              border: '1px solid var(--semi-color-border)',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>
              {t('输入')}
            </div>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600 }}>
              <PriceValue value={base.inputPrice} unit={unit} />
            </div>
          </div>
          <div
            style={{
              border: '1px solid var(--semi-color-border)',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>
              {t('输出')}
            </div>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600 }}>
              <PriceValue value={base.completionPrice} unit={unit} />
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 14,
          }}
        >
          <span style={{ color: 'var(--semi-color-text-2)' }}>{t('每次')}</span>
          <PriceValue value={base.price} unit={t('次')} />
        </div>
      )}
      {secondary.length > 0 && (
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--semi-color-border)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          {secondary.map((item) => (
            <div
              key={item.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '4px 0',
                fontSize: 14,
              }}
            >
              <span style={{ color: 'var(--semi-color-text-2)' }}>
                {item.label}
              </span>
              <PriceValue value={item.value} unit={unit} />
            </div>
          ))}
        </div>
      )}

      <div style={{ margin: '18px 0 8px', fontSize: 13, fontWeight: 600 }}>
        {t('按分组定价')}
      </div>
      {autoChain.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
            color: 'var(--semi-color-text-2)',
            fontSize: 12,
          }}
        >
          <span>{t('auto 分组链路')}</span>
          <span>→</span>
          {autoChain.map((group, index) => (
            <span key={group}>
              <span style={{ color: groupColor(group), fontWeight: 600 }}>
                {group}
              </span>
              {index < autoChain.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </div>
      )}
      <div style={{ overflow: 'auto' }}>
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
        >
          <thead>
            <tr
              style={{ color: 'var(--semi-color-text-2)', textAlign: 'left' }}
            >
              <th style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>
                {t('分组')}
              </th>
              <th style={{ padding: 8, fontWeight: 500 }}>{t('倍率')}</th>
              {modelData?.quota_type === 0 ? (
                <>
                  <th
                    style={{ padding: 8, fontWeight: 500, textAlign: 'right' }}
                  >
                    {t('输入')}
                  </th>
                  <th
                    style={{ padding: 8, fontWeight: 500, textAlign: 'right' }}
                  >
                    {t('输出')}
                  </th>
                  <th
                    style={{ padding: 8, fontWeight: 500, textAlign: 'right' }}
                  >
                    {t('缓存')}
                  </th>
                  {base.createCachePrice && (
                    <th
                      style={{
                        padding: 8,
                        fontWeight: 500,
                        textAlign: 'right',
                      }}
                    >
                      {t('缓存写入')}
                    </th>
                  )}
                </>
              ) : (
                <th style={{ padding: 8, fontWeight: 500, textAlign: 'right' }}>
                  {t('价格')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const price = calculateModelPrice({
                ...priceArgs,
                selectedGroup: group,
              });
              return (
                <tr
                  key={group}
                  style={{ borderTop: '1px solid var(--semi-color-border)' }}
                >
                  <td
                    style={{
                      padding: '10px 8px 10px 0',
                      color: groupColor(group),
                      fontWeight: 600,
                    }}
                  >
                    {group}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    }}
                  >
                    {formatGroupRatio(groupRatio?.[group])}
                  </td>
                  {modelData?.quota_type === 0 ? (
                    <>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        <PriceValue value={price.inputPrice} />
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        <PriceValue value={price.completionPrice} />
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        <PriceValue value={price.cachePrice} />
                      </td>
                      {base.createCachePrice && (
                        <td style={{ padding: 8, textAlign: 'right' }}>
                          <PriceValue value={price.createCachePrice} />
                        </td>
                      )}
                    </>
                  ) : (
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      <PriceValue value={price.price} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p
        style={{
          margin: '8px 0 0',
          color: 'var(--semi-color-text-2)',
          fontSize: 10,
        }}
      >
        {modelData?.quota_type === 0
          ? `${t('价格显示单位')} ${unitText(base.unitLabel)} tokens`
          : t('价格按次显示')}
      </p>
    </section>
  );
};

const formatGroupRatio = (ratio) => {
  const value = Number(ratio ?? 1);
  if (!Number.isFinite(value)) return '1x';
  const text = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return `${text}x`;
};

const Catalog = ({ modelData, t }) => {
  const groups = (modelData?.enable_groups || []).filter(Boolean);
  const endpoints = (modelData?.supported_endpoint_types || []).filter(Boolean);
  const tags = String(modelData?.tags || '')
    .split(/[,;|]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const cells = [];
  if (modelData?.vendor_name) {
    cells.push({ label: t('供应商'), value: modelData.vendor_name });
  }
  const billing = billingTypeOf(modelData, t);
  cells.push({
    label: t('类型'),
    value: <span style={{ color: billing.color }}>{billing.label}</span>,
  });
  if (groups.length) cells.push({ label: t('分组'), value: groups });
  if (endpoints.length) cells.push({ label: t('端点'), value: endpoints });
  if (tags.length) cells.push({ label: t('标签'), value: tags });
  if (!cells.length) return null;

  return (
    <section style={{ marginTop: 16 }}>
      <h3 style={sectionTitleStyle}>{t('模型')}</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 1,
          overflow: 'hidden',
          border: '1px solid var(--semi-color-border)',
          borderRadius: 8,
          background: 'var(--semi-color-border)',
        }}
      >
        {cells.map((cell) => (
          <div
            key={cell.label}
            style={{
              background: 'var(--semi-color-bg-1)',
              padding: '10px 12px',
            }}
          >
            <div
              style={{
                color: 'var(--semi-color-text-2)',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {cell.label}
            </div>
            {Array.isArray(cell.value) ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {cell.value.map((item) => (
                  <span
                    key={item}
                    style={{
                      borderRadius: 6,
                      padding: '2px 8px',
                      background: 'var(--semi-color-fill-0)',
                      fontSize: 12,
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 14, fontWeight: 600 }}>
                {cell.value}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

const TABS = [
  { key: 'overview', label: '概览', icon: Info },
  { key: 'performance', label: '性能', icon: HeartPulse },
  { key: 'api', label: 'API', icon: Code2 },
];

const ModelSquareDetail = (props) => {
  const { modelData, t } = props;
  const [tab, setTab] = useState('overview');
  const status = modelData?.status;
  const hasData = Boolean(status?.has_data);

  if (!modelData) {
    return (
      <div style={{ padding: 24, color: 'var(--semi-color-text-2)' }}>
        {t('加载中...')}
      </div>
    );
  }

  return (
    <div>
      <ModelSquareHeader modelData={modelData} t={t} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 4,
          marginTop: 16,
          padding: 4,
          borderRadius: 8,
          background: 'var(--semi-color-fill-0)',
        }}
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type='button'
              onClick={() => setTab(item.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 32,
                border: 0,
                borderRadius: 6,
                background: active ? 'var(--semi-color-bg-0)' : 'transparent',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icon size={14} />
              {t(item.label)}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <div>
          <div className='pricing-metric-strip'>
            <Metric
              icon={Timer}
              label='TPS'
              value={formatThroughput(Number(status?.throughput))}
            />
            <Metric
              icon={Zap}
              label={t('首字延迟')}
              value={hasData ? formatLatency(Number(status?.ttft)) : '—'}
            />
            <Metric
              icon={Timer}
              label={t('平均延迟')}
              value={hasData ? formatLatency(Number(status?.latency)) : '—'}
            />
            <Metric
              icon={HeartPulse}
              label={t('成功率')}
              value={
                hasData ? `${Number(status.availability).toFixed(2)}%` : '—'
              }
              color={
                hasData
                  ? successTextColor(Number(status.availability))
                  : undefined
              }
            />
          </div>
          <OverviewPrices {...props} />
          <Catalog modelData={modelData} t={t} />
        </div>
      )}
      {tab === 'performance' && (
        <div style={{ marginTop: 16 }}>
          <ModelPerformancePanel modelData={modelData} t={t} />
        </div>
      )}
      {tab === 'api' && (
        <div style={{ marginTop: 16 }}>
          <ModelApiSamples
            modelData={modelData}
            endpointMap={props.endpointMap}
            t={t}
          />
        </div>
      )}
    </div>
  );
};

export default ModelSquareDetail;
