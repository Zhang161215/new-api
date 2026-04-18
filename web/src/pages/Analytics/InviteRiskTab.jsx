import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Select, Button, Tag, Space, Typography, Toast } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API } from '../../helpers';

const { Text } = Typography;

const LIMIT_OPTIONS = [
  { value: 20, label: '前20名' },
  { value: 50, label: '前50名' },
  { value: 100, label: '前100名' },
];

const tagStyle = {
  fontWeight: 500,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  padding: 13,
};

const riskColor = (score) => {
  if (score >= 75) return 'red';
  if (score >= 50) return 'orange';
  if (score >= 30) return 'yellow';
  return 'green';
};

const formatPercent = (value) => `${(Number(value || 0) * 100).toFixed(0)}%`;

const InviteRiskTab = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(50);
  const [testResult, setTestResult] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/analytics/invite-risk?limit=${limit}`);
      if (res.data.success) {
        setData(res.data.data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const runSelfTest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/analytics/invite-risk?limit=20');
      if (res.data.success) {
        const items = res.data.data.items || [];
        const hasRequiredFields = items.every((item) =>
          [
            'user_id',
            'username',
            'invited_total',
            'paid_total',
            'suspicious_total',
            'same_ip_total',
            'conversion_rate',
            'risk_score',
          ].every((key) => Object.prototype.hasOwnProperty.call(item, key)),
        );

        const validConversion = items.every(
          (item) => Number(item.conversion_rate || 0) >= 0 && Number(item.conversion_rate || 0) <= 1,
        );

        const validRisk = items.every(
          (item) => Number(item.risk_score || 0) >= 0 && Number(item.risk_score || 0) <= 100,
        );

        const result = {
          total: items.length,
          hasRequiredFields,
          validConversion,
          validRisk,
          passed: hasRequiredFields && validConversion && validRisk,
        };
        setTestResult(result);
        Toast.success(result.passed ? '邀请风控榜接口自测通过' : '邀请风控榜接口自测发现异常');
      } else {
        setTestResult({ passed: false, error: res.data.message || '接口返回失败' });
        Toast.error('邀请风控榜接口自测失败');
      }
    } catch (e) {
      setTestResult({ passed: false, error: e.message || '请求失败' });
      Toast.error('邀请风控榜接口自测失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const invitedTotal = data.reduce((sum, item) => sum + (item.invited_total || 0), 0);
    const paidTotal = data.reduce((sum, item) => sum + (item.paid_total || 0), 0);
    const suspiciousTotal = data.reduce((sum, item) => sum + (item.suspicious_total || 0), 0);
    return { invitedTotal, paidTotal, suspiciousTotal };
  }, [data]);

  const columns = [
    {
      title: '#',
      dataIndex: 'rank',
      width: 60,
      render: (_, __, index) => (
        <Tag color={index < 3 ? ['red', 'orange', 'yellow'][index] : 'grey'} shape='circle' size='small'>
          {index + 1}
        </Tag>
      ),
    },
    {
      title: '邀请人',
      dataIndex: 'username',
      width: 160,
      render: (text, record) => (
        <div className='flex flex-col'>
          <Text strong>{text}</Text>
          <Text type='tertiary' size='small'>
            ID: {record.user_id} / {record.group || 'default'}
          </Text>
        </div>
      ),
    },
    {
      title: '邀请总数',
      dataIndex: 'invited_total',
      width: 100,
      render: (val) => <Tag color='blue' shape='circle' size='small'>{val}</Tag>,
      sorter: (a, b) => a.invited_total - b.invited_total,
    },
    {
      title: '已付费',
      dataIndex: 'paid_total',
      width: 100,
      render: (val) => <Tag color='green' shape='circle' size='small'>{val}</Tag>,
      sorter: (a, b) => a.paid_total - b.paid_total,
    },
    {
      title: '转化率',
      dataIndex: 'conversion_rate',
      width: 100,
      render: (val) => <Text strong>{formatPercent(val)}</Text>,
      sorter: (a, b) => a.conversion_rate - b.conversion_rate,
    },
    {
      title: '同IP数',
      dataIndex: 'same_ip_total',
      width: 100,
      render: (val) => <Tag color={val > 0 ? 'red' : 'grey'} shape='circle' size='small'>{val}</Tag>,
      sorter: (a, b) => a.same_ip_total - b.same_ip_total,
    },
    {
      title: '可疑数',
      dataIndex: 'suspicious_total',
      width: 100,
      render: (val) => <Tag color={val > 0 ? 'orange' : 'green'} shape='circle' size='small'>{val}</Tag>,
      sorter: (a, b) => a.suspicious_total - b.suspicious_total,
    },
    {
      title: '风险分',
      dataIndex: 'risk_score',
      width: 100,
      render: (val) => <Tag color={riskColor(val)} shape='circle' size='small'>{val}</Tag>,
      sorter: (a, b) => a.risk_score - b.risk_score,
    },
    {
      title: '最近拉新',
      dataIndex: 'latest_invite_time',
      width: 180,
      render: (val) => (val ? new Date(val * 1000).toLocaleString() : '-'),
      sorter: (a, b) => a.latest_invite_time - b.latest_invite_time,
    },
  ];

  return (
    <div style={{ padding: '16px 0' }}>
      <div className='flex flex-col md:flex-row justify-between items-start md:items-center gap-2 w-full mb-4'>
        <Space>
          <Tag color='blue' style={tagStyle} className='!rounded-lg'>
            邀请总人数: {stats.invitedTotal}
          </Tag>
          <Tag color='green' style={tagStyle} className='!rounded-lg'>
            已付费人数: {stats.paidTotal}
          </Tag>
          <Tag color='orange' style={tagStyle} className='!rounded-lg'>
            可疑邀请: {stats.suspiciousTotal}
          </Tag>
        </Space>
        <Space>
          <Select
            value={limit}
            onChange={setLimit}
            optionList={LIMIT_OPTIONS}
            style={{ width: 120 }}
            size='small'
          />
          <Button
            icon={<IconRefresh />}
            onClick={loadData}
            loading={loading}
            size='small'
            theme='light'
          />
          <Button
            onClick={runSelfTest}
            loading={loading}
            size='small'
            theme='solid'
            type='primary'
          >
            运行自测
          </Button>
        </Space>
      </div>

      {testResult && (
        <div className='mb-4'>
          <Space wrap>
            <Tag color={testResult.passed ? 'green' : 'red'} shape='circle'>
              {testResult.passed ? '自测通过' : '自测失败'}
            </Tag>
            <Tag color='blue' shape='circle'>样本数: {testResult.total || 0}</Tag>
            {'hasRequiredFields' in testResult && (
              <Tag color={testResult.hasRequiredFields ? 'green' : 'red'} shape='circle'>
                字段完整: {testResult.hasRequiredFields ? '是' : '否'}
              </Tag>
            )}
            {'validConversion' in testResult && (
              <Tag color={testResult.validConversion ? 'green' : 'red'} shape='circle'>
                转化率合法: {testResult.validConversion ? '是' : '否'}
              </Tag>
            )}
            {'validRisk' in testResult && (
              <Tag color={testResult.validRisk ? 'green' : 'red'} shape='circle'>
                风险分合法: {testResult.validRisk ? '是' : '否'}
              </Tag>
            )}
            {testResult.error && (
              <Tag color='red' shape='circle'>错误: {testResult.error}</Tag>
            )}
          </Space>
        </div>
      )}

      <Table
        dataSource={data}
        columns={columns}
        rowKey='user_id'
        loading={loading}
        pagination={false}
        size='small'
      />
    </div>
  );
};

export default InviteRiskTab;
