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

import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import {
  Eye,
  HelpCircle,
  Percent,
  ShieldAlert,
  ShieldX,
  Trash2,
} from 'lucide-react';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';
import { createCardProPagination } from '../../helpers/utils';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import CardPro from '../../components/common/ui/CardPro';
import CardTable from '../../components/common/ui/CardTable';
import { useTranslation } from 'react-i18next';

const { Text, Paragraph } = Typography;

const EMPTY_FILTERS = { username: '', model_name: '', blocked: '' };

export default function PromptAuditLogs() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [statLoading, setStatLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [stat, setStat] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [detail, setDetail] = useState(null);
  const [retainDays, setRetainDays] = useState(30);

  async function fetchLogs(targetPage = page, size = pageSize, f = filters) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        p: String(targetPage - 1),
        page_size: String(size),
      });
      if (f.username) params.set('username', f.username);
      if (f.model_name) params.set('model_name', f.model_name);
      if (f.blocked) params.set('blocked', f.blocked);

      const res = await API.get(`/api/prompt_audit/logs?${params.toString()}`);
      if (res.data.success) {
        setItems(res.data.data.items || []);
        setTotal(res.data.data.total || 0);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(t('加载审核记录失败'));
    } finally {
      setLoading(false);
    }
  }

  async function fetchStat() {
    setStatLoading(true);
    try {
      const res = await API.get('/api/prompt_audit/stat');
      if (res.data.success) setStat(res.data.data);
    } catch (e) {
      // 统计失败不阻塞列表
    } finally {
      setStatLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs(1);
    fetchStat();
  }, []);

  function onSearch() {
    setPage(1);
    fetchLogs(1, pageSize, filters);
  }

  function onReset() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
    fetchLogs(1, pageSize, EMPTY_FILTERS);
  }

  async function onCleanup() {
    try {
      const res = await API.delete(`/api/prompt_audit/logs?days=${retainDays}`);
      if (res.data.success) {
        showSuccess(
          t('已清理 {{count}} 条记录', { count: res.data.data.deleted }),
        );
        setPage(1);
        fetchLogs(1);
        fetchStat();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(t('清理失败'));
    }
  }

  const blockRate =
    stat && stat.total > 0 ? ((stat.blocked / stat.total) * 100).toFixed(1) : '0.0';

  // 概览卡片：与仪表盘同款视觉（图标 + 标签 + 大号数值）
  const statCards = [
    {
      title: t('命中总数'),
      value: stat?.total ?? 0,
      sub: t('近 24 小时 {{n}} 条', { n: stat?.last_24h ?? 0 }),
      icon: <ShieldAlert size={16} />,
      avatarColor: 'blue',
      bg: 'var(--semi-color-primary-light-default)',
    },
    {
      title: t('已拦截'),
      value: stat?.blocked ?? 0,
      sub: t('请求被直接拒绝'),
      icon: <ShieldX size={16} />,
      avatarColor: 'red',
      bg: 'var(--semi-color-danger-light-default)',
    },
    {
      title: t('仅记录'),
      value: stat?.shadow ?? 0,
      sub: t('影子模式下放行'),
      icon: <Eye size={16} />,
      avatarColor: 'amber',
      bg: 'var(--semi-color-warning-light-default)',
    },
    {
      title: t('拦截占比'),
      value: `${blockRate}%`,
      sub: t('近 7 天 {{n}} 条', { n: stat?.last_7d ?? 0 }),
      icon: <Percent size={16} />,
      avatarColor: 'green',
      bg: 'var(--semi-color-success-light-default)',
    },
  ];

  const overview = (
    <div className='!mt-4 !mb-4'>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>
        {statCards.map((c) => (
          <Card
            key={c.title}
            bordered={false}
            className='border-0 !rounded-2xl w-full'
            style={{ background: c.bg }}
          >
            {/* 全站 .semi-card-body 被强制 10px，故内边距加在内容层 */}
            <div className='flex items-center px-2 py-1.5'>
              <Avatar className='mr-3' size='small' color={c.avatarColor}>
                {c.icon}
              </Avatar>
              <div className='min-w-0'>
                <Text type='tertiary' size='small'>
                  {c.title}
                </Text>
                <Skeleton
                  loading={statLoading}
                  active
                  placeholder={
                    <Skeleton.Paragraph active rows={1} style={{ width: 60, height: 24 }} />
                  }
                >
                  <div className='text-xl font-semibold leading-tight'>
                    {c.value}
                  </div>
                </Skeleton>
                <div className='truncate'>
                  <Text type='quaternary' size='small'>
                    {c.sub}
                  </Text>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {(stat?.top_users?.length > 0 || stat?.top_models?.length > 0) && (
        <Card
          bordered={false}
          className='!rounded-2xl !mt-4'
          style={{ background: 'var(--semi-color-fill-0)' }}
        >
          <div className='flex flex-col gap-2 px-2 py-1'>
            {stat?.top_users?.length > 0 && (
              <div className='flex items-start gap-2 flex-wrap'>
                <Text type='tertiary' className='text-sm shrink-0'>
                  {t('命中最多的用户')}
                </Text>
                <Space wrap spacing={4}>
                  {stat.top_users.map((u) => (
                    <Tag key={u.username} color='violet' shape='circle'>
                      {u.username || t('未知')} · {u.count}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
            {stat?.top_models?.length > 0 && (
              <div className='flex items-start gap-2 flex-wrap'>
                <Text type='tertiary' className='text-sm shrink-0'>
                  {t('命中最多的模型')}
                </Text>
                <Space wrap spacing={4}>
                  {stat.top_models.map((m) => (
                    <Tag key={m.model_name} color='cyan' shape='circle'>
                      {m.model_name || t('未知')} · {m.count}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );

  const descriptionArea = (
    <div className='flex items-center gap-2 mb-2'>
      <Text strong style={{ fontSize: 16 }}>
        {t('审核记录')}
      </Text>
      <Text type='tertiary' className='text-sm'>
        {t('命中审核的请求明细，含完整提示词，仅管理员可见')}
      </Text>
    </div>
  );

  const searchArea = (
    <div className='flex flex-wrap items-center gap-2 w-full'>
      <Input
        placeholder={t('用户名')}
        value={filters.username}
        onChange={(v) => setFilters((f) => ({ ...f, username: v }))}
        onEnterPress={onSearch}
        style={{ width: 150 }}
        showClear
      />
      <Input
        placeholder={t('请求模型')}
        value={filters.model_name}
        onChange={(v) => setFilters((f) => ({ ...f, model_name: v }))}
        onEnterPress={onSearch}
        style={{ width: 170 }}
        showClear
      />
      <Select
        placeholder={t('处置')}
        value={filters.blocked || undefined}
        onChange={(v) => setFilters((f) => ({ ...f, blocked: v || '' }))}
        style={{ width: 130 }}
        showClear
      >
        <Select.Option value='true'>{t('已拦截')}</Select.Option>
        <Select.Option value='false'>{t('仅记录')}</Select.Option>
      </Select>
      <Button type='primary' onClick={onSearch}>
        {t('搜索')}
      </Button>
      <Button type='tertiary' onClick={onReset}>
        {t('重置')}
      </Button>

      <div className='flex items-center gap-2 ml-auto'>
        <Text type='tertiary' className='text-sm shrink-0'>
          {t('保留天数')}
        </Text>
        <InputNumber
          value={retainDays}
          min={0}
          max={3650}
          style={{ width: 100 }}
          onChange={(v) => setRetainDays(v)}
        />
        <Popconfirm
          title={t('确认清理？')}
          content={t('将永久删除 {{days}} 天前的审核记录', { days: retainDays })}
          onConfirm={onCleanup}
        >
          <Button type='danger' theme='light' icon={<Trash2 size={14} />}>
            {t('清理')}
          </Button>
        </Popconfirm>
      </div>
    </div>
  );

  // 表头带说明：把「这一列什么意思」直接放在表头，省去看文档
  const headerWithHint = (text, hint) => (
    <Tooltip content={hint} position='top'>
      <span className='inline-flex items-center gap-1'>
        {text}
        <HelpCircle size={13} style={{ opacity: 0.45 }} />
      </span>
    </Tooltip>
  );

  const columns = [
    {
      title: t('时间'),
      dataIndex: 'created_at',
      width: 160,
      sorter: (a, b) => a.created_at - b.created_at,
      render: (v) => <Text size='small'>{timestamp2string(v)}</Text>,
    },
    {
      title: headerWithHint(
        t('处置'),
        t('拦截模式下命中会直接拒绝请求；影子模式下只记录、请求照常放行'),
      ),
      dataIndex: 'blocked',
      width: 110,
      render: (v) => (
        <Tag
          color={v ? 'red' : 'amber'}
          shape='circle'
          prefixIcon={v ? <ShieldX size={12} /> : <Eye size={12} />}
        >
          {v ? t('已拦截') : t('仅记录')}
        </Tag>
      ),
    },
    {
      title: headerWithHint(
        t('风险'),
        t('审核模型给出的违规置信度：≥0.9 高危，≥0.7 可疑，其余为低'),
      ),
      dataIndex: 'confidence',
      width: 130,
      sorter: (a, b) => a.confidence - b.confidence,
      render: (v) => {
        const n = Number(v) || 0;
        const level =
          n >= 0.9
            ? { color: 'red', label: t('高危') }
            : n >= 0.7
              ? { color: 'orange', label: t('可疑') }
              : { color: 'grey', label: t('低') };
        return (
          <Space spacing={4}>
            <Tag color={level.color} shape='circle'>
              {level.label}
            </Tag>
            <Text type='tertiary' size='small'>
              {n.toFixed(2)}
            </Text>
          </Space>
        );
      },
    },
    {
      // 用户与令牌合并：主行用户，副行令牌，省一列又不丢信息
      title: t('用户 / 令牌'),
      dataIndex: 'username',
      width: 170,
      render: (v, record) => (
        <div className='leading-tight'>
          <Text>{v ? `${v} (#${record.user_id})` : `#${record.user_id}`}</Text>
          <div>
            <Text type='tertiary' size='small'>
              {record.token_name || '-'}
            </Text>
          </div>
        </div>
      ),
    },
    {
      // 模型与端点合并：一眼看出哪个模型、走的哪个接口
      title: t('请求模型 / 端点'),
      dataIndex: 'model_name',
      width: 200,
      render: (v, record) => (
        <div className='leading-tight'>
          <Text>{v || '-'}</Text>
          <div>
            <Text type='tertiary' size='small'>
              {record.endpoint || '-'}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: t('判定理由'),
      dataIndex: 'reason',
      // 行高本就占两行（用户/令牌、模型/端点），理由也给两行，多数判定能看全
      render: (v) => (
        <Text
          ellipsis={{ rows: 2, showTooltip: true }}
          style={{ width: '100%', wordBreak: 'break-word' }}
        >
          {v || '-'}
        </Text>
      ),
    },
    {
      title: t('操作'),
      dataIndex: 'op',
      width: 90,
      fixed: 'right',
      render: (_, record) => (
        <Button theme='light' size='small' onClick={() => setDetail(record)}>
          {t('查看')}
        </Button>
      ),
    },
  ];

  return (
    <>
      {overview}

      <CardPro
        type='type1'
        descriptionArea={descriptionArea}
        searchArea={searchArea}
        paginationArea={createCardProPagination({
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => {
            setPage(p);
            fetchLogs(p);
          },
          onPageSizeChange: (ps) => {
            setPageSize(ps);
            setPage(1);
            fetchLogs(1, ps);
          },
          isMobile,
          t,
        })}
        t={t}
      >
        <CardTable
          columns={columns}
          dataSource={items}
          loading={loading}
          rowKey='id'
          pagination={false}
          scroll={{ x: 1100 }}
          empty={
            <Empty
              image={<IllustrationNoResult style={{ width: 140, height: 140 }} />}
              darkModeImage={
                <IllustrationNoResultDark style={{ width: 140, height: 140 }} />
              }
              description={t('暂无审核命中记录')}
              style={{ padding: 30 }}
            />
          }
        />
      </CardPro>

      <Modal
        title={t('审核记录详情')}
        visible={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <>
            <Descriptions
              size='small'
              data={[
                { key: t('时间'), value: timestamp2string(detail.created_at) },
                {
                  key: t('处置'),
                  value: detail.blocked ? t('已拦截') : t('仅记录（未拦截）'),
                },
                {
                  key: t('置信度'),
                  value: Number(detail.confidence).toFixed(2),
                },
                { key: t('判定理由'), value: detail.reason || '-' },
                {
                  key: t('用户'),
                  value: `${detail.username} (#${detail.user_id})`,
                },
                { key: t('令牌'), value: detail.token_name || '-' },
                { key: t('请求模型'), value: detail.model_name || '-' },
                { key: t('渠道 ID'), value: detail.channel_id || '-' },
                { key: t('端点'), value: detail.endpoint || '-' },
                { key: t('审核模型'), value: detail.audit_model || '-' },
                { key: t('审核耗时'), value: `${detail.latency_ms} ms` },
                { key: 'IP', value: detail.ip || '-' },
              ]}
            />
            <div style={{ marginTop: 16 }}>
              <Text strong>{t('送审的完整提示词')}</Text>
              <Paragraph
                copyable
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: 'var(--semi-color-fill-0)',
                  borderRadius: 6,
                  maxHeight: 320,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {detail.prompt || '-'}
              </Paragraph>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
