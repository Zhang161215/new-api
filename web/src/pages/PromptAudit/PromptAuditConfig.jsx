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

import React, { useEffect, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Col,
  Form,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  API,
  compareObjects,
  showError,
  showSuccess,
  showWarning,
} from '../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const KEYS = {
  enabled: 'prompt_audit_setting.enabled',
  blocking: 'prompt_audit_setting.blocking',
  baseUrl: 'prompt_audit_setting.base_url',
  apiKey: 'prompt_audit_setting.api_key',
  model: 'prompt_audit_setting.model',
  threshold: 'prompt_audit_setting.threshold',
  timeoutMs: 'prompt_audit_setting.timeout_ms',
  maxInputChars: 'prompt_audit_setting.max_input_chars',
  failOpen: 'prompt_audit_setting.fail_open',
  systemPrompt: 'prompt_audit_setting.system_prompt',
  groups: 'prompt_audit_setting.groups',
  recordAll: 'prompt_audit_setting.record_all',
  sampleRate: 'prompt_audit_setting.sample_rate',
  notifyEnabled: 'prompt_audit_setting.notify_enabled',
  notifyEmail: 'prompt_audit_setting.notify_email',
  notifyThreshold: 'prompt_audit_setting.notify_threshold',
  notifyBlockedOnly: 'prompt_audit_setting.notify_blocked_only',
  notifyCooldownSec: 'prompt_audit_setting.notify_cooldown_sec',
  cacheTtlSec: 'prompt_audit_setting.cache_ttl_sec',
  auditScope: 'prompt_audit_setting.audit_scope',
  scopeMessages: 'prompt_audit_setting.scope_messages',
  retentionDays: 'prompt_audit_setting.retention_days',
  promptStorage: 'prompt_audit_setting.prompt_storage',
  fallbackEnabled: 'prompt_audit_setting.fallback_enabled',
  fallbackBaseUrl: 'prompt_audit_setting.fallback_base_url',
  fallbackApiKey: 'prompt_audit_setting.fallback_api_key',
  fallbackModel: 'prompt_audit_setting.fallback_model',
  disableThinking: 'prompt_audit_setting.disable_thinking',
  autoBanEnabled: 'prompt_audit_setting.auto_ban_enabled',
  autoBanThreshold: 'prompt_audit_setting.auto_ban_threshold',
  autoBanWindowMin: 'prompt_audit_setting.auto_ban_window_min',
  autoBanMinConfidence: 'prompt_audit_setting.auto_ban_min_confidence',
  autoBanDryRun: 'prompt_audit_setting.auto_ban_dry_run',
  autoBanExemptAdmin: 'prompt_audit_setting.auto_ban_exempt_admin',
  autoBanExemptUsers: 'prompt_audit_setting.auto_ban_exempt_users',
};

