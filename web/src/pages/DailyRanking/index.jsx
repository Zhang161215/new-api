import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table,
  Select,
  Button,
  Tag,
  Space,
  Typography,
  Avatar,
  Card,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API, renderQuota } from '../../helpers';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

const SORT_OPTIONS = [
  { value: 'quota', label: '按额度' },
  { value: 'tokens', label: '按Token' },
  { value: 'requests', label: '按请求数' },
];

const formatTokens = (tokens) => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
};

const stringToColor = (str) => {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'amber', 'blue', 'cyan', 'green', 'indigo',
    'lime', 'orange', 'pink', 'purple', 'red', 'teal', 'violet',
  ];
  return colors[Math.abs(hash) % colors.length];
};

// Medal emoji for top 3
const MEDAL = ['🥇', '🥈', '🥉'];

const DailyRanking = () => {
  const { t } = useTranslation();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('quota');
  const [myRank, setMyRank] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(
        `/api/analytics/daily-ranking?sort=${sort}&limit=50`
      );
      if (res.data.success) {
        setData(res.data.data.items || []);
        setMyRank(res.data.data.my_rank || 0);
        setTotalUsers(res.data.data.total_users || 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const totalQuota = data.reduce((s, r) => s + r.total_quota, 0);
    const totalRequests = data.reduce((s, r) => s + r.request_count, 0);
    const totalTokens = data.reduce((s, r) => s + r.total_tokens, 0);
    return { totalQuota, totalRequests, totalTokens };
  }, [data]);

  const tagStyle = {
    fontWeight: 500,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    padding: 13,
  };

  const columns = [
    {
      title: '#',
      dataIndex: 'rank',
      width: 70,
      render: (rank) => {
        if (rank <= 3) {
          return (
            <span style={{ fontSize: 22, lineHeight: 1 }}>
              {MEDAL[rank - 1]}
            </span>
          );
        }
        return <Text type='tertiary'>{rank}</Text>;
      },
    },
    {
      title: t('用户'),
      dataIndex: 'username',
      width: 160,
      render: (text, record) => (
        <Space>
          <Avatar
            size='extra-small'
            color={stringToColor(text)}
            style={{ fontSize: 12 }}
          >
            {(text || '?')[0].toUpperCase()}
          </Avatar>
          <Text strong={record.is_self}>
            {text}
            {record.is_self && (
              <Tag
                color='light-blue'
                size='small'
                style={{ marginLeft: 6, fontSize: 10 }}
              >
                我
              </Tag>
            )}
          </Text>
        </Space>
      ),
    },
    {
      title: t('请求数'),
      dataIndex: 'request_count',
      width: 100,
      sorter: (a, b) => a.request_count - b.request_count,
      render: (val) => (
        <Tag color='cyan' shape='circle' size='small'>
          {val.toLocaleString()}
        </Tag>
      ),
    },
    {
      title: 'Token' + t('用量'),
      dataIndex: 'total_tokens',
      width: 120,
      sorter: (a, b) => a.total_tokens - b.total_tokens,
      render: (val) => (
        <Tag color='teal' shape='circle' size='small'>
          {formatTokens(val)}
        </Tag>
      ),
    },
    {
      title: t('消耗额度'),
      dataIndex: 'total_quota',
      width: 130,
      sorter: (a, b) => a.total_quota - b.total_quota,
      render: (val) => (
        <Text strong style={{ color: 'var(--semi-color-warning)' }}>
          {renderQuota(val)}
        </Text>
      ),
    },
  ];

  return (
    <div className='mt-[60px] px-2'>
      <Card className='!rounded-2xl'>
        <Title heading={5} style={{ marginBottom: 16 }}>
          {t('每日用量排行')}
        </Title>

        {/* Stats bar */}
        <div className='flex flex-col md:flex-row justify-between items-start md:items-center gap-2 w-full mb-4'>
          <Space>
            <Tag color='blue' style={tagStyle} className='!rounded-lg'>
              {t('今日总额度')}: {renderQuota(stats.totalQuota)}
            </Tag>
            <Tag color='pink' style={tagStyle} className='!rounded-lg'>
              {t('今日总请求')}: {stats.totalRequests.toLocaleString()}
            </Tag>
            <Tag
              color='white'
              style={{ ...tagStyle, border: 'none' }}
              className='!rounded-lg'
            >
              {t('今日总Token')}: {formatTokens(stats.totalTokens)}
            </Tag>
            <Tag color='green' style={tagStyle} className='!rounded-lg'>
              {t('活跃用户')}: {totalUsers}
            </Tag>
            {myRank > 0 && (
              <Tag color='orange' style={tagStyle} className='!rounded-lg'>
                {t('我的排名')}: #{myRank}
              </Tag>
            )}
          </Space>
          <Space>
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
          rowKey='user_id'
          loading={loading}
          pagination={false}
          size='small'
          onRow={(record) => ({
            style: record.is_self
              ? {
                  backgroundColor: 'var(--semi-color-primary-light-default)',
                  borderRadius: 8,
                }
              : {},
          })}
        />
      </Card>
    </div>
  );
};

export default DailyRanking;
