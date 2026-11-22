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

import React, { useEffect, useState, useRef } from 'react';
import { Button, Col, Form, Row, Spin, Typography } from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
} from '../../../helpers';
import { getQuotaPerUnit } from '../../../helpers/render';
import { useTranslation } from 'react-i18next';

// 后端存的是 quota，界面按金额展示与输入，这两个 key 需要来回换算。
const AMOUNT_FIELDS = ['checkin_setting.min_quota', 'checkin_setting.max_quota'];
// 多选星期，值是数组，不能走 Number() 转换，也不能用 !== 直接比较。
const WEEKDAYS_FIELD = 'checkin_setting.double_weekdays';

// getQuotaPerUnit() 在 localStorage 没写过时返回 NaN，直接拿来做除法会把
// 输入框变成 NaN、保存时把配置写坏。这里兜底成后端默认值 500000。
function safeQuotaPerUnit() {
  const v = getQuotaPerUnit();
  return Number.isFinite(v) && v > 0 ? v : 500000;
}

// 序列化用于比较：数组按值比而非按引用，否则每次保存都会认为星期被改过，
// 「你似乎并没有修改什么」的提示就永远不出现了。
function normalizeForCompare(obj) {
  const out = { ...obj };
  if (Array.isArray(out[WEEKDAYS_FIELD])) {
    out[WEEKDAYS_FIELD] = JSON.stringify([...out[WEEKDAYS_FIELD]].sort());
  }
  return out;
}

