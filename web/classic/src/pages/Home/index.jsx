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

import React, { useContext, useEffect, useState } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import { API, getSystemName, showError } from '../../helpers';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { StatusContext } from '../../context/Status';
import { marked } from 'marked';
import NoticeModal from '../../components/layout/NoticeModal';
import ScrollHome from './scroll/ScrollHome';

const isLocalPreview = ['localhost', '127.0.0.1'].includes(
  typeof window === 'undefined' ? '' : window.location.hostname,
);

const Home = () => {
  const [statusState] = useContext(StatusContext);
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(isLocalPreview);
  const [homePageContent, setHomePageContent] = useState('');
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [noticeHtml, setNoticeHtml] = useState('');
  const isMobile = useIsMobile();
  const docsLink = statusState?.status?.docs_link || '';
  const docsUrl = docsLink || 'https://doc.synai996.space/';
  const serverAddress =
    statusState?.status?.server_address || `${window.location.origin}`;

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    try {
      const res = await API.get('/api/home_page_content');
      const { success, message, data } = res.data;
      if (success) {
        let content = data;
        if (data && !data.startsWith('https://')) {
          content = marked.parse(data);
        }
        setHomePageContent(content || '');
        localStorage.setItem('home_page_content', content || '');
      } else if (message) {
        showError(message);
      }
    } catch (error) {
      // 自定义首页拉不到时走新设计，不阻断本地预览
    }
    setHomePageContentLoaded(true);
  };

  useEffect(() => {
    const checkNoticeAndShow = async () => {
      const lastCloseDate = localStorage.getItem('notice_close_date');
      const today = new Date().toDateString();
      if (lastCloseDate !== today) {
        try {
          const res = await API.get('/api/notice');
          const { success, data } = res.data;
          if (success && data && data.trim() !== '') {
            setNoticeHtml(marked.parse(data));
            setNoticeVisible(true);
          }
        } catch (error) {
          console.error('获取公告失败:', error);
        }
      }
    };

    checkNoticeAndShow();
    if (isLocalPreview) {
      setHomePageContentLoaded(true);
    } else {
      displayHomePageContent().then();
    }
  }, []);

  if (!homePageContentLoaded) {
    return (
      <div className='w-full min-h-[60vh] flex items-center justify-center'>
        <Spin size='large' />
      </div>
    );
  }

  if (homePageContent && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
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
    <>
      <NoticeModal
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        isMobile={isMobile}
        initialContent={noticeHtml}
      />
      <ScrollHome
        docsUrl={docsUrl}
        siteUrl={`${serverAddress.replace(/\/$/, '')}/`}
        systemName={statusState?.status?.system_name || getSystemName()}
      />
    </>
  );
};

export default Home;
