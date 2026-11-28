/*
本站：Cloudflare Turnstile 人机验证框（替代 react-turnstile）
- react-turnstile 的脚本加载失败一次就永久停在「加载中」、不再重试，只能整页刷新；也没有超时，页面一片空白。
  国内到 challenges.cloudflare.com 丢包时，用户看到的就是「人机验证不显示、无法登录」。
- 这里全站共用一个加载器：10 秒超时、失败自动重试 1 次、之后给「重新加载」按钮；脚本晚到也会自动恢复。
- 验证出错显示错误码；token 过期 / 交互超时由 Turnstile 自动刷新，同时通知外层清掉旧 token。
- 外层仍用 key 重新挂载来换新 token（每个 token 只能用一次）。
*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import '../auth/auth-polish.css';

const { Text } = Typography;

const ONLOAD_CALLBACK = '__synaiTurnstileOnLoad';
const SCRIPT_BASE =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=';
const SCRIPT_ATTR = 'data-synai-turnstile';
const LOAD_TIMEOUT_MS = 10000;
const AUTO_RETRIES = 1;
const STALL_HINT_MS = 15000;

let loadPromise = null;
let loadAttempt = 0;
let finishPending = null;
const readyListeners = new Set();

function turnstileReady() {
  return typeof window !== 'undefined' && !!window.turnstile?.render;
}

// 每次加载的 onload 回调都指向这里：无论哪一次的脚本先到，都结束当前等待，
// 并通知还停在「重试中 / 加载失败」的验证框（超时后脚本才到也能自动恢复）。
function handleScriptLoaded() {
  finishPending?.();
  readyListeners.forEach((fn) => fn());
}

// 加载 api.js；失败或超时会 reject，并清空缓存的 promise，下次调用会重新插入脚本。
export function loadTurnstile() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('no window'));
  }
  if (turnstileReady()) return Promise.resolve(window.turnstile);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finishPending = null;
      if (err) {
        loadPromise = null;
        reject(err);
      } else {
        resolve(window.turnstile);
      }
    };
    finishPending = () => finish();
    // 上一次失败的脚本标签先移除。重试要换一个网址：同一网址的请求还卡着时，
    // 浏览器会把新脚本并到那个请求上，等于没重试（实测）。所以每次用不同的 onload 回调名。
    document
      .querySelectorAll(`script[${SCRIPT_ATTR}]`)
      .forEach((el) => el.remove());
    loadAttempt += 1;
    const callbackName =
      loadAttempt === 1 ? ONLOAD_CALLBACK : `${ONLOAD_CALLBACK}${loadAttempt}`;
    window[callbackName] = handleScriptLoaded;
    const script = document.createElement('script');
    script.src = SCRIPT_BASE + callbackName;
    script.async = true;
    script.defer = true;
    script.setAttribute(SCRIPT_ATTR, '1');
    script.addEventListener('error', () => finish(new Error('load error')));
    const timer = setTimeout(
      () => finish(new Error('load timeout')),
      LOAD_TIMEOUT_MS,
    );
    document.head.appendChild(script);
  });
  return loadPromise;
}

const CloudflareBrandMark = () => (
  <div className='synai-cf-badge'>
    <span className='synai-cf-logo-row'>
      <svg width='22' height='12' viewBox='0 0 48 24' aria-hidden='true'>
        <path
          d='M35.8 18.8H11.4c-3.8 0-6.9-3-6.9-6.7 0-3.3 2.5-6.1 5.8-6.6C11.6 2.3 15 0 19.1 0c4.8 0 8.8 3.4 9.6 7.9.9-.4 1.9-.6 2.9-.6 3.7 0 6.8 2.8 7.1 6.4 2.7.4 4.8 2.6 4.8 5.1 0 0-.2 0-7.7 0z'
          fill='#F38020'
        />
        <path
          d='M39.5 18.8H26.4c.7-2.6 3.1-4.5 6-4.5 1 0 2 .2 2.8.7.6-1.9 2.4-3.3 4.5-3.3 2.6 0 4.8 2.1 4.8 4.7 0 .9-.3 1.8-.8 2.4h-4.2z'
          fill='#FAAE40'
        />
      </svg>
      <span className='synai-cf-wordmark'>CLOUDFLARE</span>
    </span>
    <span className='synai-cf-legal'>Turnstile · Privacy</span>
  </div>
);

/**
 * @param {string} sitekey
 * @param {(token: string) => void} onVerify 拿到 token
 * @param {() => void} [onExpire] token 失效（过期 / 交互超时 / 出错），外层应清空旧 token
 */
