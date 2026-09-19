import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSystemName } from '../../../helpers';
import { SCROLL_HOME_MARKUP } from './markup';
import { mountScrollHome } from './engine';
import './home-scroll.css';

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
          tutorialUrl: 'https://doc.synai996.space/',
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
      dangerouslySetInnerHTML={{ __html: SCROLL_HOME_MARKUP }}
    />
  );
};

export default ScrollHome;
