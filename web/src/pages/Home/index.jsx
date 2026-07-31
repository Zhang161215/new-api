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

import React, { useContext, useEffect, useMemo, useState } from 'react';
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
import {
  Rocket,
  BookOpen,
  FileText,
  KeyRound,
  ShoppingCart,
  Wallet,
  Copy,
} from 'lucide-react';
import NoticeModal from '../../components/layout/NoticeModal';
import './home.css';

const FEATURE_ITEMS = [
  {
    key: 'speed',
    title: '极速响应',
    description: '常用模型统一入口，适配流式输出，减少多平台来回切换。',
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
    description: '兼容 OpenAI 风格接口，便于接入 Cursor、Cline、Claude Code 等工具。',
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
    label: 'claude-code.sh',
    toolName: 'Claude Code',
    title: 'Claude Code 快速接入',
    description:
      '参考文档中的 Claude Code 教程：安装 Node.js、安装 Claude Code，并配置 ANTHROPIC_BASE_URL 与 ANTHROPIC_AUTH_TOKEN。',
    badges: ['Base URL: /', 'Claude 官方变量'],
    lang: 'bash',
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
  },
  {
    key: 'gemini',
    label: 'gemini-cli.sh',
    toolName: 'Gemini CLI',
    title: 'Gemini CLI 快速接入',
    description:
      '参考文档中的 Gemini CLI 教程：重点是把网关地址设置为 /gemini，并同时配置 GEMINI_API_KEY 与 GEMINI_MODEL。',
    badges: ['Base URL: /gemini', 'Gemini CLI'],
    lang: 'bash',
    steps: [
      {
        step: '01',
        title: '准备 Node.js 环境',
        description:
          'Gemini CLI 需要 Node.js，可直接参考 Claude Code 教程中的安装步骤。',
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
        description:
          '建议先按文档示例使用 gemini-2.5-pro，确认 CLI 能正常请求后再切换。',
      },
    ],
  },
  {
    key: 'codex',
    label: 'config.toml',
    toolName: 'Codex CLI',
    title: 'Codex CLI 快速接入',
    description:
      '参考文档中的 Codex CLI 教程：核心是写入 ~/.codex/config.toml，把 provider 指向 https://synai996.space/v1。',
    badges: ['Base URL: /v1', 'wire_api: responses'],
    lang: 'toml',
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
        description:
          '优先使用文档里的 gpt-5-codex，确认接入成功后再切换其他模型。',
      },
    ],
  },
];

// Hero 打字机轮播的模型名
const HERO_MODELS = [
  'claude-sonnet-4-6',
  'gpt-5.2-pro',
  'gemini-3.0-pro',
  'deepseek-v4',
  'grok-4',
];

const PLAN_TYPE_ORDER = ['week', 'gpt_month', 'month', 'recharge'];

const PLAN_KEYWORDS = {
  week: ['周卡', '标准周卡', '7日', '7 天'],
  gpt_month: ['GPT月卡', 'GPT 月卡', '月卡'],
  recharge: ['充值', '按量', '余额', 'topup', 'top up'],
};

const PLAN_FILE_NAMES = {
  week: 'week-card.json',
  gpt_month: 'gpt-month.json',
  month: 'month-card.json',
  recharge: 'recharge.json',
  other: 'plan.json',
};

const normalizePlanRecord = (record) => {
  if (!record) return null;
  if (record.plan && typeof record.plan === 'object') {
    return record.plan;
  }
  return record;
};

