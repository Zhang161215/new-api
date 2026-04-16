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

import React, { useContext, useEffect, useMemo, useState, useRef } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { API, copy, showError, showSuccess } from '../../helpers';
import { renderQuota } from '../../helpers/render';
import {
  formatSubscriptionDuration,
  formatSubscriptionResetPeriod,
} from '../../helpers/subscriptionFormat';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { StatusContext } from '../../context/Status';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import NoticeModal from '../../components/layout/NoticeModal';


const FEATURE_ITEMS = [
  {
    key: 'speed',
    title: '极速响应',
    description:
      '常用模型统一入口，适配流式输出，减少多平台来回切换。',
    index: '01',
  },
  {
    key: 'stability',
    title: '稳定路由',
    description: '面向开发使用场景，减少渠道波动带来的调用中断。',
    index: '02',
  },
  {
    key: 'pricing',
    title: '套餐清晰',
    description: '不再只显示抽象标签，直接呈现价格、额度、重置规则与升级分组。',
    index: '03',
  },
  {
    key: 'compatibility',
    title: '即插即用',
    description:
      '兼容 OpenAI 风格接口，便于接入 Cursor、Cline、Claude Code 等工具。',
    index: '04',
  },
];

const PROVIDER_ITEMS = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'claude', label: 'Claude' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'grok', label: 'Grok' },
  { key: 'xai', label: 'xAI' },
  { key: 'qwen', label: 'Qwen' },
];

const TUTORIAL_ITEMS = [
  {
    key: 'claude',
    label: 'Claude Code',
    title: 'Claude Code 快速接入',
    description:
      '参考文档中的 Claude Code 教程：安装 Node.js、安装 Claude Code，并配置 ANTHROPIC_BASE_URL 与 ANTHROPIC_AUTH_TOKEN。',
    badges: ['Base URL: /', 'Claude 官方变量'],
    steps: [
      {
        step: '01',
        title: '安装 Claude Code',
        description:
          '先准备 Node.js 环境，再执行 npm install -g @anthropic-ai/claude-code。',
      },
      {
        step: '02',
        title: '设置环境变量',
        description:
          '文档使用 ANTHROPIC_BASE_URL=https://synai996.space 与 ANTHROPIC_AUTH_TOKEN=你的API密钥。',
      },
      {
        step: '03',
        title: '启动并验证',
        description: '执行 claude，能正常启动并对话就说明接入成功。',
      },
    ],
    codeTitle: '与文档保持一致',
  },
  {
    key: 'gemini',
    label: 'Gemini CLI',
    title: 'Gemini CLI 快速接入',
    description:
      '参考文档中的 Gemini CLI 教程：重点是把网关地址设置为 /gemini，并同时配置 GEMINI_API_KEY 与 GEMINI_MODEL。',
    badges: ['Base URL: /gemini', 'Gemini CLI'],
    steps: [
      {
        step: '01',
        title: '准备 Node.js 环境',
        description: 'Gemini CLI 需要 Node.js，可直接参考 Claude Code 教程中的安装步骤。',
      },
      {
        step: '02',
        title: '设置 Gemini 专用变量',
        description:
          '使用 GOOGLE_GEMINI_BASE_URL、GEMINI_API_KEY 与 GEMINI_MODEL，不要混用其他工具变量。',
      },
      {
        step: '03',
        title: '从默认模型开始测试',
        description: '建议先按文档示例使用 gemini-2.5-pro，确认 CLI 能正常请求后再切换。',
      },
    ],
    codeTitle: '直接对应文档变量名',
  },
  {
    key: 'codex',
    label: 'Codex CLI',
    title: 'Codex CLI 快速接入',
    description:
      '参考文档中的 Codex CLI 教程：核心是写入 ~/.codex/config.toml，把 provider 指向 https://synai996.space/v1。',
    badges: ['Base URL: /v1', 'wire_api: responses'],
    steps: [
      {
        step: '01',
        title: '创建 config.toml',
        description:
          '按文档把 model_provider 设为 crs，model 默认使用 gpt-5-codex，并保留 wire_api = responses。',
      },
      {
        step: '02',
        title: '配置认证方式',
        description:
          '可以写 ~/.codex/auth.json，也可以直接设置 CRS_OAI_KEY 环境变量。',
      },
      {
        step: '03',
        title: '先用默认模型跑通',
        description: '优先使用文档里的 gpt-5-codex，确认接入成功后再切换其他模型。',
      },
    ],
    codeTitle: '精简版配置片段',
  },
];