export default function SettingsCheckin(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    'checkin_setting.enabled': false,
    // 这两个以「金额」为单位存在 state 里，提交时才乘回 quota
    'checkin_setting.min_quota': 0.002,
    'checkin_setting.max_quota': 0.02,
    'checkin_setting.min_topup_amount': 0,
    [WEEKDAYS_FIELD]: [],
    'checkin_setting.double_multiplier': 2,
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

  const weekdayOptions = [
    { label: t('周日'), value: 0 },
    { label: t('周一'), value: 1 },
    { label: t('周二'), value: 2 },
    { label: t('周三'), value: 3 },
    { label: t('周四'), value: 4 },
    { label: t('周五'), value: 5 },
    { label: t('周六'), value: 6 },
  ];

  function handleFieldChange(fieldName) {
    return (value) => {
      setInputs((inputs) => ({ ...inputs, [fieldName]: value }));
    };
  }

  function onSubmit() {
    const updateArray = compareObjects(
      normalizeForCompare(inputs),
      normalizeForCompare(inputsRow),
    );
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const perUnit = safeQuotaPerUnit();
    const requestQueue = updateArray.map((item) => {
      let value = '';
      if (item.key === WEEKDAYS_FIELD) {
        // 后端字段是 []int，配置层用 JSON 反序列化
        const arr = Array.isArray(inputs[item.key]) ? inputs[item.key] : [];
        value = JSON.stringify(arr.map(Number).sort());
      } else if (AMOUNT_FIELDS.includes(item.key)) {
        // 金额 → quota。必须取整：0.5 * 500000 这类浮点运算可能算出
        // 250000.00000000003，写进 int 字段会带上一串小数
        value = String(Math.round(Number(inputs[item.key]) * perUnit));
      } else {
        value = String(inputs[item.key]);
      }
      return API.put('/api/option/', {
        key: item.key,
        value,
      });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (requestQueue.length === 1) {
          if (res.includes(undefined)) return;
        } else if (requestQueue.length > 1) {
          if (res.includes(undefined))
            return showError(t('部分保存失败，请重试'));
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => {
        showError(t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    const perUnit = safeQuotaPerUnit();
    const currentInputs = {};
    for (let key in props.options) {
      if (!Object.keys(inputs).includes(key)) continue;
      if (typeof inputs[key] === 'boolean') {
        currentInputs[key] = props.options[key];
      } else if (key === WEEKDAYS_FIELD) {
        // 后端下发的是 JSON 字符串（如 "[0,1]"）。这里绝不能走 Number()，
        // 那会得到 NaN 让多选框空白，保存时再把配置写坏。
        let arr = [];
        try {
          const parsed = JSON.parse(props.options[key] || '[]');
          if (Array.isArray(parsed)) {
            arr = parsed.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
          }
        } catch (e) {
          arr = [];
        }
        currentInputs[key] = arr;
      } else if (AMOUNT_FIELDS.includes(key)) {
        // quota → 金额展示
        currentInputs[key] = Number(props.options[key]) / perUnit;
      } else {
        // 数值类字段确保转为 number，避免字符串比较问题
        currentInputs[key] = Number(props.options[key]);
      }
    }
    // 后端从未写过的 key 不会出现在 props.options 里，补上默认值，
    // 否则 Form 绑定到 undefined，控件变成非受控组件
    if (currentInputs[WEEKDAYS_FIELD] === undefined) {
      currentInputs[WEEKDAYS_FIELD] = [];
    }
    if (currentInputs['checkin_setting.double_multiplier'] === undefined) {
      currentInputs['checkin_setting.double_multiplier'] = 2;
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current.setValues(currentInputs);
  }, [props.options]);

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('签到设置')}>
            <Typography.Text
              type='tertiary'
              style={{ marginBottom: 16, display: 'block' }}
            >
              {t('签到功能允许用户每日签到获取随机额度奖励')}
            </Typography.Text>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'checkin_setting.enabled'}
                  label={t('启用签到功能')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={handleFieldChange('checkin_setting.enabled')}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'checkin_setting.min_quota'}
                  label={t('签到最小金额')}
                  placeholder={t('签到奖励的最小金额')}
                  onChange={handleFieldChange('checkin_setting.min_quota')}
                  min={0}
                  step={0.01}
                  precision={4}
                  prefix={'$'}
                  disabled={!inputs['checkin_setting.enabled']}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'checkin_setting.max_quota'}
                  label={t('签到最大金额')}
                  placeholder={t('签到奖励的最大金额')}
                  onChange={handleFieldChange('checkin_setting.max_quota')}
                  min={0}
                  step={0.01}
                  precision={4}
                  prefix={'$'}
                  disabled={!inputs['checkin_setting.enabled']}
                  extraText={t('按美元填写，系统会自动换算为额度')}
                />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 12 }}>
              <Col xs={24} sm={24} md={16} lg={16} xl={16}>
                <Form.Select
                  field={WEEKDAYS_FIELD}
                  label={t('额度翻倍的星期')}
                  placeholder={t('不选则不开启翻倍')}
                  multiple
                  optionList={weekdayOptions}
                  onChange={handleFieldChange(WEEKDAYS_FIELD)}
                  disabled={!inputs['checkin_setting.enabled']}
                  style={{ width: '100%' }}
                  extraText={t(
                    '选中的星期签到额度按下方倍数放大，按服务器时区（Asia/Shanghai）判断',
                  )}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'checkin_setting.double_multiplier'}
                  label={t('翻倍倍数')}
                  placeholder={t('如 2 表示双倍')}
                  onChange={handleFieldChange(
                    'checkin_setting.double_multiplier',
                  )}
                  min={1}
                  step={0.5}
                  disabled={!inputs['checkin_setting.enabled']}
                  extraText={t('填 1 表示不翻倍')}
                />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 12 }}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'checkin_setting.min_topup_amount'}
                  label={t('签到最低充值金额')}
                  placeholder={t('设为 0 表示不限制')}
                  onChange={handleFieldChange(
                    'checkin_setting.min_topup_amount',
                  )}
                  min={0}
                  step={0.01}
                  disabled={!inputs['checkin_setting.enabled']}
                  extraText={t(
                    '用户累计充值金额低于此值时无法签到，设为 0 表示不限制',
                  )}
                />
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存签到设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
