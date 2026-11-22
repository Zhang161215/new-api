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

// 上游 rc.43：系统访问令牌改成「作用域访问令牌」。每人最多若干个，按资源 × 操作授权，
// 可设有效期；创建、改权限、撤销都要安全验证，改名不用。旧版令牌（users.access_token）
// 在过渡期内仍可用（拥有全部权限），到期自动停用，这里提示并提供撤销。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { IconKey, IconCopy } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import {
  API,
  copy,
  showError,
  showSuccess,
  timestamp2string,
} from '../../../../helpers';
import {
  loadServerLocale,
  translateServerKey,
} from '../../../../helpers/serverLocale';
import { useSecureVerification } from '../../../../hooks/common/useSecureVerification';
import SecureVerificationModal from '../../../common/modals/SecureVerificationModal';
import {
  securityResult,
  securityRequestConfig,
  withProof,
} from '../../../../services/secureVerification';

const DAY = 24 * 60 * 60;
const EXPIRY_OPTIONS = [
  { value: '30d', days: 30, label: '30 天' },
  { value: '90d', days: 90, label: '90 天' },
  { value: '180d', days: 180, label: '180 天' },
  { value: '1y', days: 365, label: '1 年' },
  { value: 'custom', label: '自定义' },
  { value: 'never', label: '永不过期' },
];
const GROUP_LABELS = { personal: '个人', admin: '管理', system: '系统' };

const nowSeconds = () => Math.floor(Date.now() / 1000);

function sameScopes(a = [], b = []) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((s) => set.has(s));
}

function resolveExpiry(expiry, customDate) {
  if (expiry === 'never') return 0;
  if (expiry === 'custom') {
    return customDate ? Math.floor(new Date(customDate).getTime() / 1000) : -1;
  }
  const option = EXPIRY_OPTIONS.find((o) => o.value === expiry);
  return nowSeconds() + (option?.days || 30) * DAY;
}