const PLAN_TYPE_ORDER = ['week', 'gpt_month', 'month', 'recharge'];

const PLAN_KEYWORDS = {
  week: ['周卡', '标准周卡', '7日', '7 天'],
  gpt_month: ['GPT月卡', 'GPT 月卡', '月卡'],
  recharge: ['充值', '按量', '余额', 'topup', 'top up'],
};

const normalizePlanRecord = (record) => {
  if (!record) return null;
  if (record.plan && typeof record.plan === 'object') {
    return record.plan;
  }
  return record;
};

const Home = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [statusState] = useContext(StatusContext);
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(false);
  const [homePageContent, setHomePageContent] = useState('');
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [activeTutorial, setActiveTutorial] = useState('claude');
  const isMobile = useIsMobile();
  const [uptimeText, setUptimeText] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const docsLink = statusState?.status?.docs_link || '';
  const docsUrl = docsLink || `${window.location.origin}/docs/`;
  const serverAddress =
    statusState?.status?.server_address || `${window.location.origin}`;
  const openAIBaseUrl = `${serverAddress}/v1`;

  // Dynamic uptime counter (start: 2025-12-03 00:00:00 UTC+8 = 1764691200)
  useEffect(() => {
    const SITE_START = 1764691200;
    const calc = () => {
      const diff = Math.floor(Date.now() / 1000) - SITE_START;
      setUptimeText({
        d: Math.floor(diff / 86400),
        h: Math.floor((diff % 86400) / 3600),
        m: Math.floor((diff % 3600) / 60),
        s: diff % 60,
      });
    };
    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, []);

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    const res = await API.get('/api/home_page_content');
    const { success, message, data } = res.data;
    if (success) {
      let content = data;
      if (data && !data.startsWith('https://')) {
        content = marked.parse(data);
      }
      setHomePageContent(content);
      localStorage.setItem('home_page_content', content || '');
    } else {
      showError(message);
      setHomePageContent('加载首页内容失败...');
    }
    setHomePageContentLoaded(true);
  };

  const getSubscriptionPlans = async () => {
    setPlansLoading(true);
    try {
      const res = await API.get('/api/subscription/public_plans');
      if (res.data?.success) {
        setSubscriptionPlans(
          (res.data.data || [])
            .map((item) => normalizePlanRecord(item))
            .filter(Boolean),
        );
      } else {
        setSubscriptionPlans([]);
      }
    } catch (error) {
      setSubscriptionPlans([]);
    } finally {
      setPlansLoading(false);
    }
  };

  const handleCopyBaseURL = async () => {
    const ok = await copy(serverAddress);
    if (ok) {
      showSuccess(t('已复制到剪切板'));
    }
  };

  const scrollToQuickStart = () => {
    document
      .getElementById('quick-start')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToPricing = () => {
    document
      .getElementById('pricing')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCopySnippet = async (snippet) => {
    const ok = await copy(snippet);
    if (ok) {
      showSuccess(t('已复制到剪切板'));
    }
  };

  const classifyPlan = (plan) => {
    const title = `${plan?.title || ''} ${plan?.subtitle || ''}`.toLowerCase();
    if (
      PLAN_KEYWORDS.week.some((keyword) => title.includes(keyword.toLowerCase()))
    ) {
      return 'week';
    }
    if (
      PLAN_KEYWORDS.gpt_month.some((keyword) =>
        title.includes(keyword.toLowerCase()),
      )
    ) {
      return 'gpt_month';
    }
    if (
      PLAN_KEYWORDS.recharge.some((keyword) =>
        title.includes(keyword.toLowerCase()),
      )
    ) {
      return 'recharge';
    }
    if (plan?.duration_unit === 'month') {
      return 'month';
    }
    return 'other';
  };

  const planCards = useMemo(() => {
    const cards = subscriptionPlans
      .map((plan) => ({
        plan,
        type: classifyPlan(plan),
      }))
      .sort((a, b) => {
        const aIndex = PLAN_TYPE_ORDER.indexOf(a.type);
        const bIndex = PLAN_TYPE_ORDER.indexOf(b.type);
        return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
      });

    return cards;
  }, [subscriptionPlans]);

  const tutorialItems = useMemo(
    () => ({
      claude: {
        snippet: `export ANTHROPIC_BASE_URL="${serverAddress}"
export ANTHROPIC_AUTH_TOKEN="your-api-key"

claude`,
      },
      gemini: {
        snippet: `export GOOGLE_GEMINI_BASE_URL="${serverAddress}/gemini"
export GEMINI_API_KEY="your-api-key"
export GEMINI_MODEL="gemini-2.5-pro"`,
      },
      codex: {
        snippet: `model_provider = "crs"
model = "gpt-5-codex"
preferred_auth_method = "apikey"

[model_providers.crs]
name = "crs"
base_url = "${openAIBaseUrl}"
wire_api = "responses"
requires_openai_auth = true
env_key = "CRS_OAI_KEY"`,
      },
    }),
    [openAIBaseUrl, serverAddress],
  );

  const activeTutorialItem = useMemo(() => {
    const base = TUTORIAL_ITEMS.find((item) => item.key === activeTutorial);
    if (!base) return null;
    return {
      ...base,
      snippet: tutorialItems[activeTutorial]?.snippet || '',
    };
  }, [activeTutorial, tutorialItems]);

  useEffect(() => {
    const checkNoticeAndShow = async () => {
      const lastCloseDate = localStorage.getItem('notice_close_date');
      const today = new Date().toDateString();
      if (lastCloseDate !== today) {
        try {
          const res = await API.get('/api/notice');
          const { success, data } = res.data;
          if (success && data && data.trim() !== '') {
            setNoticeVisible(true);
          }
        } catch (error) {
          console.error('获取公告失败:', error);
        }
      }
    };

    checkNoticeAndShow();
    displayHomePageContent().then();
    getSubscriptionPlans().then();
  }, []);

  if (!homePageContentLoaded) {
    return (
      <div className='w-full min-h-[60vh] flex items-center justify-center'>
        <Spin size='large' />
      </div>
    );
  }

  if (homePageContent !== '') {
    return (
      <div className='overflow-x-hidden w-full'>
        {homePageContent.startsWith('https://') ? (
          <iframe src={homePageContent} className='w-full h-screen border-none' />
        ) : (
          <div
            className='mt-[60px]'
            dangerouslySetInnerHTML={{ __html: homePageContent }}
          />
        )}
      </div>
    );
  }

  return (
    <div className='synai-homepage'>
      <NoticeModal
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        isMobile={isMobile}
      />

      {/* ========== Hero Section ========== */}
      <section className='synai-hero'>
        <div className='synai-hero-bg' />
        <main className='synai-shell'>
          <div className='synai-hero-card'>
            <div className='synai-hero-layout'>
              {/* Left column */}
              <div className='synai-hero-left'>
                <div className='synai-eyebrow-row'>
                  <div className='synai-eyebrow'>Premium Proxy Service</div>
                  <a
                    href='https://qm.qq.com/cgi-bin/qm/qr?k=&group_code=1054145226'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='synai-qq-link'
                    title='加入 QQ 群'
                  >
                    <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
                      <path d="M824.8 613.2c-16-51.4-34.4-94.6-62.7-165.3C766.5 262.2 689.3 112 512 112 334.7 112 257.5 262.2 261.8 447.9c-28.4 70.8-46.7 113.7-62.7 165.3-34 109.5-23 154.8-14.6 155.8 18 2.2 70.1-82.4 70.1-82.4 0 49 25.2 112.9 79.8 159-26.4 8.1-85.7 29.9-71.6 53.8 11.4 19.3 196.2 12.3 249.2 6.8 53 5.5 237.8 12.5 249.2-6.8 14.1-23.8-45.3-45.7-71.6-53.8 54.6-46.2 79.8-110.1 79.8-159 0 0 52.1 84.6 70.1 82.4 8.5-1.1 19.5-46.4-14.6-155.8z" />
                    </svg>
                    {t('加入QQ群')}
                  </a>
                </div>
                <div className='synai-hero-brand'>
                  <img
                    src='https://synai996.space/static/logo-circle.png'
                    alt='Synai996'
                    className='synai-hero-logo'
                  />
                  <h1 className='synai-hero-h1'>
                    Synai996 AI Gateway
                  </h1>
                </div>
                <p className='synai-lead'>
                  {t(
                    '稳定接入 Claude、GPT、Gemini、DeepSeek 等主流模型，一套兼容接口即可覆盖常见开发工具与工作流。',
                  )}
                </p>

                <div className='synai-hero-actions'>
                  <button
                    className='synai-btn synai-btn-primary'
                    onClick={() => navigate('/console')}
                  >
                    {t('开始使用')}
                  </button>
                  <button
                    className='synai-btn synai-btn-secondary'
                    onClick={scrollToQuickStart}
                  >
                    {t('查看教程')}
                  </button>
                  {docsLink && (
                    <button
                      className='synai-btn synai-btn-secondary'
                      onClick={() => window.open(docsLink, '_blank')}
                    >
                      {t('接口文档')}
                    </button>
                  )}
                </div>

                <div className='synai-hero-metrics'>
                  <div className='synai-metric'>
                    <strong>OpenAI Compatible</strong>
                    <span>{t('兼容常见工具与调用方式')}</span>
                  </div>
                  <div className='synai-metric'>
                    <strong>Claude / GPT / Gemini</strong>
                    <span>{t('覆盖主流模型使用场景')}</span>
                  </div>
                  <div className='synai-metric'>
                    <strong>{t('真实套餐直出')}</strong>
                    <span>{t('周卡、月卡内容清晰可见')}</span>
                  </div>
                </div>

                <div className='synai-uptime-card'>
                  <div className='synai-uptime-header'>
                    <div className='synai-uptime-status'>
                      <span className='synai-uptime-dot' />
                      <span>{t('服务状态：正常运行')}</span>
                    </div>
                    <a
                      href='https://check.synai996.space'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='synai-uptime-link'
                    >
                      {t('查看监控')} →
                    </a>
                  </div>
                  <div className='synai-uptime-counter'>
                    <div className='synai-uptime-unit'>
                      <span className='synai-uptime-num'>{String(uptimeText.d).padStart(3, '0')}</span>
                      <span className='synai-uptime-label'>{t('天')}</span>
                    </div>
                    <span className='synai-uptime-colon'>:</span>
                    <div className='synai-uptime-unit'>
                      <span className='synai-uptime-num'>{String(uptimeText.h).padStart(2, '0')}</span>
                      <span className='synai-uptime-label'>{t('时')}</span>
                    </div>
                    <span className='synai-uptime-colon'>:</span>
                    <div className='synai-uptime-unit'>
                      <span className='synai-uptime-num'>{String(uptimeText.m).padStart(2, '0')}</span>
                      <span className='synai-uptime-label'>{t('分')}</span>
                    </div>
                    <span className='synai-uptime-colon'>:</span>
                    <div className='synai-uptime-unit'>
                      <span className='synai-uptime-num synai-uptime-sec'>{String(uptimeText.s).padStart(2, '0')}</span>
                      <span className='synai-uptime-label'>{t('秒')}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className='synai-hero-panel'>
                <div className='synai-base-card'>
                  <div className='synai-panel-label'>Base URL</div>
                  <div className='synai-url-box'>
                    <span>{serverAddress}</span>
                    <button
                      className='synai-btn synai-btn-secondary synai-btn-sm'
                      onClick={handleCopyBaseURL}
                    >
                      {t('复制')}
                    </button>
                  </div>
                  <div className='synai-chip-row'>
                    <span className='synai-chip'>/v1/chat/completions</span>
                    <span className='synai-chip'>/v1/messages</span>
                    <span className='synai-chip'>/v1/responses</span>
                    <span className='synai-chip'>/v1/images/generations</span>
                  </div>
                </div>

                <div className='synai-status-card'>
                  <div className='synai-panel-label'>Quick Entry</div>
                  <div className='synai-quick-entries'>
                    <div className='synai-quick-entry' onClick={() => navigate('/console/token')}>
                      <div className='synai-quick-entry-title'>{t('创建 API Key')}</div>
                      <div className='synai-quick-entry-desc'>{t('用于 Claude Code、Gemini CLI、Codex CLI 等接入')}</div>
                      <div className='synai-quick-entry-path'>/console/token</div>
                    </div>
                    <div className='synai-quick-entry' onClick={scrollToPricing}>
                      <div className='synai-quick-entry-title'>{t('查看套餐')}</div>
                      <div className='synai-quick-entry-desc'>{t('购买页与首页套餐卡片使用同一份后台数据')}</div>
                      <div className='synai-quick-entry-path'>#pricing</div>
                    </div>
                    {docsLink && (
                      <div className='synai-quick-entry' onClick={() => window.open(docsLink, '_blank')}>
                        <div className='synai-quick-entry-title'>{t('打开文档')}</div>
                        <div className='synai-quick-entry-desc'>{t('安装说明与接入教程保留在本地文档页')}</div>
                        <div className='synai-quick-entry-path'>/docs/</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </section>

      {/* ========== Feature Section ========== */}
      <section className='synai-section'>
        <div className='synai-shell'>
          <div className='synai-section-card'>
            <div className='synai-section-head'>
              <div>
                <div className='synai-kicker'>Core Features</div>
                <h2 className='synai-section-h2'>
                  {t('为开发场景优化的 API 网关')}
                </h2>
              </div>
              <p className='synai-section-desc'>
                {t('聚合常用模型，统一调用方式，减少多平台切换带来的额外开销。')}
              </p>
            </div>

            <div className='synai-feature-grid'>
              {FEATURE_ITEMS.map((item) => (
                <div className='synai-feature-card' key={item.key}>
                  <div className='synai-feature-icon'>{item.index}</div>
                  <h3>{t(item.title)}</h3>
                  <p>{t(item.description)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ========== Pricing Section ========== */}
      <section className='synai-section' id='pricing'>
        <div className='synai-shell'>
          <div className='synai-section-card'>
            <div className='synai-section-head'>
              <div>
                <div className='synai-kicker'>Live Plans</div>
                <h2 className='synai-section-h2'>
                  {t('透明定价，按需选择')}
                </h2>
              </div>
              <div className='synai-section-head-right'>
                <div className='synai-section-actions'>
                  <button
                    className='synai-btn synai-btn-primary synai-btn-sm'
                    onClick={() => navigate('/console')}
                  >
                    {t('开始使用')}
                  </button>
                  <button
                    className='synai-btn synai-btn-secondary synai-btn-sm'
                    onClick={scrollToQuickStart}
                  >
                    {t('查看教程')}
                  </button>
                  {docsLink && (
                    <button
                      className='synai-btn synai-btn-secondary synai-btn-sm'
                      onClick={() => window.open(docsLink, '_blank')}
                    >
                      {t('接口文档')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {plansLoading ? (
              <div className='synai-pricing-loading'>
                <Spin size='large' />
              </div>
            ) : (
              <div className='synai-plans-grid'>
                {planCards.map(({ plan, type }) => {
                  const totalAmount = Number(plan?.total_amount || 0);
                  return (
                    <article
                      className={`synai-plan-card ${type === 'week' ? 'highlight' : ''}`}
                      key={plan.id}
                    >
                      <div className='synai-plan-top'>
                        <span className='synai-plan-tag'>
                          {type === 'week'
                            ? t('热门方案')
                            : type === 'gpt_month'
                              ? t('推荐月卡')
                              : type === 'recharge'
                                ? t('灵活补充')
                                : t('订阅方案')}
                        </span>
                        {plan?.upgrade_group && (
                          <span className='synai-plan-group'>
                            {t('升级分组')} {plan.upgrade_group}
                          </span>
                        )}
                      </div>
                      <h3>{plan?.title || t('订阅套餐')}</h3>
                      <p>
                        {plan?.subtitle || t('按不同使用阶段提供更清晰的额度与重置规则。')}
                      </p>
                      <div className='synai-price-row'>
                        <div className='synai-price'>
                          ¥{Number(plan?.price_amount || 0).toFixed(2)}
                        </div>
                        <div className='synai-price-unit'>
                          /{formatSubscriptionDuration(plan, t)}
                        </div>
                      </div>
                      <div className='synai-meta-grid'>
                        <div className='synai-meta-row'>
                          <div className='synai-meta-label'>{plan?.quota_reset_period === 'daily' ? t('每日额度') : plan?.quota_reset_period === 'never' || !plan?.quota_reset_period ? t('总额度') : t('每日额度')}</div>
                          <div className='synai-meta-value'>
                            {totalAmount > 0 ? renderQuota(totalAmount) : t('无限制')}
                          </div>
                        </div>
                        <div className='synai-meta-row'>
                          <div className='synai-meta-label'>{t('重置')}</div>
                          <div className='synai-meta-value'>
                            {formatSubscriptionResetPeriod(plan, t)}
                          </div>
                        </div>
                        <div className='synai-meta-row'>
                          <div className='synai-meta-label'>{t('购买上限')}</div>
                          <div className='synai-meta-value'>
                            {plan?.max_purchase_per_user > 0
                              ? plan.max_purchase_per_user
                              : t('不限')}
                          </div>
                        </div>
                      </div>
                      <div className='synai-plan-footer'>
                        <div className='synai-plan-note'>
                          {t('当前套餐内容以后台实际配置为准。')}
                        </div>
                        <button
                          className='synai-btn synai-btn-primary synai-btn-sm'
                          onClick={() => navigate('/console/topup')}
                        >
                          {t('立即购买')}
                        </button>
                      </div>
                    </article>
                  );
                })}

                {!planCards.length && (
                  <div className='synai-pricing-empty'>
                    <h3>{t('暂未配置可展示套餐')}</h3>
                    <p>{t('你可以先进入控制台查看充值页，或稍后再回来。')}</p>
                    <button
                      className='synai-btn synai-btn-primary'
                      onClick={() => navigate('/console/topup')}
                    >
                      {t('前往购买页')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ========== Tutorial / Quick Start Section ========== */}
      <section className='synai-section' id='quick-start'>
        <div className='synai-shell'>
          <div className='synai-section-card'>
            <div className='synai-section-head'>
              <div>
                <div className='synai-kicker'>Quick Start</div>
                <h2 className='synai-section-h2'>
                  {t('三步完成接入，即刻开始开发')}
                </h2>
              </div>
              <p className='synai-section-desc'>
                {t('根据你使用的工具选择对应教程，配置环境变量后即可开始调用。')}
              </p>
            </div>

            <div className='synai-tutorial-nav'>
              {TUTORIAL_ITEMS.map((item) => (
                <button
                  type='button'
                  key={item.key}
                  className={`synai-tutorial-tab ${activeTutorial === item.key ? 'active' : ''}`}
                  onClick={() => setActiveTutorial(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {activeTutorialItem && (
              <div className='synai-steps-grid'>
                {/* Left: summary + steps */}
                <div>
                  <div className='synai-tool-summary'>
                    <div>
                      <h3>{t(activeTutorialItem.title)}</h3>
                      <p>{t(activeTutorialItem.description)}</p>
                    </div>
                    <div className='synai-tool-badge-row'>
                      {activeTutorialItem.badges.map((badge) => (
                        <span key={badge} className='synai-tool-badge'>
                          {badge}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className='synai-steps-stack'>
                    {activeTutorialItem.steps.map((item) => (
                      <div className='synai-step-card' key={item.step}>
                        <div className='synai-step-index'>{item.step}</div>
                        <h3>{t(item.title)}</h3>
                        <p>{t(item.description)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: code card */}
                <div className='synai-code-card'>
                  <div className='synai-code-head'>
                    <span>{activeTutorialItem.label}</span>
                    <span>{t(activeTutorialItem.codeTitle)}</span>
                  </div>
                  <pre>
                    <code>{activeTutorialItem.snippet}</code>
                  </pre>
                  <div className='synai-code-actions'>
                    <button
                      className='synai-mini-btn synai-mini-btn-primary'
                      onClick={() => handleCopySnippet(activeTutorialItem.snippet)}
                    >
                      {t('复制配置')}
                    </button>
                    <button
                      className='synai-mini-btn'
                      onClick={() => navigate('/console/token')}
                    >
                      {t('创建 API Key')}
                    </button>
                    <button
                      className='synai-mini-btn'
                      onClick={() => window.open(docsUrl, '_blank')}
                    >
                      {t('打开完整文档')}
                    </button>
                    <button
                      className='synai-mini-btn'
                      onClick={scrollToPricing}
                    >
                      {t('查看套餐')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
