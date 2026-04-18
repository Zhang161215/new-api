import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table,
  Select,
  Button,
  Tag,
  Space,
  Typography,
  Popover,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API, renderQuota } from '../../helpers';

const { Text } = Typography;

const tagStyle = {
  fontWeight: 500,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  padding: 13,
};

const SORT_OPTIONS = [
  { value: 'quota', label: '按额度' },
  { value: 'tokens', label: '按Token' },
  { value: 'requests', label: '按请求数' },
  { value: 'ips', label: '按IP数' },
];

const DAY_OPTIONS = [
  { value: 1, label: '今天' },
  { value: 3, label: '最近3天' },
  { value: 7, label: '最近7天' },
  { value: 14, label: '最近14天' },
  { value: 30, label: '最近30天' },
];

const formatTokens = (tokens) => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
};

const IPPopoverContent = ({ ips }) => {
  if (!ips || ips.length === 0) return <Text type='tertiary'>无IP记录</Text>;
  return (
    <div style={{ maxHeight: 300, overflow: 'auto', minWidth: 320 }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
            <th style={{ padding: '4px 8px', textAlign: 'left' }}>IP</th>
            <th style={{ padding: '4px 8px', textAlign: 'right' }}>请求数</th>
            <th style={{ padding: '4px 8px', textAlign: 'right' }}>最后出现</th>
          </tr>
        </thead>
        <tbody>
          {ips.map((ip) => (
            <tr key={ip.ip} style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
              <td style={{ padding: '4px 8px' }}>
                <Tag color='orange' shape='circle' size='small'>{ip.ip}</Tag>
              </td>
              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{ip.request_count}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--semi-color-text-2)' }}>
                {new Date(ip.last_seen * 1000).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TopTokensTab = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [sort, setSort] = useState('quota');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(
        `/api/analytics/top-tokens?days=${days}&sort=${sort}&limit=50`
      );
      if (res.data.success) {
        setData(res.data.data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [days, sort]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const totalQuota = data.reduce((s, r) => s + r.total_quota, 0);
    const totalRequests = data.reduce((s, r) => s + r.request_count, 0);
    return { totalQuota, totalRequests };
  }, [data]);

  const columns = [
    {
      title: '#',
      dataIndex: '_index',
      width: 50,
      render: (_, __, index) => {
        const colors = ['red', 'orange', 'yellow'];
        return index < 3 ? (
          <Tag color={colors[index]} shape='circle' size='small' style={{ fontWeight: 700 }}>
            {index + 1}
          </Tag>
        ) : (
          <Text type='tertiary'>{index + 1}</Text>
        );
      },
    },
    {
      title: '令牌名称',
      dataIndex: 'token_name',
      width: 180,
      render: (text) => (
        <Tag color='grey' shape='circle' size='small'>{text}</Tag>
      ),
    },
    {
      title: '用户',
      dataIndex: 'username',
      width: 120,
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: '请求数',
      dataIndex: 'request_count',
      width: 100,
      sorter: (a, b) => a.request_count - b.request_count,
      render: (val) => (
        <Tag color='cyan' shape='circle' size='small'>{val.toLocaleString()}</Tag>
      ),
    },
    {
      title: 'Token用量',
      dataIndex: 'total_tokens',
      width: 120,
      sorter: (a, b) => a.total_tokens - b.total_tokens,
      render: (val) => (
        <Tag color='teal' shape='circle' size='small'>{formatTokens(val)}</Tag>
      ),
    },
    {
      title: '消耗额度',
      dataIndex: 'total_quota',
      width: 130,
      sorter: (a, b) => a.total_quota - b.total_quota,
      render: (val) => (
        <Text strong style={{ color: 'var(--semi-color-warning)' }}>
          {renderQuota(val)}
        </Text>
      ),
    },
    {
      title: 'IP数',
      dataIndex: 'ips',
      width: 80,
      sorter: (a, b) => (a.ips?.length || 0) - (b.ips?.length || 0),
      render: (ips) => {
        const count = ips?.length || 0;
        if (count === 0) return <Text type='tertiary'>-</Text>;
        const color = count > 10 ? 'red' : count > 5 ? 'orange' : 'green';
        return (
          <Popover
            content={<IPPopoverContent ips={ips} />}
            position='leftTop'
            showArrow
            trigger='click'
          >
            <Tag color={color} shape='circle' size='small' style={{ cursor: 'pointer' }}>
              {count}
            </Tag>
          </Popover>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '16px 0' }}>
      <div className='flex flex-col md:flex-row justify-between items-start md:items-center gap-2 w-full mb-4'>
        <Space>
          <Tag color='blue' style={tagStyle} className='!rounded-lg'>
            总额度: {renderQuota(stats.totalQuota)}
          </Tag>
          <Tag color='pink' style={tagStyle} className='!rounded-lg'>
            总请求: {stats.totalRequests.toLocaleString()}
          </Tag>
          <Tag
            color='white'
            style={{ ...tagStyle, border: 'none' }}
            className='!rounded-lg'
          >
            令牌数: {data.length}
          </Tag>
        </Space>
        <Space>
          <Select
            value={days}
            onChange={setDays}
            optionList={DAY_OPTIONS}
            style={{ width: 120 }}
            size='small'
          />
          <Select
            value={sort}
            onChange={setSort}
            optionList={SORT_OPTIONS}
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
        </Space>
      </div>

      <Table
        dataSource={data}
        columns={columns}
        rowKey={(record) => `${record.token_id}-${record.user_id}`}
        loading={loading}
        pagination={false}
        size='small'
      />
    </div>
  );
};

export default TopTokensTab;