const TurnstileWidget = ({ sitekey, onVerify, onExpire, className = '' }) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacksRef = useRef({ onVerify, onExpire });
  callbacksRef.current = { onVerify, onExpire };

  // loading | retrying | failed | ready
  const [phase, setPhase] = useState(turnstileReady() ? 'ready' : 'loading');
  const [errorCode, setErrorCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [renderSeq, setRenderSeq] = useState(0);

  const load = useCallback(async (retriesLeft) => {
    try {
      await loadTurnstile();
      setPhase('ready');
    } catch {
      // 重试期间上一次的脚本晚到了：已经能用，不算失败。
      if (turnstileReady()) {
        setPhase('ready');
        return;
      }
      if (retriesLeft > 0) {
        setPhase('retrying');
        return load(retriesLeft - 1);
      }
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
    if (phase === 'loading') load(AUTO_RETRIES);
    // 只在挂载时自动加载；之后由「重新加载」按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 停在失败状态时，如果脚本晚到了，直接恢复。
  useEffect(() => {
    if (phase !== 'failed' && phase !== 'retrying') return undefined;
    const onReady = () => setPhase('ready');
    readyListeners.add(onReady);
    if (turnstileReady()) onReady();
    return () => readyListeners.delete(onReady);
  }, [phase]);

  // 脚本就绪后渲染验证框；renderSeq 变化（重新加载）时重新渲染。
  useEffect(() => {
    if (phase !== 'ready' || !sitekey || !containerRef.current) {
      return undefined;
    }
    const ts = window.turnstile;
    setErrorCode('');
    setVerified(false);
    setInteractive(false);
    setStalled(false);
    let id = null;
    try {
      id = ts.render(containerRef.current, {
        sitekey,
        retry: 'auto',
        'retry-interval': 3000,
        'refresh-expired': 'auto',
        'refresh-timeout': 'auto',
        callback: (token) => {
          setErrorCode('');
          setVerified(true);
          setStalled(false);
          callbacksRef.current.onVerify?.(token);
        },
        'expired-callback': () => {
          setVerified(false);
          callbacksRef.current.onExpire?.();
        },
        'timeout-callback': () => {
          setVerified(false);
          callbacksRef.current.onExpire?.();
        },
        'error-callback': (code) => {
          setVerified(false);
          setErrorCode(String(code || 'unknown'));
          callbacksRef.current.onExpire?.();
          return true;
        },
        'before-interactive-callback': () => setInteractive(true),
      });
      widgetIdRef.current = id;
    } catch {
      setErrorCode('render');
    }
    const stallTimer = setTimeout(() => setStalled(true), STALL_HINT_MS);
    return () => {
      clearTimeout(stallTimer);
      if (id != null) {
        try {
          ts.remove(id);
        } catch {
          // 已被移除
        }
      }
      widgetIdRef.current = null;
    };
  }, [phase, sitekey, renderSeq]);

  const reload = () => {
    callbacksRef.current.onExpire?.();
    if (turnstileReady()) {
      setPhase('ready');
      setRenderSeq((v) => v + 1);
      return;
    }
    setPhase('loading');
    load(0);
  };

  const showStallHint =
    phase === 'ready' && stalled && !verified && !interactive && !errorCode;

  return (
    <div className={`synai-ts-wrap ${className}`}>
      {phase === 'ready' && (
        <div className='synai-ts-ready-wrap'>
          <div ref={containerRef} />
        </div>
      )}

      {(phase === 'loading' || phase === 'retrying') && (
        <div className='synai-ts-shell is-loading' role='status' aria-live='polite'>
          <div className='synai-ts-left'>
            <span className='synai-ts-orb-spin' aria-hidden='true' />
            <div className='synai-ts-copy'>
              <span className='synai-ts-title'>
                {phase === 'loading'
                  ? t('正在加载人机验证…')
                  : t('人机验证加载较慢，正在重试…')}
              </span>
              <span className='synai-ts-sub'>
                {t('自动校验环境，通常仅需 1–2 秒')}
              </span>
            </div>
          </div>
          <div className='synai-ts-right'>
            <CloudflareBrandMark />
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className='synai-ts-shell is-failed' role='alert'>
          <div className='synai-ts-left'>
            <span className='synai-ts-warn-icon' aria-hidden='true'>
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2.5'
                strokeLinecap='round'
              >
                <path d='M12 8v5m0 4h.01' />
              </svg>
            </span>
            <div className='synai-ts-copy'>
              <span className='synai-ts-title'>{t('人机验证加载失败')}</span>
              <span className='synai-ts-sub'>
                {t(
                  '可能是当前网络无法访问 Cloudflare，或被浏览器插件拦截。请点击重新加载，或更换网络后再试。',
                )}
              </span>
            </div>
          </div>
          <div className='synai-ts-failed-actions'>
            <CloudflareBrandMark />
            <button
              type='button'
              className='synai-ts-retry-btn'
              onClick={reload}
            >
              {t('重新加载')}
            </button>
          </div>
        </div>
      )}

      {phase === 'ready' && (errorCode || showStallHint) && (
        <div className='synai-ts-stall-bar'>
          <Text type={errorCode ? 'warning' : 'tertiary'} size='small'>
            {errorCode
              ? t('人机验证出错（错误码 {{code}}）', { code: errorCode })
              : t('验证框没有出现或一直在转圈？')}
          </Text>
          <Button size='small' theme='borderless' onClick={reload}>
            {t('重新加载')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default TurnstileWidget;
