/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  toBoolean,
} from '../../../helpers';

export default function SettingsAffiliateRebate(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    AffiliateRebateEnabled: true,
    AffiliateRebatePercent: 5,
    AffiliateRebateMinThresholdUSD: 2,
    AffiliateRebateBonusUSD: 2,
    AffiliateRebateDelayDays: 3,
    AffiliateRebateExtraRules: '',
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) => {
      let value = '';
      if (typeof inputs[item.key] === 'boolean') {
        value = String(inputs[item.key]);
      } else {
        value = String(inputs[item.key]);
      }
      return API.put('/api/option/', { key: item.key, value });
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
    const currentInputs = {};
    for (let key in props.options) {
      if (Object.keys(inputs).includes(key)) {
        let v = props.options[key];
        if (typeof inputs[key] === 'boolean') v = toBoolean(v);
        else if (typeof inputs[key] === 'number') v = Number(v);
        currentInputs[key] = v;
      }
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current?.setValues(currentInputs);
  }, [props.options]);

  return (
    <Spin spinning={loading}>
      <Form
        values={inputs}
        getFormApi={(formAPI) => (refForm.current = formAPI)}
        style={{ marginBottom: 15 }}
      >
        <Form.Section text={t('邀请返利')}>
          <Row>
            <Col xs={24} sm={12} md={8}>
              <Form.Switch
                label={t('启用邀请充值返利')}
                field={'AffiliateRebateEnabled'}
                onChange={(value) =>
                  setInputs({ ...inputs, AffiliateRebateEnabled: value })
                }
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                label={t('返利百分比')}
                field={'AffiliateRebatePercent'}
                step={0.1}
                min={0}
                max={100}
                suffix={'%'}
                onChange={(value) =>
                  setInputs({ ...inputs, AffiliateRebatePercent: value })
                }
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                label={t('保底阈值')}
                field={'AffiliateRebateMinThresholdUSD'}
                step={0.1}
                min={0}
                suffix={'USD'}
                onChange={(value) =>
                  setInputs({
                    ...inputs,
                    AffiliateRebateMinThresholdUSD: value,
                  })
                }
              />
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                label={t('额外奖励')}
                field={'AffiliateRebateBonusUSD'}
                step={0.1}
                min={0}
                suffix={'USD'}
                onChange={(value) =>
                  setInputs({ ...inputs, AffiliateRebateBonusUSD: value })
                }
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.InputNumber
                label={t('到账延迟（天）')}
                field={'AffiliateRebateDelayDays'}
                step={1}
                min={0}
                onChange={(value) =>
                  setInputs({ ...inputs, AffiliateRebateDelayDays: value })
                }
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={24} md={16}>
              <Form.TextArea
                label={t('自定义规则补充说明')}
                field={'AffiliateRebateExtraRules'}
                extraText={t(
                  '每行一条，将追加显示在用户钱包页「活动规则」卡片末尾。留空则不显示补充说明',
                )}
                placeholder={t(
                  '例如：\n本活动最终解释权归本平台所有\n严禁刷邀请等作弊行为，违规者将取消所有奖励',
                )}
                autosize={{ minRows: 3, maxRows: 8 }}
                onChange={(value) =>
                  setInputs({ ...inputs, AffiliateRebateExtraRules: value })
                }
              />
            </Col>
          </Row>
          <Row>
            <Button size='default' onClick={onSubmit}>
              {t('保存')}
            </Button>
          </Row>
        </Form.Section>
      </Form>
    </Spin>
  );
}
