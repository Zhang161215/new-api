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
import { Tabs, TabPane } from '@douyinfe/semi-ui';
import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';
import { getRelativeTime } from '../../helpers';
import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import { useActualTheme } from '../../context/Theme';

import ApiInfoPanel from './ApiInfoPanel';
import AnnouncementsPanel from './AnnouncementsPanel';
import FaqPanel from './FaqPanel';
import UptimePanel from './UptimePanel';
import RangeBar from './RangeBar';
import OverviewTab from './OverviewTab';
import UsageTab from './UsageTab';
import ModelTab from './ModelTab';
import UserTab from './UserTab';

import { useDashboardData } from '../../hooks/dashboard/useDashboardData';
import { useDashboardQuery } from '../../hooks/dashboard/useDashboardQuery';

import {
  CARD_PROPS,
  FLEX_CENTER_GAP2,
  ILLUSTRATION_SIZE,
  ANNOUNCEMENT_LEGEND_DATA,
  UPTIME_STATUS_MAP,
} from '../../constants/dashboard.constants';
import {
  handleCopyUrl,
  handleSpeedTest,
  getUptimeStatusColor,
  getUptimeStatusText,
  renderMonitorList,
} from '../../helpers/dashboard';

const TAB_KEY = 'dashboard_tab';
const TABS = ['overview', 'usage', 'models', 'users'];