const ScopeMatrix = ({ catalog, dict, value, onChange, disabled }) => {
  const { t } = useTranslation();
  const selected = new Set(value);
  const toggle = (scope, checked) => {
    const next = new Set(selected);
    if (checked) next.add(scope);
    else next.delete(scope);
    onChange([...next]);
  };
  return (
    <div className='space-y-4'>
      {(catalog?.groups || []).map((group) => (
        <div key={group.group}>
          <Typography.Text strong className='block mb-2'>
            {t(GROUP_LABELS[group.group] || group.group)}
          </Typography.Text>
          <div className='space-y-2'>
            {group.resources.map((resource) => (
              <div
                key={resource.resource}
                className='flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 rounded-lg px-3 py-2'
                style={{ background: 'var(--semi-color-fill-0)' }}
              >
                <div className='sm:w-36 flex-shrink-0'>
                  <Typography.Text>
                    {translateServerKey(dict, resource.label_key)}
                  </Typography.Text>
                </div>
                <div className='flex flex-wrap gap-x-4 gap-y-1'>
                  {resource.actions.map((action) => {
                    const scope = `${resource.resource}:${action.action}`;
                    return (
                      <Tooltip
                        key={scope}
                        content={translateServerKey(
                          dict,
                          action.description_key,
                        )}
                        position='top'
                      >
                        <Checkbox
                          checked={selected.has(scope)}
                          disabled={disabled}
                          onChange={(e) => toggle(scope, e.target.checked)}
                        >
                          {translateServerKey(dict, action.label_key)}
                        </Checkbox>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const AccessTokenFormModal = ({
  visible,
  editing,
  catalog,
  dict,
  submitting,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('30d');
  const [customDate, setCustomDate] = useState(null);
  const [scopes, setScopes] = useState([]);

  useEffect(() => {
    if (!visible) return;
    setName(editing?.name || '');
    setExpiry('30d');
    setCustomDate(null);
    setScopes(editing?.scopes || []);
  }, [visible, editing]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || [...trimmed].length > 64) {
      showError(t('名称需要 1 到 64 个字符'));
      return;
    }
    if (scopes.length === 0) {
      showError(t('请至少选择一项权限'));
      return;
    }
    if (editing) {
      onSubmit({ name: trimmed, scopes });
      return;
    }
    const expiresAt = resolveExpiry(expiry, customDate);
    if (expiresAt < 0 || (expiresAt !== 0 && expiresAt < nowSeconds() + 3600)) {
      showError(t('有效期至少要在一小时之后'));
      return;
    }
    onSubmit({ name: trimmed, scopes, expires_at: expiresAt });
  };

  return (
    <Modal
      title={editing ? t('编辑访问令牌') : t('创建访问令牌')}
      visible={visible}
      onCancel={submitting ? undefined : onCancel}
      onOk={submit}
      okText={editing ? t('保存') : t('创建')}
      cancelText={t('取消')}
      okButtonProps={{ loading: submitting }}
      width={640}
      centered
      bodyStyle={{ maxHeight: '65vh', overflowY: 'auto' }}
    >
      <div className='space-y-4'>
        <div>
          <Typography.Text strong className='block mb-1'>
            {t('名称')}
          </Typography.Text>
          <Input
            value={name}
            onChange={setName}
            maxLength={64}
            placeholder={t('例如：监控脚本')}
            disabled={submitting}
          />
        </div>
        {!editing && (
          <div>
            <Typography.Text strong className='block mb-1'>
              {t('有效期')}
            </Typography.Text>
            <Space wrap>
              <Select
                value={expiry}
                onChange={setExpiry}
                style={{ width: 160 }}
                disabled={submitting}
                optionList={EXPIRY_OPTIONS.map((o) => ({
                  value: o.value,
                  label: t(o.label),
                }))}
              />
              {expiry === 'custom' && (
                <DatePicker
                  type='dateTime'
                  value={customDate}
                  onChange={setCustomDate}
                  disabled={submitting}
                  disabledDate={(date) =>
                    date && date.getTime() < Date.now() - DAY * 1000
                  }
                />
              )}
            </Space>
            {expiry === 'never' && (
              <Typography.Text
                type='warning'
                size='small'
                className='block mt-1'
              >
                {t('永不过期的令牌在撤销前一直有效，能设置有效期时尽量设置。')}
              </Typography.Text>
            )}
          </div>
        )}
        <div>
          <Typography.Text strong className='block mb-1'>
            {t('权限范围')}
          </Typography.Text>
          <Typography.Text type='tertiary' size='small' className='block mb-2'>
            {t('只勾选脚本需要的权限。令牌不能超出你自己账号的权限。')}
          </Typography.Text>
          <ScopeMatrix
            catalog={catalog}
            dict={dict}
            value={scopes}
            onChange={setScopes}
            disabled={submitting}
          />
        </div>
        {editing && !sameScopes(editing.scopes, scopes) && (
          <Banner
            type='info'
            closeIcon={null}
            description={t('修改权限范围需要先验证身份；只改名称不需要。')}
          />
        )}
      </div>
    </Modal>
  );
};

const AccessTokensCard = () => {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [dict, setDict] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdToken, setCreatedToken] = useState('');

  const security = useSecureVerification();
  const startSecurity = (apiCall, options) =>
    security.startVerification(apiCall, { title: t('安全验证'), ...options });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listData, catalogData] = await Promise.all([
        securityResult(
          API.get('/api/user/access_tokens', securityRequestConfig),
          t('加载访问令牌失败'),
        ),
        securityResult(
          API.get('/api/user/access_tokens/catalog', securityRequestConfig),
          t('加载权限目录失败'),
        ),
      ]);
      setList(listData);
      setCatalog(catalogData);
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    loadServerLocale(i18n.language).then((d) => {
      if (!cancelled) setDict(d);
    });
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  const resourceLabels = useMemo(() => {
    const map = new Map();
    (catalog?.groups || []).forEach((group) =>
      group.resources.forEach((r) => map.set(r.resource, r.label_key)),
    );
    return map;
  }, [catalog]);

  const items = list?.items || [];
  const legacy = list?.legacy || null;
  const atLimit = catalog && items.length >= catalog.max_tokens;

  const openCreate = () => {
    setEditing(null);
    setFormVisible(true);
  };
  const openEdit = (token) => {
    setEditing(token);
    setFormVisible(true);
  };

  const handleSubmit = async (values) => {
    if (editing) {
      if (sameScopes(editing.scopes, values.scopes)) {
        setSubmitting(true);
        try {
          await securityResult(
            API.patch(
              `/api/user/access_tokens/${editing.id}`,
              { name: values.name },
              securityRequestConfig,
            ),
            t('保存失败'),
          );
          showSuccess(t('保存成功'));
          setFormVisible(false);
          load();
        } catch (error) {
          showError(error.message);
        } finally {
          setSubmitting(false);
        }
        return;
      }
      const tokenId = editing.id;
      setFormVisible(false);
      startSecurity(
        async (proof) => {
          await securityResult(
            API.patch(
              `/api/user/access_tokens/${tokenId}`,
              { name: values.name, scopes: values.scopes },
              withProof(proof),
            ),
            t('保存失败'),
          );
          showSuccess(t('保存成功'));
          load();
        },
        {
          scope: 'access_token.update',
          context: { token_id: tokenId, scopes: values.scopes },
          description: t('修改访问令牌的权限范围前，请先验证身份。'),
        },
      );
      return;
    }
    setFormVisible(false);
    startSecurity(
      async (proof) => {
        const data = await securityResult(
          API.post('/api/user/access_tokens', values, withProof(proof)),
          t('创建访问令牌失败'),
        );
        setCreatedToken(data?.token || '');
        load();
      },
      {
        scope: 'access_token.generate',
        context: { scopes: values.scopes, expires_at: values.expires_at },
        description: t('创建访问令牌前，请先验证身份。'),
      },
    );
  };

  const revoke = (token) =>
    Modal.confirm({
      title: t('撤销访问令牌'),
      content: t('撤销后，使用「{{name}}」的程序将无法再调用管理接口。', {
        name: token.name,
      }),
      okText: t('撤销'),
      okButtonProps: { type: 'danger' },
      cancelText: t('取消'),
      onOk: () =>
        startSecurity(
          async (proof) => {
            await securityResult(
              API.delete(
                `/api/user/access_tokens/${token.id}`,
                withProof(proof),
              ),
              t('撤销失败'),
            );
            showSuccess(t('访问令牌已撤销'));
            load();
          },
          {
            scope: 'access_token.revoke',
            context: { token_id: token.id },
            description: t('撤销访问令牌前，请先验证身份。'),
          },
        ),
    });

  const revokeLegacy = () =>
    Modal.confirm({
      title: t('撤销旧版系统访问令牌'),
      content: t('撤销后，还在用旧令牌的程序将无法再调用管理接口。'),
      okText: t('撤销'),
      okButtonProps: { type: 'danger' },
      cancelText: t('取消'),
      onOk: () =>
        startSecurity(
          async (proof) => {
            await securityResult(
              API.delete('/api/user/access_tokens/legacy', withProof(proof)),
              t('撤销失败'),
            );
            showSuccess(t('旧版令牌已撤销'));
            load();
          },
          {
            scope: 'access_token.revoke',
            context: { legacy: true },
            description: t('撤销旧版系统访问令牌前，请先验证身份。'),
          },
        ),
    });

  const renderExpiry = (token) => {
    if (!token.expires_at) {
      return (
        <Typography.Text type='warning' size='small'>
          {t('永不过期')}
        </Typography.Text>
      );
    }
    if (token.expires_at <= nowSeconds()) {
      return (
        <Typography.Text type='danger' size='small'>
          {t('已过期')}
        </Typography.Text>
      );
    }
    return (
      <Typography.Text type='tertiary' size='small'>
        {t('到期')} {timestamp2string(token.expires_at)}
      </Typography.Text>
    );
  };

  const renderLastUsed = (token) =>
    token.last_used_at
      ? `${t('最近使用')} ${timestamp2string(token.last_used_at)}${token.last_used_ip ? ` · ${token.last_used_ip}` : ''}`
      : t('尚未使用');

  return (
    <Card className='!rounded-xl w-full'>
      <div className='flex flex-col sm:flex-row items-start sm:justify-between gap-4'>
        <div className='flex items-start w-full sm:w-auto'>
          <div className='w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mr-4 flex-shrink-0'>
            <IconKey size='large' className='text-slate-600' />
          </div>
          <div className='flex-1'>
            <Typography.Title heading={6} className='mb-1'>
              {t('访问令牌')}
            </Typography.Title>
            <Typography.Text type='tertiary' className='text-sm'>
              {t(
                '给脚本或第三方工具调用管理接口用，可以按权限范围授权；令牌只在创建时显示一次。',
              )}
            </Typography.Text>
          </div>
        </div>
        <Tooltip
          content={
            atLimit
              ? t('最多可以创建 {{count}} 个访问令牌', {
                  count: catalog.max_tokens,
                })
              : null
          }
          visible={atLimit ? undefined : false}
        >
          <Button
            type='primary'
            theme='solid'
            icon={<IconKey />}
            disabled={loading || !catalog || atLimit}
            onClick={openCreate}
            className='!bg-slate-600 hover:!bg-slate-700 w-full sm:w-auto'
          >
            {t('创建访问令牌')}
          </Button>
        </Tooltip>
      </div>

      {legacy && (
        <Banner
          className='mt-4'
          type='warning'
          closeIcon={null}
          description={
            <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
              <span>
                {t(
                  '你还有一个旧版系统访问令牌（…{{hint}}），它拥有全部权限，将于 {{time}} 停用。建议改用上面的访问令牌，并撤销旧令牌。',
                  {
                    hint: legacy.token_hint || '',
                    time: legacy.retire_at
                      ? timestamp2string(legacy.retire_at)
                      : '-',
                  },
                )}
                {legacy.last_used_at
                  ? ` ${t('最近使用')} ${timestamp2string(legacy.last_used_at)}${legacy.last_used_ip ? ` · ${legacy.last_used_ip}` : ''}`
                  : ''}
              </span>
              <Button
                type='danger'
                theme='outline'
                size='small'
                onClick={revokeLegacy}
              >
                {t('撤销旧令牌')}
              </Button>
            </div>
          }
        />
      )}

      <div className='mt-4'>
        {loading ? (
          <div className='py-6 flex justify-center'>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty
            description={t('还没有访问令牌')}
            style={{ padding: '16px 0' }}
          />
        ) : (
          <div
            className='divide-y'
            style={{ borderColor: 'var(--semi-color-border)' }}
          >
            {items.map((token) => {
              const resources = [
                ...new Set((token.scopes || []).map((s) => s.split(':', 1)[0])),
              ];
              const labels = resources
                .map((r) => resourceLabels.get(r))
                .filter(Boolean)
                .map((key) => translateServerKey(dict, key));
              const hidden = resources.length - Math.min(labels.length, 4);
              return (
                <div
                  key={token.id}
                  className='flex flex-col sm:flex-row sm:items-start gap-2 py-3'
                >
                  <div className='flex-1 min-w-0 space-y-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Typography.Text strong className='break-all'>
                        {token.name}
                      </Typography.Text>
                      <Typography.Text type='tertiary' size='small' code>
                        nap_…{token.token_hint}
                      </Typography.Text>
                    </div>
                    <div className='flex flex-wrap gap-1'>
                      {labels.slice(0, 4).map((label) => (
                        <Tag key={label} size='small' color='grey'>
                          {label}
                        </Tag>
                      ))}
                      {hidden > 0 && (
                        <Tag size='small' type='ghost'>
                          +{hidden}
                        </Tag>
                      )}
                    </div>
                    <div className='flex flex-wrap gap-x-3 gap-y-1'>
                      <Typography.Text type='tertiary' size='small'>
                        {t('创建于')} {timestamp2string(token.created_at)}
                      </Typography.Text>
                      {renderExpiry(token)}
                      <Typography.Text
                        type='tertiary'
                        size='small'
                        className='break-all'
                      >
                        {renderLastUsed(token)}
                      </Typography.Text>
                    </div>
                  </div>
                  <Space>
                    <Button
                      size='small'
                      disabled={!catalog}
                      onClick={() => openEdit(token)}
                    >
                      {t('编辑')}
                    </Button>
                    <Button
                      size='small'
                      type='danger'
                      theme='outline'
                      onClick={() => revoke(token)}
                    >
                      {t('撤销')}
                    </Button>
                  </Space>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AccessTokenFormModal
        visible={formVisible}
        editing={editing}
        catalog={catalog}
        dict={dict}
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={() => setFormVisible(false)}
      />

      <Modal
        title={t('访问令牌已创建')}
        visible={!!createdToken}
        onCancel={() => setCreatedToken('')}
        footer={
          <Button
            type='primary'
            theme='solid'
            onClick={() => setCreatedToken('')}
          >
            {t('我已保存')}
          </Button>
        }
        centered
      >
        <Typography.Text type='warning' className='block mb-2'>
          {t('令牌只显示这一次，请立即复制保存。')}
        </Typography.Text>
        <Input
          readonly
          value={createdToken}
          suffix={
            <Button
              theme='borderless'
              icon={<IconCopy />}
              onClick={async () => {
                if (await copy(createdToken)) showSuccess(t('已复制到剪贴板'));
              }}
            />
          }
        />
      </Modal>

      <SecureVerificationModal
        visible={security.isModalVisible}
        requirements={security.requirements}
        verificationState={security.verificationState}
        onVerify={security.executeVerification}
        onCancel={security.cancelVerification}
        onCodeChange={security.setVerificationCode}
        onMethodSwitch={security.switchVerificationMethod}
        title={security.verificationState.title}
        description={security.verificationState.description}
      />
    </Card>
  );
};

export default AccessTokensCard;
