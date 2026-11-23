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

// 本站：上游 rc.51 下线了旧屏蔽词检查（CheckSensitiveEnabled / SensitiveWords 等 option），
// 首次启动把词表迁到「请求过滤」插件实例（request-filter），旧 option 删除。
// 这里不能再写旧 option（写回去下次启动会再迁一份重复实例），改成只读展示迁移后的实例。
// 实例的开关/词表编辑在新版界面「请求插件」里；classic 暂不提供编辑。

import React, { useEffect, useState } from 'react';
import { Banner, Empty, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { API, showError } from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

function keywordCount(config) {
  const keywords =
    config && typeof config.keywords === 'string' ? config.keywords : '';
  return keywords
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

export default function SettingsSensitiveWords() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get('/api/request_plugin/instances');
        const { success, message, data } = res.data;
        if (!success) {
          showError(message);
          return;
        }
        const list = (data?.instances || []).filter(
          (item) => item.plugin === 'request-filter',
        );
        if (!cancelled) setInstances(list);
      } catch (e) {
        // 拦截器已提示
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = [
    { title: t('名称'), dataIndex: 'name' },
    {
      title: t('状态'),
      dataIndex: 'enabled',
      render: (enabled) =>
        enabled ? (
          <Tag color='green'>{t('已启用')}</Tag>
        ) : (
          <Tag color='grey'>{t('已禁用')}</Tag>
        ),
    },
    {
      title: t('范围'),
      dataIndex: 'global',
      render: (global, record) =>
        global
          ? t('全局')
          : [...(record.groups || []), ...(record.models || [])].join(', ') ||
            '-',
    },
    {
      title: t('屏蔽词数量'),
      dataIndex: 'config',
      render: (config) => (config ? keywordCount(config) : '-'),
    },
  ];

  return (
    <Spin spinning={loading}>
      <Typography.Title heading={6} style={{ marginBottom: 12 }}>
        {t('屏蔽词过滤设置')}
      </Typography.Title>
      <Banner
        type='info'
        closeIcon={null}
        style={{ marginBottom: 12 }}
        description={
          <Text>
            {t(
              '屏蔽词检查已改为「请求过滤」插件，原有词表已自动迁移到下方实例（原来未开启提示词检查的，迁移后保持禁用）。开关与词表请在新版界面的请求插件中管理。',
            )}
          </Text>
        }
      />
      {instances.length > 0 ? (
        <Table
          columns={columns}
          dataSource={instances}
          rowKey='id'
          pagination={false}
          size='small'
        />
      ) : (
        !loading && <Empty description={t('暂无请求过滤实例')} />
      )}
    </Spin>
  );
}
