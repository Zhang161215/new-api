import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Select,
  Button,
  Tag,
  Space,
  Typography,
  Avatar,
  Progress,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API, renderQuota } from '../../helpers';

const { Text } = Typography;

const tagStyle = {
  fontWeight: 500,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  padding: 13,
};

const DAY_OPTIONS = [
  { value: 3, label: '最近3天' },
  { value: 7, label: '最近7天' },
  { value: 14, label: '最近14天' },
  { value: 30, label: '最近30天' },
];

const RISK_CONFIG = {
  extreme: { color: 'red', label: '极高', stroke: '#f5222d' },
  high: { color: 'orange', label: '高', stroke: '#fa8c16' },
  medium: { color: 'yellow', label: '中', stroke: '#fadb14' },
  low: { color: 'green', label: '低', stroke: '#52c41a' },
};

const GROUP_COLORS = {
  default: 'blue',
  vip: 'purple',
  GPT_Month: 'green',
  'Claude Code专用': 'orange',
};

const stringToColor = (str) => {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['amber', 'blue', 'cyan', 'green', 'indigo', 'lime', 'orange', 'pink', 'purple', 'red', 'teal', 'violet'];
  return colors[Math.abs(hash) % colors.length];
};

const SharingRiskTab = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);
  const [ipDetails, setIpDetails] = useState({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(
        `/api/analytics/sharing-risk?days=${days}`
      );
      if (res.data.success) {
        setData(res.data.data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadUserIPs = async (userId) => {
    if (ipDetails[userId]) return;
    try {
      const res = await API.get(
        `/api/analytics/user/${userId}/ips?days=${days}`
      );
      if (res.data.success) {
        setIpDetails((prev) => ({
          ...prev,
          [userId]: res.data.data.items || [],
        }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleExpand = (expanded, record) => {
    if (expanded) {
      setExpandedRowKeys([...expandedRowKeys, record.user_id]);
      loadUserIPs(record.user_id);
    } else {
      setExpandedRowKeys(expandedRowKeys.filter((k) => k !== record.user_id));
    }
  };

  // Count by risk level
  const riskCounts = data.reduce(
    (acc, item) => {
      acc[item.risk_level] = (acc[item.risk_level] || 0) + 1;
      return acc;
    },
    {}
  );

  const columns = [
    {
      title: '风险',
      dataIndex: 'risk_level',
      width: 90,
      render: (level) => {
        const cfg = RISK_CONFIG[level] || RISK_CONFIG.low;
        return (
          <Tag color={cfg.color} size='small' style={{ fontWeight: 600 }}>
            {cfg.label}
          </Tag>
        );
      },
      sorter: (a, b) => a.risk_score - b.risk_score,
    },
    {
      title: '评分',
      dataIndex: 'risk_score',
      width: 100,
      sorter: (a, b) => a.risk_score - b.risk_score,
      render: (val) => {
        const cfg = val >= 70 ? RISK_CONFIG.extreme : val >= 45 ? RISK_CONFIG.high : val >= 25 ? RISK_CONFIG.medium : RISK_CONFIG.low;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress
              percent={val}
              size='small'
              style={{ width: 50 }}
              stroke={cfg.stroke}
              showInfo={false}
            />
            <Text strong style={{ color: cfg.stroke, fontSize: 13 }}>
              {val}
            </Text>
          </div>
        );
      },
    },
    {
      title: '用户',
      dataIndex: 'username',
      width: 140,
      render: (text) => (
        <Space>
          <Avatar size='extra-small' color={stringToColor(text)} style={{ fontSize: 12 }}>
            {(text || '?')[0].toUpperCase()}
          </Avatar>
          <Text strong>{text}</Text>
        </Space>
      ),
    },
    {
      title: '分组',
      dataIndex: 'group',
      width: 110,
      render: (text) => (
        <Tag
          color={GROUP_COLORS[text] || 'grey'}
          shape='circle'
          size='small'
        >
          {text || 'default'}
        </Tag>
      ),
    },
    {
      title: 'IP数',
      dataIndex: 'ip_count',
      width: 80,
      render: (val) => (
        <Tag
          color={val > 10 ? 'red' : val > 5 ? 'orange' : 'green'}
          shape='circle'
          size='small'
        >
          {val}
        </Tag>
      ),
    },
    {
      title: '网段数',
      dataIndex: 'subnet_count',
      width: 80,
      render: (val) => (
        <Tag color='violet' shape='circle' size='small'>
          {val}
        </Tag>
      ),
    },
    {
      title: '并发窗口',
      dataIndex: 'concurrent_count',
      width: 100,
      render: (val) => (
        <Tag
          color={val > 5 ? 'red' : val > 2 ? 'orange' : 'lime'}
          shape='circle'
          size='small'
        >
          {val}
        </Tag>
      ),
    },
    {
      title: '请求数',
      dataIndex: 'request_count',
      width: 100,
      render: (val) => (
        <Tag color='cyan' shape='circle' size='small'>
          {val.toLocaleString()}
        </Tag>
      ),
    },
    {
      title: '消耗额度',
      dataIndex: 'total_quota',
      width: 130,
      render: (val) => (
        <Text strong style={{ color: 'var(--semi-color-warning)' }}>
          {renderQuota(val)}
        </Text>
      ),
    },
  ];

  const expandedRowRender = (record) => {
    const ips = ipDetails[record.user_id];
    if (!ips) return <Text type='tertiary'>加载中...</Text>;
    if (ips.length === 0) return <Text type='tertiary'>无IP记录</Text>;

    return (
      <div style={{ padding: '8px 16px' }}>
        <Table
          size='small'
          dataSource={ips}
          rowKey='ip'
          pagination={false}
          columns={[
            {
              title: 'IP',
              dataIndex: 'ip',
              width: 160,
              render: (val) => (
                <Tag color='orange' shape='circle' size='small'>
                  {val}
                </Tag>
              ),
            },
            {
              title: '请求数',
              dataIndex: 'request_count',
              width: 100,
              render: (val) => (
                <Tag color='cyan' shape='circle' size='small'>
                  {val}
                </Tag>
              ),
            },
            {
              title: '首次出现',
              dataIndex: 'first_seen',
              width: 180,
              render: (val) => (
                <Text type='tertiary' size='small'>
                  {new Date(val * 1000).toLocaleString()}
                </Text>
              ),
            },
            {
              title: '最后出现',
              dataIndex: 'last_seen',
              width: 180,
              render: (val) => (
                <Text type='tertiary' size='small'>
                  {new Date(val * 1000).toLocaleString()}
                </Text>
              ),
            },
          ]}
        />
      </div>
    );
  };

  return (
    <div style={{ padding: '16px 0' }}>
      {/* Stats bar */}
      <div className='flex flex-col md:flex-row justify-between items-start md:items-center gap-2 w-full mb-4'>
        <Space>
          {riskCounts.extreme > 0 && (
            <Tag color='red' style={tagStyle} className='!rounded-lg'>
              极高风险: {riskCounts.extreme}
            </Tag>
          )}
          {riskCounts.high > 0 && (
            <Tag color='orange' style={tagStyle} className='!rounded-lg'>
              高风险: {riskCounts.high}
            </Tag>
          )}
          <Tag color='blue' style={tagStyle} className='!rounded-lg'>
            检测用户: {data.length}
          </Tag>
          <Tag
            color='white'
            style={{ ...tagStyle, border: 'none' }}
            className='!rounded-lg'
          >
            3+IP用户
          </Tag>
        </Space>
        <Space>
          <Select
            value={days}
            onChange={(v) => { setDays(v); setIpDetails({}); setExpandedRowKeys([]); }}
            optionList={DAY_OPTIONS}
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
        rowKey='user_id'
        loading={loading}
        pagination={false}
        expandedRowKeys={expandedRowKeys}
        onExpand={handleExpand}
        expandedRowRender={expandedRowRender}
        size='small'
        empty={
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Text type='tertiary'>
              {loading ? '检测中...' : '未检测到共用风险用户'}
            </Text>
          </div>
        }
      />
    </div>
  );
};

export default SharingRiskTab;
