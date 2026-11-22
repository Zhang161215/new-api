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

import React from 'react';
import { SideSheet } from '@douyinfe/semi-ui';
import { IconClose } from '@douyinfe/semi-icons';

import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import ModelSquareDetail from './components/ModelSquareDetail';

const ModelDetailSideSheet = ({
  visible,
  onClose,
  modelData,
  groupRatio,
  currency,
  siteDisplayType,
  tokenUnit,
  displayPrice,
  usableGroup,
  endpointMap,
  autoGroups,
  t,
}) => {
  const isMobile = useIsMobile();

  return (
    <SideSheet
      placement='right'
      title={null}
      headerStyle={{
        justifyContent: 'flex-end',
        padding: '12px 16px 0',
        borderBottom: 0,
      }}
      bodyStyle={{
        padding: '0 24px 28px',
      }}
      maskStyle={{
        background: 'rgba(15, 23, 42, 0.12)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      visible={visible}
      width={isMobile ? '100%' : 900}
      closeIcon={<IconClose />}
      onCancel={onClose}
    >
      <ModelSquareDetail
        modelData={modelData}
        groupRatio={groupRatio}
        currency={currency}
        siteDisplayType={siteDisplayType}
        tokenUnit={tokenUnit}
        displayPrice={displayPrice}
        usableGroup={usableGroup}
        endpointMap={endpointMap}
        autoGroups={autoGroups}
        t={t}
      />
    </SideSheet>
  );
};

export default ModelDetailSideSheet;
