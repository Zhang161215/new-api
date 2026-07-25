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

import React, { useCallback, useEffect, useState } from 'react';
import { Card, Layout, Spin, TabPane, Tabs } from '@douyinfe/semi-ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, SlidersHorizontal } from 'lucide-react';
import PromptAuditConfig from './PromptAuditConfig';
import PromptAuditLogs from './PromptAuditLogs';
import { API, showError, toBoolean } from '../../helpers';

const PROMPT_AUDIT_BOOLEAN_KEYS = [
  'prompt_audit_setting.enabled',
  'prompt_audit_setting.blocking',
  'prompt_audit_setting.fail_open',
  'prompt_audit_setting.record_all',
];

const TAB_CONFIG = 'config';
const TAB_LOGS = 'logs';

const PromptAuditPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [inputs, setInputs] = useState({});
  const [loading, setLoading] = useState(false);
  const [tabActiveKey, setTabActiveKey] = useState(TAB_CONFIG);

  const getOptions = useCallback(async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (success) {
      const newInputs = {};
      data.forEach((item) => {
        if (!item.key.startsWith('prompt_audit_setting.')) return;
        newInputs[item.key] = PROMPT_AUDIT_BOOLEAN_KEYS.includes(item.key)
          ? toBoolean(item.value)
          : item.value;
      });
      setInputs(newInputs);
    } else {
      showError(message);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    try {
      setLoading(true);
      await getOptions();
    } catch (error) {
      showError(t('刷新失败'));
    } finally {
      setLoading(false);
    }
  }, [getOptions, t]);

  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  // tab 状态同步到 URL，便于直接分享/收藏某个 tab
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    setTabActiveKey(tab === TAB_LOGS ? TAB_LOGS : TAB_CONFIG);
  }, [location.search]);

  const onChangeTab = (key) => {
    setTabActiveKey(key);
    navigate(`?tab=${key}`, { replace: true });
  };

  const tabLabel = (Icon, text) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <Icon size={18} />
      {text}
    </span>
  );

  return (
    <div className='mt-[60px] px-2'>
      <Layout>
        <Layout.Content>
          <Tabs type='card' activeKey={tabActiveKey} onChange={onChangeTab}>
            <TabPane
              itemKey={TAB_CONFIG}
              tab={tabLabel(SlidersHorizontal, t('审核设置'))}
            >
              {tabActiveKey === TAB_CONFIG && (
                <Spin spinning={loading} size='large'>
                  <Card style={{ marginTop: '10px' }}>
                    <PromptAuditConfig options={inputs} refresh={onRefresh} />
                  </Card>
                </Spin>
              )}
            </TabPane>
            <TabPane
              itemKey={TAB_LOGS}
              tab={tabLabel(ClipboardList, t('审核记录'))}
            >
              {tabActiveKey === TAB_LOGS && <PromptAuditLogs />}
            </TabPane>
          </Tabs>
        </Layout.Content>
      </Layout>
    </div>
  );
};

export default PromptAuditPage;