const Dashboard = () => {
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);
  const theme = useActualTheme();

  const shell = useDashboardData(userState, userDispatch, statusState);
  const { t, isAdminUser } = shell;

  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.includes(saved) ? saved : 'overview';
  });
  const activeTab = tab === 'users' && !isAdminUser ? 'overview' : tab;
  const dash = useDashboardQuery({
    isAdminUser,
    enabled: activeTab !== 'overview',
  });
  const changeTab = (key) => {
    setTab(key);
    localStorage.setItem(TAB_KEY, key);
  };

  useEffect(() => {
    initVChartSemiTheme({ isWatchingThemeSwitch: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (shell.uptimeEnabled) {
      shell.loadUptimeData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.uptimeEnabled]);

  // ========== 总览面板数据 ==========
  const apiInfoData = statusState?.status?.api_info || [];
  const announcementData = (statusState?.status?.announcements || []).map(
    (item) => {
      const pubDate = item?.publishDate ? new Date(item.publishDate) : null;
      const absoluteTime =
        pubDate && !isNaN(pubDate.getTime())
          ? `${pubDate.getFullYear()}-${String(pubDate.getMonth() + 1).padStart(2, '0')}-${String(pubDate.getDate()).padStart(2, '0')} ${String(pubDate.getHours()).padStart(2, '0')}:${String(pubDate.getMinutes()).padStart(2, '0')}`
          : item?.publishDate || '';
      return {
        ...item,
        time: absoluteTime,
        relative: getRelativeTime(item.publishDate),
      };
    },
  );
  const faqData = statusState?.status?.faq || [];
  const uptimeLegendData = Object.entries(UPTIME_STATUS_MAP).map(
    ([status, info]) => ({
      status: Number(status),
      color: info.color,
      label: t(info.label),
    }),
  );

  const apiInfoPanel = shell.hasApiInfoPanel ? (
    <ApiInfoPanel
      apiInfoData={apiInfoData}
      handleCopyUrl={(url) => handleCopyUrl(url, t)}
      handleSpeedTest={handleSpeedTest}
      CARD_PROPS={CARD_PROPS}
      FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
      ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
      t={t}
    />
  ) : null;

  const enabledInfoCount =
    (shell.announcementsEnabled ? 1 : 0) +
    (shell.faqEnabled ? 1 : 0) +
    (shell.uptimeEnabled ? 1 : 0);
  const infoGridClass =
    enabledInfoCount <= 1
      ? 'grid grid-cols-1 gap-4'
      : enabledInfoCount === 2
        ? shell.announcementsEnabled
          ? 'grid grid-cols-1 lg:grid-cols-3 gap-4'
          : 'grid grid-cols-1 lg:grid-cols-2 gap-4'
        : 'grid grid-cols-1 lg:grid-cols-4 gap-4';
  const announcementsSpan =
    enabledInfoCount === 1 ? 'lg:col-span-1' : 'lg:col-span-2';
  const sidePanelSpan = 'lg:col-span-1';

  const infoPanels = shell.hasInfoPanels ? (
    <div className={infoGridClass}>
      {shell.announcementsEnabled && (
        <AnnouncementsPanel
          announcementData={announcementData}
          announcementLegendData={ANNOUNCEMENT_LEGEND_DATA.map((item) => ({
            ...item,
            label: t(item.label),
          }))}
          CARD_PROPS={CARD_PROPS}
          ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
          spanClassName={announcementsSpan}
          t={t}
        />
      )}
      {shell.faqEnabled && (
        <FaqPanel
          faqData={faqData}
          CARD_PROPS={CARD_PROPS}
          FLEX_CENTER_GAP2={FLEX_CENTER_GAP2}
          ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
          spanClassName={sidePanelSpan}
          t={t}
        />
      )}
      {shell.uptimeEnabled && (
        <UptimePanel
          uptimeData={shell.uptimeData}
          uptimeLoading={shell.uptimeLoading}
          activeUptimeTab={shell.activeUptimeTab}
          setActiveUptimeTab={shell.setActiveUptimeTab}
          loadUptimeData={shell.loadUptimeData}
          uptimeLegendData={uptimeLegendData}
          renderMonitorList={(monitors) =>
            renderMonitorList(
              monitors,
              (status) => getUptimeStatusColor(status, UPTIME_STATUS_MAP),
              (status) => getUptimeStatusText(status, UPTIME_STATUS_MAP, t),
              t,
            )
          }
          CARD_PROPS={CARD_PROPS}
          ILLUSTRATION_SIZE={ILLUSTRATION_SIZE}
          spanClassName={sidePanelSpan}
          t={t}
        />
      )}
    </div>
  ) : null;

  const viewProps = {
    data: dash.quotaData,
    buckets: dash.buckets,
    granularity: dash.query.granularity,
    rangeMinutes: dash.rangeMinutes,
    loading: dash.loading,
    loaded: dash.loaded,
    theme,
    t,
  };

  return (
    <div className='h-full'>
      <div className='mb-2 flex items-center justify-between'>
        <h2
          className='text-2xl font-semibold text-semi-color-text-0 transition-opacity duration-1000 ease-in-out'
          style={{ opacity: shell.greetingVisible ? 1 : 0 }}
        >
          {shell.getGreeting}
        </h2>
      </div>

      <Tabs
        type='line'
        activeKey={activeTab}
        onChange={changeTab}
        className='mb-3'
        lazyRender
      >
        <TabPane tab={t('总览')} itemKey='overview' />
        <TabPane tab={t('用量')} itemKey='usage' />
        <TabPane tab={t('模型调用分析')} itemKey='models' />
        {isAdminUser && <TabPane tab={t('用户分析')} itemKey='users' />}
      </Tabs>

      {activeTab !== 'overview' && (
        <RangeBar
          query={dash.query}
          isAdminUser={isAdminUser}
          loading={dash.loading || dash.userLoading}
          onPreset={dash.applyPreset}
          onCustom={dash.applyCustom}
          onRefresh={dash.refresh}
          isMobile={shell.isMobile}
          t={t}
        />
      )}

      <div className='mb-4'>
        {activeTab === 'overview' && (
          <OverviewTab
            user={userState?.user}
            theme={theme}
            onOpenUsage={() => changeTab('usage')}
            onRefreshUser={shell.getUserData}
            aside={apiInfoPanel}
            t={t}
          >
            {infoPanels}
          </OverviewTab>
        )}
        {activeTab === 'usage' && <UsageTab {...viewProps} />}
        {activeTab === 'models' && <ModelTab {...viewProps} />}
        {activeTab === 'users' && isAdminUser && (
          <UserTab
            {...viewProps}
            data={dash.userData}
            loading={dash.userLoading}
            ensureUsers={dash.ensureUsers}
            onSelectUser={(username) => {
              dash.applyCustom({ username, preset: dash.query.preset });
              changeTab('usage');
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Dashboard;