export default function PromptAuditConfig(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [inputs, setInputs] = useState({
    [KEYS.enabled]: false,
    [KEYS.blocking]: false,
    [KEYS.baseUrl]: '',
    [KEYS.apiKey]: '',
    [KEYS.model]: '',
    [KEYS.threshold]: 0.6,
    [KEYS.timeoutMs]: 4000,
    [KEYS.maxInputChars]: 8000,
    [KEYS.failOpen]: true,
    [KEYS.systemPrompt]: '',
    [KEYS.groups]: '',
    [KEYS.recordAll]: false,
    [KEYS.sampleRate]: 100,
    [KEYS.notifyEnabled]: false,
    [KEYS.notifyEmail]: '',
    [KEYS.notifyThreshold]: 0,
    [KEYS.notifyBlockedOnly]: false,
    [KEYS.notifyCooldownSec]: 300,
    [KEYS.cacheTtlSec]: 3600,
    [KEYS.auditScope]: 'last_user',
    [KEYS.scopeMessages]: 4,
    [KEYS.retentionDays]: 0,
    [KEYS.promptStorage]: 'all',
    [KEYS.fallbackEnabled]: false,
    [KEYS.fallbackBaseUrl]: '',
    [KEYS.fallbackApiKey]: '',
    [KEYS.fallbackModel]: '',
    [KEYS.disableThinking]: 'auto',
    [KEYS.autoBanEnabled]: false,
    [KEYS.autoBanThreshold]: 5,
    [KEYS.autoBanWindowMin]: 60,
    [KEYS.autoBanMinConfidence]: 0,
    [KEYS.autoBanDryRun]: true,
    [KEYS.autoBanExemptAdmin]: true,
    [KEYS.autoBanExemptUsers]: '',
  });
  const [inputsRow, setInputsRow] = useState(inputs);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [fallbackKeySet, setFallbackKeySet] = useState(false);
  const [testingFallback, setTestingFallback] = useState(false);
  const [fallbackTestResult, setFallbackTestResult] = useState(null);
  const [fallbackStats, setFallbackStats] = useState(null);
  const [autoBanStats, setAutoBanStats] = useState(null);
  const [groupOptions, setGroupOptions] = useState([]);
  const [notifying, setNotifying] = useState(false);
  const refForm = useRef();

  // 分组列表用于「限定审核分组」选择器
  useEffect(() => {
    API.get('/api/group/')
      .then((res) => {
        if (res.data.success) {
          setGroupOptions((res.data.data || []).map((g) => ({ label: g, value: g })));
        }
      })
      .catch(() => {});
  }, []);

  // API Key 按站点约定不会下发前端，只能查询「是否已配置」；
  // 同时取回退统计，用于判断主节点有多不可靠、回退有没有真的救回来
  useEffect(() => {
    API.get('/api/prompt_audit/config')
      .then((res) => {
        if (!res.data.success) return;
        const d = res.data.data || {};
        setApiKeySet(!!d.api_key_set);
        setFallbackKeySet(!!d.fallback_api_key_set);
        if (d.fallback_total > 0) {
          setFallbackStats({
            total: d.fallback_total,
            moderation: d.fallback_moderation || 0,
            recovered: d.fallback_recovered || 0,
          });
        } else {
          setFallbackStats(null);
        }
        if (d.auto_ban_total > 0 || d.auto_ban_dry_run_hit > 0) {
          setAutoBanStats({
            total: d.auto_ban_total || 0,
            dryRunHit: d.auto_ban_dry_run_hit || 0,
          });
        } else {
          setAutoBanStats(null);
        }
      })
      .catch(() => {});
  }, [props.options]);

  useEffect(() => {
    const next = {};
    Object.values(KEYS).forEach((key) => {
      if (props.options[key] !== undefined) {
        next[key] = props.options[key];
      }
    });
    const merged = { ...inputs, ...next };
    setInputs(merged);
    setInputsRow(merged);
    refForm.current?.setValues(merged);
  }, [props.options]);

  function handleFieldChange(fieldName) {
    return (value) => {
      setInputs((prev) => ({ ...prev, [fieldName]: value }));
    };
  }

  // 提交前自查：把浏览器自动填充造成的脏值当场拦下，
  // 否则密钥被账号名覆盖后审核会持续 401，而 fail_open 让请求静默漏审，很难察觉
  function validateBeforeSave() {
    // 主备两个密钥都要查：备用密钥同样是 mode='password'，一样会被浏览器自动填充
    for (const [label, field] of [
      ['API Key', KEYS.apiKey],
      [t('备用 API Key'), KEYS.fallbackApiKey],
    ]) {
      const key = String(inputs[field] || '').trim();
      if (!key) continue;
      if (/[\s]/.test(key)) {
        return t('{{f}} 不能包含空格或换行，请检查是否粘贴了多余内容', { f: label });
      }
      if (key.includes('@')) {
        return t(
          '{{f}} 不应包含 @，这看起来像邮箱或账号名（可能是浏览器自动填充导致），请重新粘贴密钥',
          { f: label },
        );
      }
      if (key.length < 20) {
        return t('{{f}} 长度仅 {{n}} 字符，明显短于正常密钥，请确认是否填错', {
          f: label,
          n: key.length,
        });
      }
    }
    // 开了回退却没配好，等于白开——保存前就说清楚，别等线上出事才发现
    if (String(inputs[KEYS.fallbackEnabled]) === 'true') {
      const fbModel = String(inputs[KEYS.fallbackModel] || '').trim();
      if (!fbModel) {
        return t('已启用备用节点，请填写备用模型');
      }
      if (
        fbModel === String(inputs[KEYS.model] || '').trim() &&
        !String(inputs[KEYS.fallbackBaseUrl] || '').trim()
      ) {
        return t(
          '备用模型与主模型相同且未指定备用地址，回退不会生效；请换一个模型或填写备用接口地址',
        );
      }
    }
    const mails = String(inputs[KEYS.notifyEmail] || '').trim();
    if (mails) {
      const bad = mails
        .split(/[,;\s\n]+/)
        .filter(Boolean)
        .find((m) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m));
      if (bad) {
        return t('收件邮箱 {{m}} 不是合法地址，请填完整地址或留空走站内通知', { m: bad });
      }
    }
    // 自动封号是不可逆操作，配置明显危险时先拦住
    if (String(inputs[KEYS.autoBanEnabled]) === 'true') {
      const th = Number(inputs[KEYS.autoBanThreshold]) || 0;
      if (th < 1) {
        return t('已启用自动封号，封号阈值必须大于 0');
      }
      if (th === 1 && String(inputs[KEYS.autoBanDryRun]) !== 'true') {
        return t(
          '阈值为 1 意味着单次命中即封号，误判代价极大。请调高阈值，或先开启「仅告警不封禁」观察。',
        );
      }
      if (!Number(inputs[KEYS.autoBanWindowMin])) {
        return t('已启用自动封号，请填写统计窗口（分钟）');
      }
    }
    return '';
  }

  function onSubmit() {
    const invalid = validateBeforeSave();
    if (invalid) return showError(invalid);

    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) =>
      API.put('/api/option/', {
        key: item.key,
        value: String(inputs[item.key]),
      }),
    );
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (res.includes(undefined)) {
          return showError(t('部分保存失败，请重试'));
        }
        // 后端校验不通过时返回 HTTP 200 + success:false，
        // 原来只判 undefined，会把这种失败当成成功弹「保存成功」，
        // 导致密钥被拒后管理员以为已生效——必须逐条看 success 并回显原因
        const failed = res.filter((r) => !r?.data?.success);
        if (failed.length) {
          return showError(
            failed[0]?.data?.message || t('部分保存失败，请重试'),
          );
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => showError(t('保存失败，请重试')))
      .finally(() => setLoading(false));
  }

  // 用当前表单里的（可能尚未保存的）配置试跑一次审核，便于先验证再保存
  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await API.post('/api/prompt_audit/test', {
        base_url: inputs[KEYS.baseUrl],
        api_key: inputs[KEYS.apiKey],
        model: inputs[KEYS.model],
        system_prompt: inputs[KEYS.systemPrompt],
        timeout_ms: Number(inputs[KEYS.timeoutMs]) || 0,
        threshold: Number(inputs[KEYS.threshold]) || 0,
      });
      if (res.data.success) {
        setTestResult(res.data.data);
      } else {
        showError(res.data.message || t('测试失败'));
      }
    } catch (e) {
      showError(t('测试失败'));
    } finally {
      setTesting(false);
    }
  }

  // 单独试跑备用节点。后端会临时关掉回退与缓存，
  // 否则主节点已坏却被备用救回，这里会显示"正常"而掩盖真实故障
  async function onTestFallback() {
    setTestingFallback(true);
    setFallbackTestResult(null);
    try {
      const res = await API.post('/api/prompt_audit/test', {
        target: 'fallback',
        fallback_base_url: inputs[KEYS.fallbackBaseUrl],
        fallback_api_key: inputs[KEYS.fallbackApiKey],
        fallback_model: inputs[KEYS.fallbackModel],
        system_prompt: inputs[KEYS.systemPrompt],
        timeout_ms: Number(inputs[KEYS.timeoutMs]) || 0,
        threshold: Number(inputs[KEYS.threshold]) || 0,
      });
      if (res.data.success) {
        setFallbackTestResult(res.data.data);
      } else {
        showError(res.data.message || t('测试失败'));
      }
    } catch (e) {
      showError(t('测试失败'));
    } finally {
      setTestingFallback(false);
    }
  }

  // 用当前填写的（可能未保存的）邮箱试发一封告警，验证 SMTP 链路
  async function onTestNotify() {
    setNotifying(true);
    try {
      const res = await API.post('/api/prompt_audit/test_notify', {
        notify_email: inputs[KEYS.notifyEmail],
      });
      if (res.data.success) {
        showSuccess(res.data.data?.message || t('测试告警已发送'));
      } else {
        showError(res.data.message || t('发送失败'));
      }
    } catch (e) {
      showError(t('发送失败'));
    } finally {
      setNotifying(false);
    }
  }

  // 逗号字符串 → 数组，供多选 Select 使用
  const groupValue = String(inputs[KEYS.groups] || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  const enabled = String(inputs[KEYS.enabled]) === 'true';
  const blocking = String(inputs[KEYS.blocking]) === 'true';
  const recordAll = String(inputs[KEYS.recordAll]) === 'true';
  const rate = Number(inputs[KEYS.sampleRate]) || 100;
  const promptStorage = String(inputs[KEYS.promptStorage] || 'all');
  const auditScope = String(inputs[KEYS.auditScope] || 'last_user');
  // 只审最后一条 user 消息是旧默认值：线上实测这常常只是「继续」两个字，
  // 真实意图在 system 或更早轮次里，既漏审也容易被绕过，故明确提示管理员
  const scopeHint =
    auditScope === 'last_user'
      ? t(
          '当前只审最后一条用户消息。若客户端是 Codex/Cursor 这类 agent，最后一条常常只是「继续」，真实意图在 system 或更早轮次里——建议改为「system + 最近若干条」。',
        )
      : t('已覆盖 system 与历史消息，送审文本更长，建议同时开启判定缓存以控制成本。');
  const scopeHintType = auditScope === 'last_user' ? 'warning' : 'info';
  const failOpen = String(inputs[KEYS.failOpen]) === 'true';
  const fallbackEnabled = String(inputs[KEYS.fallbackEnabled]) === 'true';
  const fallbackModel = String(inputs[KEYS.fallbackModel] || '').trim();
  const primaryModel = String(inputs[KEYS.model] || '').trim();
  const fallbackSameAsPrimary =
    fallbackModel !== '' &&
    fallbackModel === primaryModel &&
    String(inputs[KEYS.fallbackBaseUrl] || '').trim() === '';
  // 把「便宜模型 + 平台风控」这个坑说清楚：线上实测 mimo 对未成年人性内容会直接
  // 拒答而不给判定，若没有备用节点兜底，这类最恶劣的内容反而会因拿不到判定被放行
  let fallbackDescription;
  let fallbackBannerType;
  if (!fallbackEnabled) {
    fallbackBannerType = failOpen ? 'warning' : 'info';
    fallbackDescription = failOpen
      ? t(
          '当前：未启用备用节点。主节点失败时按「失败放行」处置——注意便宜的审核模型常带平台风控，遇到最恶劣的内容（如涉未成年人）会直接拒答而不给判定，这类请求会被放行。建议配置备用节点兜底。',
        )
      : t(
          '当前：未启用备用节点。主节点失败时直接拒绝请求，安全但会影响可用性。配置备用节点可两者兼顾。',
        );
  } else if (fallbackModel === '') {
    fallbackBannerType = 'warning';
    fallbackDescription = t('已开启开关但未填备用模型，回退不会生效。');
  } else if (fallbackSameAsPrimary) {
    fallbackBannerType = 'warning';
    fallbackDescription = t(
      '备用模型与主模型相同且未指定备用地址，等于把同一个节点再打一次，回退不会生效。',
    );
  } else {
    fallbackBannerType = 'success';
    fallbackDescription = t(
      '当前：主节点拿不到判定时自动改用 {{m}} 复判。上游风控拒答属于强违规信号——两级都拿不到判定时按违规拦截，不走失败放行。',
      { m: fallbackModel },
    );
  }

  // ===== 自动封号 =====
  const autoBanEnabled = String(inputs[KEYS.autoBanEnabled]) === 'true';
  const autoBanDryRun = String(inputs[KEYS.autoBanDryRun]) === 'true';
  const autoBanThreshold = Number(inputs[KEYS.autoBanThreshold]) || 0;
  const autoBanWindowMin = Number(inputs[KEYS.autoBanWindowMin]) || 60;
  const autoBanConf =
    Number(inputs[KEYS.autoBanMinConfidence]) > 0
      ? Number(inputs[KEYS.autoBanMinConfidence])
      : Number(inputs[KEYS.threshold]) || 0;
  let autoBanDescription;
  let autoBanBannerType;
  if (!autoBanEnabled) {
    autoBanBannerType = 'info';
    autoBanDescription = t('当前：不自动封号。命中只拦截单次请求，用户可以继续尝试。');
  } else if (autoBanThreshold <= 0) {
    autoBanBannerType = 'warning';
    autoBanDescription = t('阈值需大于 0，否则自动封号不会生效。');
  } else if (autoBanDryRun) {
    autoBanBannerType = 'info';
    autoBanDescription = t(
      '当前：干跑模式。{{w}} 分钟内有 {{n}} 次置信度 ≥ {{c}} 的拦截时，只发告警邮件、不修改用户状态。建议先观察几天确认阈值不会误伤，再关闭干跑。',
      { w: autoBanWindowMin, n: autoBanThreshold, c: autoBanConf.toFixed(2) },
    );
  } else {
    autoBanBannerType = 'danger';
    autoBanDescription = t(
      '当前：会真的封号。{{w}} 分钟内有 {{n}} 次置信度 ≥ {{c}} 的拦截时，该用户将被置为禁用、无法登录与调用 API。封号不可逆，误封需手动在「用户管理」恢复。',
      { w: autoBanWindowMin, n: autoBanThreshold, c: autoBanConf.toFixed(2) },
    );
  }

  const notifyEnabled = String(inputs[KEYS.notifyEnabled]) === 'true';
  const notifyBlockedOnly = String(inputs[KEYS.notifyBlockedOnly]) === 'true';
  const notifyMails = String(inputs[KEYS.notifyEmail] || '').trim();
  // 通知阈值为 0 时实际用拦截阈值，界面上直接把生效值算出来，免得管理员自己推
  const effectiveNotifyThreshold =
    Number(inputs[KEYS.notifyThreshold]) > 0
      ? Number(inputs[KEYS.notifyThreshold])
      : Number(inputs[KEYS.threshold]) || 0;
  const notifyDescription = !notifyEnabled
    ? t('当前：不发通知。命中只写入审核记录，需要主动来后台查看。')
    : t('当前：置信度 ≥ {{th}} 的{{scope}}会发通知到 {{target}}。', {
        th: effectiveNotifyThreshold.toFixed(2),
        scope: notifyBlockedOnly ? t('拦截事件') : t('命中'),
        target: notifyMails || t('root 用户配置的通知方式'),
      });

  // 把开关组合翻译成一句话，避免管理员自己推演各开关的叠加效果
  const modeDescription = !enabled
    ? t('当前：未启用。不产生任何额外请求，也不会有审核记录。')
    : blocking
      ? t(
          '当前：拦截模式。命中即拒绝请求（同步审核，会给用户增加延迟）。命中记录含完整提示词，仅管理员可见。',
        ) +
        (rate < 100 ? t('（仅抽查 {{rate}}% 的请求）', { rate }) : '')
      : t(
          '当前：观察模式（不拦截）。异步审核、用户无感知，仅记录判定结果供复核。',
        ) +
        (recordAll
          ? t('已开启记录全部结果，合规请求也会入库。')
          : t('当前只记录命中的请求，若想确认审核在工作请开启「记录全部审核结果」。')) +
        (rate < 100 ? t('（仅抽查 {{rate}}% 的请求）', { rate }) : '');

  return (
    <Spin spinning={loading}>
      <Form
        values={inputs}
        getFormApi={(formAPI) => (refForm.current = formAPI)}
        style={{ marginBottom: 15 }}
      >
        <Form.Section text={t('提示词安全审核')}>
          <Banner
            type={enabled ? (blocking ? 'warning' : 'info') : 'info'}
            description={modeDescription}
            style={{ marginBottom: 16 }}
          />
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.enabled}
                label={t('启用审核')}
                extraText={t('关闭时完全不产生额外请求')}
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                onChange={handleFieldChange(KEYS.enabled)}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.blocking}
                label={t('拦截模式')}
                extraText={
                  blocking
                    ? t('命中即拒绝请求（同步审核，会增加延迟）')
                    : t('影子模式：仅异步记录不拦截，用户无感知')
                }
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                onChange={handleFieldChange(KEYS.blocking)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Select
                field={KEYS.promptStorage}
                label={t('提示词留存')}
                extraText={t('合规请求占绝大多数，全量留存既占空间也会长期保存用户原文')}
                style={{ width: '100%' }}
                optionList={[
                  { label: t('全部保存'), value: 'all' },
                  { label: t('仅保存命中的'), value: 'hit_only' },
                  { label: t('都不保存'), value: 'none' },
                ]}
                onChange={handleFieldChange(KEYS.promptStorage)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.retentionDays}
                label={t('记录保留天数')}
                extraText={t('超期记录每小时自动清理，0=不自动清理。记录含完整提示词，增长很快')}
                min={0}
                max={365}
                style={{ width: '100%' }}
                onChange={handleFieldChange(KEYS.retentionDays)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.recordAll}
                label={t('记录全部审核结果')}
                extraText={t('开启后合规请求也入库，便于确认审核在正常工作；默认只记录命中')}
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                onChange={handleFieldChange(KEYS.recordAll)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.failOpen}
                label={t('审核失败时放行')}
                extraText={t('开启保可用性，关闭保安全（审核挂了就拒绝请求）')}
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                onChange={handleFieldChange(KEYS.failOpen)}
                disabled={!enabled}
              />
            </Col>
          </Row>
          {promptStorage !== 'all' && (
            <Banner
              type='info'
              description={t(
                '{{scope}}此设置只影响之后新增的记录，库里已保存的提示词不会被自动清除——如需处理请用下方「保留天数」或记录页的清理功能。',
                {
                  scope:
                    promptStorage === 'none'
                      ? t('已选择不保存任何提示词原文（含命中的）。')
                      : t('已选择只保存命中请求的提示词，合规请求仅留元数据。'),
                },
              )}
              style={{ marginTop: 8 }}
            />
          )}
        </Form.Section>

        <Form.Section text={t('审核范围')}>
          <Row gutter={16}>
            <Col xs={24} md={16}>
              {/* 用 Form.Slot + 独立 Select：表单值保持逗号字符串（与后端一致、
                  compareObjects 才能正确比较），多选数组交由 Select 自己管理 */}
              <Form.Slot label={t('限定审核分组')}>
                <Select
                  multiple
                  allowAdditions
                  additionLabel={t('直接回车可添加未列出的分组：')}
                  placeholder={t('留空表示审核所有分组')}
                  style={{ width: '100%' }}
                  optionList={groupOptions}
                  value={groupValue}
                  onChange={(v) =>
                    handleFieldChange(KEYS.groups)(
                      (Array.isArray(v) ? v : [v]).filter(Boolean).join(','),
                    )
                  }
                  disabled={!enabled}
                />
                <div style={{ marginTop: 4 }}>
                  <Text type='tertiary' size='small'>
                    {t('留空 = 审核所有分组；选中后只审核这些分组的请求')}
                  </Text>
                </div>
              </Form.Slot>
            </Col>
            <Col xs={24} md={8}>
              <Form.InputNumber
                field={KEYS.sampleRate}
                label={t('抽查比例 (%)')}
                extraText={t('100=全量审核；如填 20 则随机抽两成请求送审，未抽中的零开销')}
                min={1}
                max={100}
                step={5}
                suffix='%'
                style={{ width: '100%' }}
                onChange={handleFieldChange(KEYS.sampleRate)}
                disabled={!enabled}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Select
                field={KEYS.auditScope}
                label={t('送审范围')}
                extraText={t('决定把请求里的哪些内容交给审核模型判定')}
                style={{ width: '100%' }}
                optionList={[
                  { label: t('仅最后一条用户消息'), value: 'last_user' },
                  { label: t('system + 最近若干条'), value: 'recent' },
                  { label: t('system + 全部用户消息'), value: 'full' },
                ]}
                onChange={handleFieldChange(KEYS.auditScope)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} md={8}>
              <Form.InputNumber
                field={KEYS.scopeMessages}
                label={t('回溯消息条数')}
                extraText={t('「最近若干条」模式下往前追溯的消息数')}
                min={1}
                max={50}
                style={{ width: '100%' }}
                onChange={handleFieldChange(KEYS.scopeMessages)}
                disabled={!enabled || auditScope !== 'recent'}
              />
            </Col>
            <Col xs={24} md={8}>
              <Form.InputNumber
                field={KEYS.cacheTtlSec}
                label={t('判定缓存 (秒)')}
                extraText={t('相同内容在此时间内复用上次判定，0=关闭。agent 流量重复率极高，开启可大幅省钱降延迟')}
                min={0}
                max={86400}
                step={300}
                style={{ width: '100%' }}
                onChange={handleFieldChange(KEYS.cacheTtlSec)}
                disabled={!enabled}
              />
            </Col>
          </Row>
          {scopeHint && (
            <Banner type={scopeHintType} description={scopeHint} style={{ marginTop: 8 }} />
          )}
        </Form.Section>

        <Form.Section text={t('审核模型节点')}>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Input
                field={KEYS.baseUrl}
                label={t('接口地址')}
                extraText={t('OpenAI 兼容基址，不含 /chat/completions')}
                placeholder='https://api.deepseek.com'
                onChange={handleFieldChange(KEYS.baseUrl)}
                showClear
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Input
                field={KEYS.model}
                label={t('审核模型')}
                extraText={t('推荐 deepseek-v4-flash：便宜、输出稳定')}
                placeholder='deepseek-v4-flash'
                onChange={handleFieldChange(KEYS.model)}
                showClear
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Input
                field={KEYS.apiKey}
                label={
                  <Space spacing={4}>
                    {t('API Key')}
                    <Tag color={apiKeySet ? 'green' : 'grey'} shape='circle'>
                      {apiKeySet ? t('已配置') : t('未配置')}
                    </Tag>
                  </Space>
                }
                extraText={t('出于安全不回显；留空保存则不修改已存密钥')}
                placeholder={apiKeySet ? '••••••••（留空不修改）' : 'sk-...'}
                mode='password'
                onChange={handleFieldChange(KEYS.apiKey)}
                showClear
                /* mode='password' 会让浏览器把这里当登录密码框，进而把保存的账号密码
                   自动填充进来；管理员一点保存，密钥就被账号名覆盖，审核持续 401。
                   new-password 是让浏览器不要填入已存凭据的标准做法。 */
                autoComplete='new-password'
                name='prompt-audit-api-key'
                /* 部分密码管理器只认 data 属性，一并标注 */
                data-lpignore='true'
                data-1p-ignore='true'
                data-form-type='other'
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Select
                field={KEYS.disableThinking}
                label={t('关闭模型思考')}
                extraText={t('推理模型不关思考会把 token 耗在思考上，导致裁决 JSON 被截断')}
                style={{ width: '100%' }}
                onChange={handleFieldChange(KEYS.disableThinking)}
                optionList={[
                  { label: t('自动（按模型名识别推理模型）'), value: 'auto' },
                  { label: t('总是关闭'), value: 'always' },
                  { label: t('从不关闭'), value: 'never' },
                ]}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.threshold}
                label={t('拦截阈值')}
                extraText={t('置信度 ≥ 此值视为违规，建议 0.6')}
                min={0}
                max={1}
                step={0.05}
                onChange={handleFieldChange(KEYS.threshold)}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.timeoutMs}
                label={t('审核超时 (ms)')}
                extraText={t('拦截模式下这就是给用户增加的最大延迟')}
                min={500}
                max={60000}
                step={500}
                onChange={handleFieldChange(KEYS.timeoutMs)}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.maxInputChars}
                label={t('送审最大字符数')}
                extraText={t('超出部分截断，控制成本与延迟')}
                min={200}
                max={100000}
                step={500}
                onChange={handleFieldChange(KEYS.maxInputChars)}
              />
            </Col>
          </Row>
          <Space style={{ marginTop: 8 }} align='center' wrap>
            <Button onClick={onTest} loading={testing}>
              {t('测试审核节点')}
            </Button>
            {testResult && (
              <>
                <Tag color={testResult.healthy ? 'green' : 'red'} shape='circle'>
                  {testResult.healthy ? t('连通正常') : t('调用失败')}
                </Tag>
                <Text type='tertiary'>{testResult.latency_ms} ms</Text>
                {testResult.healthy && (
                  <Tag
                    color={testResult.would_block ? 'orange' : 'blue'}
                    shape='circle'
                  >
                    {t('置信度')} {Number(testResult.confidence).toFixed(2)}
                    {testResult.would_block ? ` · ${t('会拦截')}` : ''}
                  </Tag>
                )}
                {testResult.message && (
                  <Text type={testResult.healthy ? 'tertiary' : 'danger'}>
                    {testResult.message}
                  </Text>
                )}
              </>
            )}
          </Space>
          <div style={{ marginTop: 4 }}>
            <Text type='tertiary' size='small'>
              {t('测试会用一条内置的违规样例试跑，验证节点是否真能判出违规。')}
            </Text>
          </div>
          {testResult?.resolved_url && (
            <div style={{ marginTop: 4 }}>
              <Text type='tertiary' size='small'>
                {t('实际请求地址')}：<Text code>{testResult.resolved_url}</Text>
              </Text>
            </div>
          )}
        </Form.Section>

        <Form.Section text={t('备用审核节点')}>
          <Banner
            type={fallbackBannerType}
            description={fallbackDescription}
            style={{ marginBottom: 16 }}
          />
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.fallbackEnabled}
                label={t('启用备用节点')}
                extraText={t('主节点拿不到判定时自动改用备用节点复判')}
                onChange={handleFieldChange(KEYS.fallbackEnabled)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Input
                field={KEYS.fallbackModel}
                label={t('备用模型')}
                extraText={t('必填且需与主模型不同，否则回退无意义')}
                placeholder='deepseek-v4-flash'
                onChange={handleFieldChange(KEYS.fallbackModel)}
                disabled={!enabled || !fallbackEnabled}
                showClear
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Input
                field={KEYS.fallbackBaseUrl}
                label={t('备用接口地址')}
                extraText={t('留空则复用主节点地址')}
                placeholder='https://api.deepseek.com'
                onChange={handleFieldChange(KEYS.fallbackBaseUrl)}
                disabled={!enabled || !fallbackEnabled}
                showClear
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Input
                field={KEYS.fallbackApiKey}
                label={
                  <Space spacing={4}>
                    {t('备用 API Key')}
                    <Tag
                      color={fallbackKeySet ? 'green' : 'grey'}
                      shape='circle'
                    >
                      {fallbackKeySet ? t('已配置') : t('未配置')}
                    </Tag>
                  </Space>
                }
                extraText={t('留空则复用主节点密钥；不回显，留空保存不修改')}
                placeholder={
                  fallbackKeySet ? '••••••••（留空不修改）' : t('留空复用主节点')
                }
                mode='password'
                onChange={handleFieldChange(KEYS.fallbackApiKey)}
                disabled={!enabled || !fallbackEnabled}
                showClear
                /* 与主密钥同样防浏览器自动填充 */
                autoComplete='new-password'
                name='prompt-audit-fallback-api-key'
                data-lpignore='true'
                data-1p-ignore='true'
                data-form-type='other'
              />
            </Col>
          </Row>
          <Space style={{ marginTop: 8 }} align='center' wrap>
            <Button
              onClick={onTestFallback}
              loading={testingFallback}
              disabled={!fallbackEnabled}
            >
              {t('测试备用节点')}
            </Button>
            {fallbackTestResult && (
              <>
                <Tag
                  color={fallbackTestResult.healthy ? 'green' : 'red'}
                  shape='circle'
                >
                  {fallbackTestResult.healthy ? t('连通正常') : t('调用失败')}
                </Tag>
                <Text type='tertiary'>{fallbackTestResult.latency_ms} ms</Text>
                {fallbackTestResult.healthy && (
                  <Tag
                    color={fallbackTestResult.would_block ? 'orange' : 'blue'}
                    shape='circle'
                  >
                    {t('置信度')}{' '}
                    {Number(fallbackTestResult.confidence).toFixed(2)}
                    {fallbackTestResult.would_block ? ` · ${t('会拦截')}` : ''}
                  </Tag>
                )}
                {fallbackTestResult.message && (
                  <Text
                    type={fallbackTestResult.healthy ? 'tertiary' : 'danger'}
                  >
                    {fallbackTestResult.message}
                  </Text>
                )}
              </>
            )}
          </Space>
          {fallbackStats && (
            <div style={{ marginTop: 8 }}>
              <Text type='tertiary' size='small'>
                {t('本次启动以来')}：{t('回退')} {fallbackStats.total} {t('次')}
                {fallbackStats.moderation > 0 && (
                  <>
                    {' · '}
                    {t('其中上游风控拒答')} {fallbackStats.moderation} {t('次')}
                  </>
                )}
                {' · '}
                {t('成功救回')} {fallbackStats.recovered} {t('次')}
              </Text>
            </div>
          )}
        </Form.Section>

        <Form.Section text={t('自动封号')}>
          <Banner
            type={autoBanBannerType}
            description={autoBanDescription}
            style={{ marginBottom: 16 }}
          />
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.autoBanEnabled}
                label={t('启用自动封号')}
                extraText={t('窗口内多次被拦截的用户自动置为禁用')}
                onChange={handleFieldChange(KEYS.autoBanEnabled)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.autoBanDryRun}
                label={t('仅告警不封禁（干跑）')}
                extraText={t('达阈值只发邮件、不改用户状态，用于先验证阈值')}
                onChange={handleFieldChange(KEYS.autoBanDryRun)}
                disabled={!enabled || !autoBanEnabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.autoBanExemptAdmin}
                label={t('豁免管理员')}
                extraText={t('建议保持开启，避免把管理员自己锁在门外')}
                onChange={handleFieldChange(KEYS.autoBanExemptAdmin)}
                disabled={!enabled || !autoBanEnabled}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.autoBanThreshold}
                label={t('封号阈值（次）')}
                extraText={t('窗口内被拦截达到此次数即触发')}
                min={1}
                max={1000}
                onChange={handleFieldChange(KEYS.autoBanThreshold)}
                disabled={!enabled || !autoBanEnabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.autoBanWindowMin}
                label={t('统计窗口（分钟）')}
                extraText={t('滑动窗口，老用户历史上的偶发命中不会被清算')}
                min={1}
                max={100000}
                step={10}
                onChange={handleFieldChange(KEYS.autoBanWindowMin)}
                disabled={!enabled || !autoBanEnabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.autoBanMinConfidence}
                label={t('计数置信度门槛')}
                extraText={t('0 表示沿用拦截阈值；可调高只让确定无疑的命中计数')}
                min={0}
                max={1}
                step={0.05}
                onChange={handleFieldChange(KEYS.autoBanMinConfidence)}
                disabled={!enabled || !autoBanEnabled}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Input
                field={KEYS.autoBanExemptUsers}
                label={t('永不封禁的用户名')}
                extraText={t('逗号分隔，大小写不敏感。给大客户留后门，避免误封断服')}
                placeholder='vipuser, bigclient'
                onChange={handleFieldChange(KEYS.autoBanExemptUsers)}
                disabled={!enabled || !autoBanEnabled}
                showClear
              />
            </Col>
          </Row>
          {autoBanStats && (
            <div style={{ marginTop: 8 }}>
              <Text type='tertiary' size='small'>
                {t('本次启动以来')}：{t('实际封禁')} {autoBanStats.total}{' '}
                {t('人')}
                {autoBanStats.dryRunHit > 0 && (
                  <>
                    {' · '}
                    {t('干跑命中')} {autoBanStats.dryRunHit} {t('次')}
                  </>
                )}
              </Text>
            </div>
          )}
          <div style={{ marginTop: 4 }}>
            <Text type='tertiary' size='small'>
              {t(
                '计数只算「真被拦截且置信度达门槛」的命中：影子模式的命中、以及上游风控拒答（没有裁决）都不计入。',
              )}
            </Text>
          </div>
        </Form.Section>

        <Form.Section text={t('告警通知')}>
          <Banner
            type='info'
            description={notifyDescription}
            style={{ marginBottom: 16 }}
          />
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.notifyEnabled}
                label={t('命中时通知我')}
                extraText={t('命中违规即发告警，含用户、模型与提示词摘要')}
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                onChange={handleFieldChange(KEYS.notifyEnabled)}
                disabled={!enabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                field={KEYS.notifyBlockedOnly}
                label={t('仅拦截时通知')}
                extraText={t('开启后观察模式的命中不发通知，只有真被拦截才告警')}
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                onChange={handleFieldChange(KEYS.notifyBlockedOnly)}
                disabled={!enabled || !notifyEnabled}
              />
            </Col>
            <Col xs={24} md={16}>
              <Form.Input
                field={KEYS.notifyEmail}
                label={t('告警邮箱')}
                extraText={t(
                  '多个用逗号分隔。留空则按 root 用户在「个人设置」里配置的通知方式发送（邮件/Webhook/Bark/Gotify）',
                )}
                placeholder='you@example.com, ops@example.com'
                onChange={handleFieldChange(KEYS.notifyEmail)}
                disabled={!enabled || !notifyEnabled}
                showClear
                /* 同样防自动填充：这里曾被填成用户名，导致告警邮件发不出去 */
                autoComplete='off'
                name='prompt-audit-notify-email'
                data-lpignore='true'
                data-1p-ignore='true'
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.notifyThreshold}
                label={t('通知阈值')}
                extraText={t('0 表示与拦截阈值一致；调高可只对高危命中告警')}
                min={0}
                max={1}
                step={0.05}
                style={{ width: '100%' }}
                onChange={handleFieldChange(KEYS.notifyThreshold)}
                disabled={!enabled || !notifyEnabled}
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                field={KEYS.notifyCooldownSec}
                label={t('同一用户冷却 (秒)')}
                extraText={t('同个用户在此时间内只发一封，防止连续触发刷爆邮箱；0 不限制')}
                min={0}
                max={86400}
                step={60}
                style={{ width: '100%' }}
                onChange={handleFieldChange(KEYS.notifyCooldownSec)}
                disabled={!enabled || !notifyEnabled}
              />
            </Col>
          </Row>
          <Space style={{ marginTop: 8 }} align='center' wrap>
            <Button onClick={onTestNotify} loading={notifying}>
              {t('发送测试告警')}
            </Button>
            <Text type='tertiary' size='small'>
              {t('测试会忽略开关与冷却直接发一封样例告警，用于验证 SMTP 是否配好。')}
            </Text>
          </Space>
        </Form.Section>

        <Form.Section text={t('审核提示词')}>
          <Banner
            type='warning'
            description={t(
              '留空则使用内置提示词（专注 cyber abuse 判定，要求模型只输出 JSON 裁决）。自定义时务必保留「只输出 {"confidence": 0.00, "reason": "..."} JSON」的要求，否则无法解析裁决。',
            )}
            style={{ marginBottom: 16 }}
          />
          <Form.TextArea
            field={KEYS.systemPrompt}
            label={t('自定义审核提示词')}
            placeholder={t('留空使用内置提示词')}
            autosize={{ minRows: 6, maxRows: 20 }}
            onChange={handleFieldChange(KEYS.systemPrompt)}
          />
        </Form.Section>

        <Button type='primary' onClick={onSubmit} loading={loading}>
          {t('保存')}
        </Button>
      </Form>
    </Spin>
  );
}