const Home = () => {
  const { t } = useTranslation();
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

  // 首页专属：让顶部导航切换为深色玻璃风（见 home.css 的 body.nx-home-active 覆盖）
  useEffect(() => {
    document.body.classList.add('nx-home-active');
    return () => document.body.classList.remove('nx-home-active');
  }, []);

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

  const tutorialSnippets = useMemo(
    () => ({
      claude: `export ANTHROPIC_BASE_URL="${serverAddress}"
export ANTHROPIC_AUTH_TOKEN="your-api-key"

claude`,
      gemini: `export GOOGLE_GEMINI_BASE_URL="${serverAddress}/gemini"
export GEMINI_API_KEY="your-api-key"
export GEMINI_MODEL="gemini-2.5-pro"`,
      codex: `model_provider = "crs"
model = "gpt-5-codex"
preferred_auth_method = "apikey"

[model_providers.crs]
name = "crs"
base_url = "${openAIBaseUrl}"
wire_api = "responses"
requires_openai_auth = true
env_key = "CRS_OAI_KEY"`,
    }),
    [openAIBaseUrl, serverAddress],
  );

  const activeTutorialItem = useMemo(() => {
    const base = TUTORIAL_ITEMS.find((item) => item.key === activeTutorial);
    if (!base) return null;
    return {
      ...base,
      snippet: tutorialSnippets[activeTutorial] || '',
    };
  }, [activeTutorial, tutorialSnippets]);

  // 终端演示：一段 vibe coding 会话（delay 单位秒，逐行入场，整段循环回放）
  const [termCycle, setTermCycle] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTermCycle((c) => c + 1), 13000);
    return () => clearInterval(timer);
  }, []);

  // Hero 模型名打字机轮播
  const [heroModelIdx, setHeroModelIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setHeroModelIdx((i) => (i + 1) % HERO_MODELS.length),
      3200,
    );
    return () => clearInterval(timer);
  }, []);

  const terminalLines = useMemo(
    () => [
      {
        delay: 0.4,
        parts: [
          { c: 'nx-tc-p', text: '$ ' },
          { c: 'nx-tc-c', text: 'claude ' },
          {
            c: 'nx-tc-s nx-term-typed',
            text: '"帮我写完购物车结算接口，顺便补上单测"',
            typed: true,
          },
        ],
      },
      {
        delay: 2.3,
        parts: [{ c: 'nx-tc-m', text: '✻ Thinking… 正在分析项目结构' }],
      },
      {
        delay: 2.9,
        parts: [
          { c: 'nx-tc-d', text: '⏺ Read ' },
          { c: 'nx-tc-c', text: 'src/cart/checkout.ts' },
        ],
      },
      {
        delay: 3.5,
        parts: [
          { c: 'nx-tc-d', text: '⏺ Write ' },
          { c: 'nx-tc-c', text: 'src/cart/checkout.ts  ' },
          { c: 'nx-tc-ok', text: '+128' },
          { c: 'nx-tc-c', text: ' ' },
          { c: 'nx-tc-e', text: '-12' },
        ],
      },
      {
        delay: 4.1,
        parts: [
          { c: 'nx-tc-d', text: '⏺ Bash ' },
          { c: 'nx-tc-c', text: 'bun test' },
        ],
      },
      {
        delay: 4.8,
        parts: [{ c: 'nx-tc-ok', text: '  ✓ 12 tests passed (0.8s)' }],
      },
      {
        delay: 5.5,
        parts: [
          { c: 'nx-tc-ok', text: '✻ Done in 42s' },
          { c: 'nx-tc-m', text: ' — 接口 + 单测全部搞定 ' },
          { c: 'nx-tc-s', text: '⚡' },
        ],
      },
    ],
    [],
  );

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

  const tickerItems = [...PROVIDER_ITEMS, ...PROVIDER_ITEMS];

  return (
    <div className='nx-home'>
      <NoticeModal
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        isMobile={isMobile}
      />

      {/* ========== Hero ========== */}
      <section className='nx-hero'>
        <div className='nx-aurora nx-aurora-a' />
        <div className='nx-aurora nx-aurora-b' />
        <div className='nx-aurora nx-aurora-c' />
        <div className='nx-shell'>
          <div className='nx-hero-grid'>
            {/* 左列 */}
            <div className='nx-hero-left'>
              <div className='nx-boot-row nx-rise nx-d1'>
                <span className='nx-badge'>
                  <span className='nx-dot' />
                  system online
                </span>
                <a
                  href='https://qm.qq.com/cgi-bin/qm/qr?k=&group_code=1054145226'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='nx-qq'
                  title={t('加入QQ群')}
                >
                  <svg viewBox='0 0 1024 1024' width='14' height='14' fill='currentColor'>
                    <path d='M824.8 613.2c-16-51.4-34.4-94.6-62.7-165.3C766.5 262.2 689.3 112 512 112 334.7 112 257.5 262.2 261.8 447.9c-28.4 70.8-46.7 113.7-62.7 165.3-34 109.5-23 154.8-14.6 155.8 18 2.2 70.1-82.4 70.1-82.4 0 49 25.2 112.9 79.8 159-26.4 8.1-85.7 29.9-71.6 53.8 11.4 19.3 196.2 12.3 249.2 6.8 53 5.5 237.8 12.5 249.2-6.8 14.1-23.8-45.3-45.7-71.6-53.8 54.6-46.2 79.8-110.1 79.8-159 0 0 52.1 84.6 70.1 82.4 8.5-1.1 19.5-46.4-14.6-155.8z' />
                  </svg>
                  {t('加入QQ群')}
                </a>
              </div>

              <h1 className='nx-h1 nx-rise nx-d2'>
                <span className='nx-h1-word'>
                  {'Synai996'.split('').map((ch, i) => (
                    <span
                      key={i}
                      className='nx-h1-letter'
                      style={{ animationDelay: `${0.2 + i * 0.05}s` }}
                    >
                      {ch}
                    </span>
                  ))}
                </span>
                <span className='nx-h1-accent' data-text='AI GATEWAY_'>
                  AI GATEWAY_
                </span>
              </h1>

              <div className='nx-typeline nx-rise nx-d2'>
                <span className='nx-prompt'>&gt;</span>
                <span>one endpoint ⇢</span>
                <span key={heroModelIdx} className='nx-type-model'>
                  {HERO_MODELS[heroModelIdx]}
                </span>
                <span className='nx-cursor' />
              </div>

              <p className='nx-lead nx-rise nx-d3'>
                {t(
                  '稳定接入 Claude、GPT、Gemini、DeepSeek 等主流模型，一套兼容接口即可覆盖常见开发工具与工作流。',
                )}
              </p>

              <div className='nx-actions nx-rise nx-d4'>
                <button
                  className='nx-btn nx-btn-primary'
                  onClick={() => navigate('/console')}
                >
                  <Rocket size={15} />
                  {t('开始使用')}
                </button>
                <button
                  className='nx-btn nx-btn-ghost'
                  onClick={() => window.open(docsUrl, '_blank')}
                >
                  <BookOpen size={15} />
                  {t('查看教程')}
                </button>
                <button
                  className='nx-btn nx-btn-ghost'
                  onClick={scrollToQuickStart}
                >
                  <FileText size={15} />
                  {t('快速接入')}
                </button>
              </div>

              <div className='nx-metrics nx-rise nx-d5'>
                <div className='nx-metric'>
                  <strong>openai_compatible</strong>
                  <span>{t('兼容常见工具与调用方式')}</span>
                </div>
                <div className='nx-metric'>
                  <strong>claude / gpt / gemini</strong>
                  <span>{t('覆盖主流模型使用场景')}</span>
                </div>
                <div className='nx-metric'>
                  <strong>{t('充值 1:1 到账')}</strong>
                  <span>{t('按量计费，分组倍率透明')}</span>
                </div>
              </div>
            </div>

            {/* 右列：终端 + Base URL */}
            <div className='nx-hero-right nx-rise nx-d3'>
              <div className='nx-terminal'>
                <div className='nx-term-head'>
                  <span className='nx-term-light r' />
                  <span className='nx-term-light y' />
                  <span className='nx-term-light g' />
                  <span className='nx-term-title'>~/my-app — claude code</span>
                </div>
                <div className='nx-term-body' key={termCycle}>
                  {terminalLines.map((line, i) => (
                    <div
                      key={i}
                      className='nx-tl'
                      style={{ animationDelay: `${line.delay}s` }}
                    >
                      {line.parts.map((part, j) => (
                        <span
                          key={j}
                          className={part.c}
                          style={
                            part.typed
                              ? { animationDelay: `${line.delay + 0.1}s` }
                              : undefined
                          }
                        >
                          {part.text}
                        </span>
                      ))}
                    </div>
                  ))}
                  <div className='nx-tl' style={{ animationDelay: '6.2s' }}>
                    <span className='nx-tc-p'>$ </span>
                    <span className='nx-cursor' />
                  </div>
                </div>
              </div>

              <div className='nx-baseurl'>
                <div className='nx-baseurl-label'>base_url</div>
                <div className='nx-baseurl-row'>
                  <span>{serverAddress}</span>
                  <button
                    className='nx-btn nx-btn-ghost nx-btn-sm'
                    onClick={handleCopyBaseURL}
                  >
                    <Copy size={13} />
                    {t('复制')}
                  </button>
                </div>
                <div className='nx-chip-row'>
                  <span className='nx-chip'>/v1/chat/completions</span>
                  <span className='nx-chip'>/v1/messages</span>
                  <span className='nx-chip'>/v1/responses</span>
                  <span className='nx-chip'>/v1/images/generations</span>
                </div>
                <div className='nx-jump-row'>
                  <span
                    className='nx-jump'
                    onClick={() => navigate('/console/token')}
                  >
                    <KeyRound size={12} />
                    {t('创建 API Key')}
                  </span>
                  <span className='nx-jump' onClick={scrollToPricing}>
                    <Wallet size={12} />
                    {t('充值 / 套餐')}
                  </span>
                  <span
                    className='nx-jump'
                    onClick={() => window.open(docsUrl, '_blank')}
                  >
                    <BookOpen size={12} />
                    {t('打开文档')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* tmux 状态栏 */}
          <div className='nx-statusbar nx-rise nx-d6'>
            <div className='nx-sb-seg nx-sb-brand'>SYNAI996</div>
            <div className='nx-sb-seg nx-sb-uptime'>
              <span className='nx-sb-label'>{t('已稳定运行')}</span>
              <span className='nx-sb-num'>
                {String(uptimeText.d).padStart(3, '0')}
                <small> {t('天')} </small>
                {String(uptimeText.h).padStart(2, '0')}:
                {String(uptimeText.m).padStart(2, '0')}:
                {String(uptimeText.s).padStart(2, '0')}
              </span>
            </div>
            <div className='nx-sb-seg nx-sb-status'>
              <span className='nx-sb-label'>status</span>
              <span className='nx-sb-num hl'>● {t('正常运行')}</span>
            </div>
          </div>
        </div>

        {/* 厂商跑马灯 */}
        <div className='nx-ticker-wrap'>
          <div className='nx-ticker'>
            {tickerItems.map((item, i) => (
              <span key={`${item.key}-${i}`} className='nx-ticker-item'>
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ========== Features ========== */}
      <section className='nx-section'>
        <div className='nx-shell'>
          <div className='nx-section-head'>
            <div>
              <div className='nx-kicker'>
                <i>//</i> 01 · core_features
              </div>
              <h2 className='nx-h2'>{t('为开发场景优化的 API 网关')}</h2>
            </div>
            <p className='nx-section-desc'>
              {t('聚合常用模型，统一调用方式，减少多平台切换带来的额外开销。')}
            </p>
          </div>

          <div className='nx-feature-grid'>
            {FEATURE_ITEMS.map((item) => (
              <div className='nx-feature-card' key={item.key}>
                <div className='nx-feature-index'>{item.index}</div>
                <h3>{t(item.title)}</h3>
                <p>{t(item.description)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== Pricing ========== */}
      <section className='nx-section' id='pricing'>
        <div className='nx-shell'>
          <div className='nx-section-head'>
            <div>
              <div className='nx-kicker'>
                <i>$</i> cat billing.json
              </div>
              <h2 className='nx-h2'>{t('余额充值 1:1，按量透明计费')}</h2>
            </div>
            <div className='nx-actions' style={{ marginBottom: 0 }}>
              <button
                className='nx-btn nx-btn-primary nx-btn-sm'
                onClick={() => navigate('/console/topup')}
              >
                <ShoppingCart size={14} />
                {t('立即充值')}
              </button>
              <button
                className='nx-btn nx-btn-ghost nx-btn-sm'
                onClick={() => window.open(docsUrl, '_blank')}
              >
                <BookOpen size={14} />
                {t('查看教程')}
              </button>
            </div>
          </div>

          {/* 充值余额 —— 主推 */}
          <div className='nx-recharge'>
            <div className='nx-recharge-head'>
              <span>recharge-balance.json</span>
              <span className='tag'>{t('主推 · 按量计费')}</span>
            </div>
            <div className='nx-recharge-body'>
              <div className='nx-recharge-main'>
                <h3>{t('充值余额，用多少扣多少')}</h3>
                <p>
                  {t(
                    '充值金额 1:1 到账，调用时按「模型定价 × 分组倍率」实时结算，无固定周期、不用担心额度过期。',
                  )}
                </p>
                <div className='nx-ratio-row'>
                  <span className='nx-ratio'>1 : 1</span>
                  <span className='nx-ratio-desc'>{t('充值比例，实付即所得')}</span>
                </div>
                <div className='nx-formula'>
                  <span className='k'>实际扣费</span>
                  <span className='op'> = </span>
                  <span className='v'>模型定价</span>
                  <span className='op'> × </span>
                  <span className='v'>用量</span>
                  <span className='op'> × </span>
                  <span className='hl'>分组倍率</span>
                </div>
                <div className='nx-actions' style={{ marginBottom: 0 }}>
                  <button
                    className='nx-btn nx-btn-primary nx-btn-sm'
                    onClick={() => navigate('/console/topup')}
                  >
                    <ShoppingCart size={14} />
                    {t('立即充值')}
                  </button>
                  <button
                    className='nx-btn nx-btn-ghost nx-btn-sm'
                    onClick={() => navigate('/pricing')}
                  >
                    <FileText size={14} />
                    {t('查看模型定价与倍率')}
                  </button>
                </div>
              </div>
              <div className='nx-recharge-steps'>
                <div className='nx-rstep'>
                  <div className='nx-rstep-idx'>01</div>
                  <div>
                    <h4>{t('充值到账')}</h4>
                    <p>{t('1:1 到账余额，支持多种支付方式。')}</p>
                  </div>
                </div>
                <div className='nx-rstep'>
                  <div className='nx-rstep-idx'>02</div>
                  <div>
                    <h4>{t('自由调用')}</h4>
                    <p>{t('全模型可用，Claude / GPT / Gemini 一个 Key 通吃。')}</p>
                  </div>
                </div>
                <div className='nx-rstep'>
                  <div className='nx-rstep-idx'>03</div>
                  <div>
                    <h4>{t('透明扣费')}</h4>
                    <p>{t('按模型定价 × 分组倍率实时结算，账单可查。')}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 订阅套餐 —— 可选 */}
          <div className='nx-subhead'>
            <h3>{t('订阅套餐（可选）')}</h3>
            <span>{t('需要固定每日额度时可选择订阅，按套餐规则重置。')}</span>
          </div>

          {plansLoading ? (
            <div className='nx-pricing-loading'>
              <Spin size='large' />
            </div>
          ) : (
            <div className='nx-plans-grid'>
              {planCards.map(({ plan, type }) => {
                const totalAmount = Number(plan?.total_amount || 0);
                // 额度标签必须跟随套餐真实的重置周期。
                // 后端取值：daily / weekly / monthly / custom / never，
                // 原实现只判断了 daily 与 never，其余（含月卡常用的 weekly）
                // 都掉进兜底分支被写死成「每日额度」，导致每周重置的月卡
                // 在首页显示成每日额度。
                const quotaLabelMap = {
                  daily: t('每日额度'),
                  weekly: t('每周额度'),
                  monthly: t('每月额度'),
                  custom: t('周期额度'),
                };
                const quotaLabel =
                  quotaLabelMap[plan?.quota_reset_period] || t('总额度');
                return (
                  <article
                    className={`nx-plan-card ${type === 'week' ? 'highlight' : ''}`}
                    key={plan.id}
                  >
                    <div className='nx-plan-file'>
                      <span>{PLAN_FILE_NAMES[type] || PLAN_FILE_NAMES.other}</span>
                      <span className='tag'>
                        {type === 'week'
                          ? t('热门方案')
                          : type === 'gpt_month'
                            ? t('推荐月卡')
                            : type === 'recharge'
                              ? t('灵活补充')
                              : t('订阅方案')}
                      </span>
                    </div>
                    <div className='nx-plan-body'>
                      <h3>{plan?.title || t('订阅套餐')}</h3>
                      <p className='nx-plan-sub'>
                        {plan?.subtitle ||
                          t('按不同使用阶段提供更清晰的额度与重置规则。')}
                      </p>
                      <div className='nx-price-row'>
                        <div className='nx-price'>
                          ¥{Number(plan?.price_amount || 0).toFixed(2)}
                        </div>
                        <div className='nx-price-unit'>
                          /{formatSubscriptionDuration(plan, t)}
                        </div>
                      </div>
                      <div className='nx-plan-meta'>
                        <div className='nx-meta-line'>
                          <span className='k'>"{quotaLabel}"</span>
                          <span className='v'>
                            {totalAmount > 0
                              ? renderQuota(totalAmount)
                              : t('无限制')}
                          </span>
                        </div>
                        <div className='nx-meta-line'>
                          <span className='k'>"{t('重置')}"</span>
                          <span className='v'>
                            {formatSubscriptionResetPeriod(plan, t)}
                          </span>
                        </div>
                        <div className='nx-meta-line'>
                          <span className='k'>"{t('购买上限')}"</span>
                          <span className='v'>
                            {plan?.max_purchase_per_user > 0
                              ? plan.max_purchase_per_user
                              : t('不限')}
                          </span>
                        </div>
                        {plan?.upgrade_group && (
                          <div className='nx-meta-line'>
                            <span className='k'>"{t('升级分组')}"</span>
                            <span className='v'>{plan.upgrade_group}</span>
                          </div>
                        )}
                      </div>
                      <div className='nx-plan-foot'>
                        <div className='nx-plan-note'>
                          {t('以后台实际配置为准')}
                        </div>
                        <button
                          className='nx-btn nx-btn-primary nx-btn-sm'
                          onClick={() => navigate('/console/topup')}
                        >
                          <ShoppingCart size={13} />
                          {t('立即购买')}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}

              {!planCards.length && (
                <div className='nx-pricing-empty'>
                  <h3>{t('暂未配置可展示套餐')}</h3>
                  <p>{t('你可以先进入控制台查看充值页，或稍后再回来。')}</p>
                  <button
                    className='nx-btn nx-btn-primary'
                    onClick={() => navigate('/console/topup')}
                  >
                    {t('前往购买页')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ========== Quick Start ========== */}
      <section className='nx-section' id='quick-start'>
        <div className='nx-shell'>
          <div className='nx-section-head'>
            <div>
              <div className='nx-kicker'>
                <i>//</i> 02 · quick_start
              </div>
              <h2 className='nx-h2'>{t('三步完成接入，即刻开始开发')}</h2>
            </div>
            <p className='nx-section-desc'>
              {t('根据你使用的工具选择对应教程，配置环境变量后即可开始调用。')}
            </p>
          </div>

          <div className='nx-editor'>
            <div className='nx-editor-tabs'>
              {TUTORIAL_ITEMS.map((item) => (
                <button
                  type='button'
                  key={item.key}
                  className={`nx-editor-tab ${activeTutorial === item.key ? 'active' : ''}`}
                  onClick={() => setActiveTutorial(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {activeTutorialItem && (
              <div className='nx-editor-body'>
                {/* 左：说明 + 步骤 */}
                <div className='nx-steps-pane'>
                  <h3 className='nx-tool-title'>{t(activeTutorialItem.title)}</h3>
                  <p className='nx-tool-desc'>
                    {t(activeTutorialItem.description)}
                  </p>
                  <div className='nx-badge-row'>
                    {activeTutorialItem.badges.map((badge) => (
                      <span key={badge} className='nx-tool-badge'>
                        {badge}
                      </span>
                    ))}
                  </div>

                  <div className='nx-steps'>
                    {activeTutorialItem.steps.map((item) => (
                      <div className='nx-step' key={item.step}>
                        <div className='nx-step-idx'>{item.step}</div>
                        <h4>{t(item.title)}</h4>
                        <p>{t(item.description)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 右：代码面板 */}
                <div className='nx-code-pane'>
                  <div className='nx-code-head'>
                    <span>{activeTutorialItem.toolName}</span>
                    <span className='lang'>{activeTutorialItem.lang}</span>
                  </div>
                  <div className='nx-code-scroll'>
                    {activeTutorialItem.snippet.split('\n').map((line, i) => (
                      <div className='nx-code-line' key={i}>
                        <span className='nx-code-ln'>{i + 1}</span>
                        <span className='nx-code-text'>{line || ' '}</span>
                      </div>
                    ))}
                  </div>
                  <div className='nx-code-actions'>
                    <button
                      className='nx-mini-btn nx-mini-btn-primary'
                      onClick={() => handleCopySnippet(activeTutorialItem.snippet)}
                    >
                      <Copy size={12} />
                      {t('复制配置')}
                    </button>
                    <button
                      className='nx-mini-btn'
                      onClick={() => navigate('/console/token')}
                    >
                      <KeyRound size={12} />
                      {t('创建 API Key')}
                    </button>
                    <button
                      className='nx-mini-btn'
                      onClick={() => window.open(docsUrl, '_blank')}
                    >
                      {t('打开完整文档')}
                    </button>
                    <button className='nx-mini-btn' onClick={scrollToPricing}>
                      {t('查看套餐')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ========== 页脚 ========== */}
      <footer className='nx-footer'>
        <div className='nx-shell'>
          <div className='nx-footer-inner'>
            <span>synai996 © {new Date().getFullYear()} — all systems nominal</span>
            <a
              href='https://check.synai996.space'
              target='_blank'
              rel='noopener noreferrer'
            >
              status.monitor ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
