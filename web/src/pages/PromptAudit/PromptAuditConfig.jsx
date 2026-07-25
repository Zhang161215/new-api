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
  });
  const [inputsRow, setInputsRow] = useState(inputs);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [groupOptions, setGroupOptions] = useState([]);
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

  // API Key 按站点约定不会下发前端，只能查询「是否已配置」
  useEffect(() => {
    API.get('/api/prompt_audit/config')
      .then((res) => {
        if (res.data.success) setApiKeySet(!!res.data.data.api_key_set);
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

  function onSubmit() {
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

  // 逗号字符串 → 数组，供多选 Select 使用
  const groupValue = String(inputs[KEYS.groups] || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  const enabled = String(inputs[KEYS.enabled]) === 'true';
  const blocking = String(inputs[KEYS.blocking]) === 'true';
  const recordAll = String(inputs[KEYS.recordAll]) === 'true';
  const rate = Number(inputs[KEYS.sampleRate]) || 100;

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
              />
            </Col>
          </Row>
          <Row gutter={16}>
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
