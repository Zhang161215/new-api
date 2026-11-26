/*
本站：邀请返利页（/console/invite）
- 顶部 4 张卡：返利比例、邀请人数、可转返利额度（含待到账）、历史返利额度
- 默认邀请码 + 链接、使用说明
- 专属邀请码：默认码不可改，最多再建 9 个；删除后链接立即失效
- 返利额度一键转余额；已邀请用户列表（邮箱脱敏）
*/

import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  ArrowRightLeft,
  Copy,
  Gift,
  History,
  Link2,
  Percent,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  API,
  copy,
  renderQuota,
  showError,
  showSuccess,
  timestamp2string,
} from '../../helpers';
import { UserContext } from '../../context/User';
import AffiliateHistoryModal from '../../components/topup/modals/AffiliateHistoryModal';
import './invite.css';

const { Text } = Typography;

const CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;
const PAGE_SIZE = 10;

const inviteLink = (code) =>
  `${window.location.origin}/register?aff=${encodeURIComponent(code)}`;

const formatPercent = (p) => {
  const n = Number(p || 0);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, '')}%`;
};

const StatCard = ({ icon, label, value, hint, accent }) => (
  <div className={`inv-stat inv-stat-${accent}`}>
    <div className='inv-stat-head'>
      <span className='inv-stat-icon'>{icon}</span>
      <span className='inv-stat-label'>{label}</span>
    </div>
    <div className='inv-stat-value'>{value}</div>
    {hint ? <div className='inv-stat-hint'>{hint}</div> : null}
  </div>
);

const CopyButton = ({ text, label, t, size = 'default', theme = 'light' }) => (
  <Button
    size={size}
    theme={theme}
    icon={<Copy size={14} />}
    onClick={async () => {
      if (await copy(text)) showSuccess(t('已复制到剪贴板'));
      else showError(t('复制失败，请手动复制'));
    }}
  >
    {label}
  </Button>
);

const Invite = () => {
  const { t } = useTranslation();
  const [userState, userDispatch] = useContext(UserContext);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [invitees, setInvitees] = useState([]);
  const [inviteeTotal, setInviteeTotal] = useState(0);
  const [inviteePage, setInviteePage] = useState(1);
  const [inviteeLoading, setInviteeLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await API.get('/api/user/affiliate/overview');
      const { success, message, data } = res.data;
      if (success) setOverview(data);
      else showError(message);
    } catch (e) {
      showError(t('加载失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadInvitees = useCallback(
    async (page) => {
      setInviteeLoading(true);
      try {
        const res = await API.get(
          `/api/user/affiliate/invitees?page=${page}&page_size=${PAGE_SIZE}`,
        );
        const { success, message, data } = res.data;
        if (success) {
          setInvitees(data.items || []);
          setInviteeTotal(data.total || 0);
        } else {
          showError(message);
        }
      } catch (e) {
        showError(t('加载失败'));
      } finally {
        setInviteeLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadInvitees(inviteePage);
  }, [loadInvitees, inviteePage]);

  const codes = overview?.codes || [];
  const maxCodes = overview?.max_codes || 9;
  const defaultCode = overview?.default_code || {};
  const percentText = formatPercent(overview?.percent);
  const affQuota = overview?.aff_quota || 0;
  const pendingQuota = overview?.aff_pending_quota || 0;

  const createCode = async () => {
    const code = newCode.trim();
    if (!CODE_PATTERN.test(code)) {
      showError(t('邀请码需为 4~32 位字母、数字、下划线或连字符'));
      return;
    }
    setCreating(true);
    try {
      const res = await API.post('/api/user/affiliate/codes', { code });
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('邀请码已创建'));
        setNewCode('');
        loadOverview();
      } else {
        showError(message);
      }
    } catch (e) {
      showError(t('创建失败'));
    } finally {
      setCreating(false);
    }
  };

  const deleteCode = (item) => {
    Modal.confirm({
      title: t('删除邀请码「{{code}}」？', { code: item.code }),
      content: t(
        '删除后这个邀请码的链接立即失效，新用户无法再通过它注册；已邀请的用户和返利不受影响。',
      ),
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        try {
          const res = await API.delete(`/api/user/affiliate/codes/${item.id}`);
          const { success, message } = res.data;
          if (success) {
            showSuccess(t('已删除'));
            loadOverview();
          } else {
            showError(message);
          }
        } catch (e) {
          showError(t('删除失败'));
        }
      },
    });
  };

  const transferAll = async () => {
    setTransferring(true);
    try {
      const res = await API.post('/api/user/affiliate/transfer_all');
      const { success, message, data } = res.data;
      if (success) {
        showSuccess(
          t('已转入余额 {{amount}}', { amount: renderQuota(data.quota) }),
        );
        if (userState?.user) {
          userDispatch({
            type: 'login',
            payload: {
              ...userState.user,
              quota: (userState.user.quota || 0) + data.quota,
              aff_quota: 0,
            },
          });
        }
        loadOverview();
      } else {
        showError(message);
      }
    } catch (e) {
      showError(t('转入失败'));
    } finally {
      setTransferring(false);
    }
  };

  const codeStatsText = (item) =>
    t('邀请 {{n}} 人 · 返利 {{amount}}', {
      n: item.invite_count || 0,
      amount: renderQuota(item.rebate_quota || 0),
    });

  const steps = [
    t('将邀请码或邀请链接分享给新用户。'),
    overview?.every_top_up
      ? t('被邀请用户每次充值后，你可获得 {{p}} 的返利额度。', {
          p: percentText,
        })
      : t('被邀请用户首次充值后，你可获得 {{p}} 的返利额度。', {
          p: percentText,
        }),
    overview?.delay_days > 0
      ? t('返利 {{d}} 天后到账，到账后可随时转入账户余额。', {
          d: overview.delay_days,
        })
      : t('返利额度可随时转入账户余额。'),
  ];
  const notes = [];
  if (overview?.same_ip_check) {
    notes.push(
      t('与邀请人在同一网络注册或登录过的账号视为非真实邀请，不计返利。'),
    );
  }
  notes.push(t('仅钱包充值计返利，订阅套餐不计。'));
  (overview?.extra_rules || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => notes.push(line));

  const inviteeColumns = [
    {
      title: t('邮箱'),
      dataIndex: 'email',
      render: (v) => v || <Text type='tertiary'>-</Text>,
    },
    {
      title: t('用户名'),
      dataIndex: 'username',
      render: (v, r) => (
        <span className='inv-user'>
          <span>{v || '-'}</span>
          {r.invite_code ? (
            <Tooltip content={t('通过专属邀请码注册')}>
              <Tag size='small' color='blue'>
                {r.invite_code}
              </Tag>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    {
      title: t('返利明细'),
      dataIndex: 'rebate_quota',
      render: (v) => <span className='inv-num'>{renderQuota(v || 0)}</span>,
    },
    {
      title: t('注册时间'),
      dataIndex: 'register_time',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
  ];

  if (loading && !overview) {
    return (
      <div className='inv-page mt-[60px] px-2'>
        <div className='inv-loading'>{t('加载中...')}</div>
      </div>
    );
  }

  return (
    <div className='inv-page w-full max-w-7xl mx-auto mt-[60px] px-2'>
      <div className='inv-header'>
        <div>
          <h2 className='inv-title'>{t('邀请返利')}</h2>
          <div className='inv-subtitle'>
            {overview?.every_top_up
              ? t('邀请好友注册，好友每次充值你都能获得 {{p}} 返利', {
                  p: percentText,
                })
              : t('邀请好友注册，好友首次充值你可获得 {{p}} 返利', {
                  p: percentText,
                })}
          </div>
        </div>
        <div className='inv-header-actions'>
          <Button
            icon={<History size={14} />}
            onClick={() => setHistoryVisible(true)}
          >
            {t('返利记录')}
          </Button>
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => {
              loadOverview();
              loadInvitees(inviteePage);
            }}
          />
        </div>
      </div>

      {overview && !overview.enabled && (
        <div className='inv-banner'>{t('邀请返利活动暂未开启')}</div>
      )}

      <div className='inv-stats'>
        <StatCard
          accent='blue'
          icon={<Percent size={16} />}
          label={t('我的返利比例')}
          value={percentText}
          hint={
            overview?.every_top_up
              ? t('被邀请用户每次充值后你可获得的返利比例')
              : t('被邀请用户首次充值后你可获得的返利比例')
          }
        />
        <StatCard
          accent='green'
          icon={<Users size={16} />}
          label={t('邀请人数')}
          value={overview?.invite_count || 0}
          hint={t('通过你的邀请码注册的用户')}
        />
        <StatCard
          accent='orange'
          icon={<Wallet size={16} />}
          label={t('可转返利额度')}
          value={renderQuota(affQuota)}
          hint={
            pendingQuota > 0
              ? t('另有 {{amount}} 待到账', {
                  amount: renderQuota(pendingQuota),
                })
              : t('已到账、可转入余额的返利')
          }
        />
        <StatCard
          accent='purple'
          icon={<Gift size={16} />}
          label={t('历史返利额度')}
          value={renderQuota(overview?.aff_history_quota || 0)}
          hint={t('累计已到账的返利')}
        />
      </div>

      <div className='inv-grid'>
        <section className='inv-card'>
          <div className='inv-card-title'>{t('我的邀请码')}</div>
          <div className='inv-code-hero'>
            <span className='inv-code-text'>{defaultCode.code || '-'}</span>
            <CopyButton
              t={t}
              text={defaultCode.code || ''}
              label={t('复制邀请码')}
              size='small'
            />
          </div>
          <div className='inv-field-label'>
            <span>{t('邀请链接')}</span>
            <span className='inv-muted'>{codeStatsText(defaultCode)}</span>
          </div>
          <div className='inv-link-row'>
            <Input
              readonly
              value={defaultCode.code ? inviteLink(defaultCode.code) : ''}
              prefix={<Link2 size={14} className='inv-link-icon' />}
            />
            <CopyButton
              t={t}
              text={defaultCode.code ? inviteLink(defaultCode.code) : ''}
              label={t('复制链接')}
              theme='solid'
            />
          </div>
        </section>

        <section className='inv-card'>
          <div className='inv-card-title'>{t('使用说明')}</div>
          <ol className='inv-steps'>
            {steps.map((s, i) => (
              <li key={i}>
                <span className='inv-step-no'>{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {notes.length > 0 && (
            <ul className='inv-notes'>
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className='inv-card'>
        <div className='inv-card-head'>
          <div>
            <div className='inv-card-title'>{t('我的专属邀请码')}</div>
            <div className='inv-muted'>
              {t(
                '默认邀请码不可修改；你最多可额外创建 {{n}} 个自定义邀请码，删除后对应链接立即失效。',
                { n: maxCodes },
              )}
            </div>
          </div>
          <Tag
            size='large'
            color={codes.length >= maxCodes ? 'orange' : 'grey'}
          >
            {t('已用 {{used}} / {{max}}', {
              used: codes.length,
              max: maxCodes,
            })}
          </Tag>
        </div>

        <div className='inv-code-list'>
          <div className='inv-code-row'>
            <div className='inv-code-main'>
              <Tag color='blue' size='small'>
                {t('默认')}
              </Tag>
              <span className='inv-code-name'>{defaultCode.code}</span>
              <span className='inv-muted'>{codeStatsText(defaultCode)}</span>
            </div>
            <div className='inv-code-actions'>
              <CopyButton
                t={t}
                text={defaultCode.code ? inviteLink(defaultCode.code) : ''}
                label={t('复制链接')}
                size='small'
              />
            </div>
          </div>
          {codes.length === 0 ? (
            <div className='inv-empty'>{t('还没有自定义邀请码')}</div>
          ) : (
            codes.map((item) => (
              <div className='inv-code-row' key={item.id}>
                <div className='inv-code-main'>
                  <span className='inv-code-name'>{item.code}</span>
                  <span className='inv-muted'>{codeStatsText(item)}</span>
                </div>
                <div className='inv-code-actions'>
                  <CopyButton
                    t={t}
                    text={inviteLink(item.code)}
                    label={t('复制链接')}
                    size='small'
                  />
                  <Button
                    size='small'
                    type='danger'
                    theme='borderless'
                    icon={<Trash2 size={14} />}
                    onClick={() => deleteCode(item)}
                    aria-label={t('删除')}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className='inv-create'>
          <Input
            value={newCode}
            onChange={setNewCode}
            maxLength={32}
            placeholder={t('4~32 位字母/数字/下划线/连字符')}
            disabled={codes.length >= maxCodes}
            onEnterPress={createCode}
          />
          <Button
            theme='solid'
            icon={<Plus size={14} />}
            loading={creating}
            disabled={codes.length >= maxCodes || !newCode.trim()}
            onClick={createCode}
          >
            {t('创建邀请码')}
          </Button>
        </div>
      </section>

      <section className='inv-card inv-transfer'>
        <div>
          <div className='inv-card-title'>{t('返利额度转余额')}</div>
          <div className='inv-muted'>
            {t('将当前可用返利额度一键转入账户余额')}
          </div>
        </div>
        <div className='inv-transfer-side'>
          {affQuota > 0 ? (
            <>
              <span className='inv-transfer-amount'>
                {renderQuota(affQuota)}
              </span>
              <Button
                theme='solid'
                icon={<ArrowRightLeft size={14} />}
                loading={transferring}
                disabled={!overview?.transfer_enabled}
                onClick={transferAll}
              >
                {t('一键转入余额')}
              </Button>
            </>
          ) : (
            <span className='inv-muted'>{t('当前没有可转入额度')}</span>
          )}
        </div>
        {overview && !overview.transfer_enabled && (
          <div className='inv-muted inv-transfer-note'>
            {t('邀请奖励划转已禁用，管理员需先确认合规声明。')}
          </div>
        )}
      </section>

      <section className='inv-card'>
        <div className='inv-card-head'>
          <div className='inv-card-title'>{t('已邀请用户')}</div>
          <span className='inv-muted'>
            {t('共 {{n}} 人', { n: inviteeTotal })}
          </span>
        </div>
        <Table
          size='small'
          rowKey={(r) => `${r.username}-${r.register_time}`}
          columns={inviteeColumns}
          dataSource={invitees}
          loading={inviteeLoading}
          empty={<div className='inv-empty'>{t('还没有邀请到用户')}</div>}
          pagination={
            inviteeTotal > PAGE_SIZE
              ? {
                  currentPage: inviteePage,
                  pageSize: PAGE_SIZE,
                  total: inviteeTotal,
                  onPageChange: setInviteePage,
                }
              : false
          }
        />
      </section>

      <AffiliateHistoryModal
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        t={t}
        renderQuota={renderQuota}
      />
    </div>
  );
};

export default Invite;
