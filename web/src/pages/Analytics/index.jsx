import React, { useState } from 'react';
import { Tabs, TabPane } from '@douyinfe/semi-ui';
import { Card } from '@douyinfe/semi-ui';
import TopUsersTab from './TopUsersTab';
import TopTokensTab from './TopTokensTab';
import SharingRiskTab from './SharingRiskTab';
import InviteRiskTab from './InviteRiskTab';

const Analytics = () => {
  const [activeTab, setActiveTab] = useState('users');

  return (
    <div className='mt-[60px] px-2'>
      <Card className='!rounded-2xl'>
        <Tabs
          type='line'
          activeKey={activeTab}
          onChange={setActiveTab}
        >
          <TabPane tab='用量排行' itemKey='users'>
            <TopUsersTab />
          </TabPane>
          <TabPane tab='令牌排行' itemKey='tokens'>
            <TopTokensTab />
          </TabPane>
          <TabPane tab='共用风险' itemKey='risk'>
            <SharingRiskTab />
          </TabPane>
          <TabPane tab='邀请风控榜' itemKey='invite-risk'>
            <InviteRiskTab />
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
};

export default Analytics;
