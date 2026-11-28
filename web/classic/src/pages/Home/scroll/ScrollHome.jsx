import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSystemName } from '../../../helpers';
import { SCROLL_HOME_MARKUP } from './markup';
import { mountScrollHome } from './engine';
import './home-scroll.css';

// React 19 只要 dangerouslySetInnerHTML 换了新对象就会重写 innerHTML。
// 父组件一重渲染，engine 挂好的翻牌、事件监听就全被冲掉，所以这个对象必须固定。
const SCROLL_HOME_HTML = { __html: SCROLL_HOME_MARKUP };

const ScrollHome = ({ docsUrl, siteUrl, systemName }) => {
  const hostRef = useRef(null);
  const navigate = useNavigate();
  const displayName = systemName || getSystemName() || 'Synai996';

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('sx-home-page');
    body.classList.add('sx-home-active', 'nx-home-active');
    let stop = () => {};
    try {
      stop =
        mountScrollHome(hostRef.current, {
          launchedAt: '2025-12-03T00:00:00+08:00',
          siteUrl: 'https://synai996.space/',
          apiBaseUrl: siteUrl || `${window.location.origin}/`,
          startUrl: '/console',
          rechargeUrl: '/console/topup',
          subscriptionUrl: '/console/topup',
          pricingUrl: '/pricing',
          tutorialUrl: docsUrl || 'https://doc.synai996.space/',
          logo: '/synai-logo.png',
          systemName: displayName === 'New API' ? 'Synai996' : displayName,
          showDemoSettings: false,
          navigate: (url) => navigate(url),
        }) || (() => {});
    } catch (error) {
      console.error('scroll home init failed', error);
    }
    return () => {
      stop?.();
      html.classList.remove('sx-home-page');
      body.classList.remove('sx-home-active', 'nx-home-active');
    };
  }, [displayName, docsUrl, navigate, siteUrl]);

  return (
    <div
      className='sx-home'
      ref={hostRef}
      dangerouslySetInnerHTML={SCROLL_HOME_HTML}
    />
  );
};

export default ScrollHome;
