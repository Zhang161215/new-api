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
import {
  Modal,
  Button,
  Input,
  Table,
  Tag,
  Typography,
  Switch,
  Banner,
  Spin,
} from '@douyinfe/semi-ui';
import { IconSearch, IconInfoCircle } from '@douyinfe/semi-icons';
import { copy, showError, showInfo, showSuccess } from '../../../../helpers';
import { MODEL_TABLE_PAGE_SIZE } from '../../../../constants';
import { getTokenTestModels } from '../../../../helpers/tokenTest';

const TokenModelTestModal = ({
  showModelTestModal,
  currentTestToken,
  handleCloseModal,
  isBatchTesting,
  batchTestModels,
  modelSearchKeyword,
  setModelSearchKeyword,
  selectedModelKeys,
  setSelectedModelKeys,
  modelTestResults,
  testingModels,
  testToken,
  modelTablePage,
  setModelTablePage,
  isStreamTest,
  setIsStreamTest,
  allSelectingRef,
  tokenModels,
  tokenModelsLoading,
  isMobile,
  t,
}) => {
  const hasToken = Boolean(currentTestToken);
  const models = hasToken
    ? getTokenTestModels(currentTestToken, tokenModels)
    : [];
  const filteredModels = models.filter((model) =>
    model.toLowerCase().includes((modelSearchKeyword || '').toLowerCase()),
  );

  const handleCopySelected = () => {
    if (selectedModelKeys.length === 0) {
      showError(t('请先选择模型！'));
      return;
    }
    copy(selectedModelKeys.join(',')).then((ok) => {
      if (ok) {
        showSuccess(
          t('已复制 ${count} 个模型').replace(
            '${count}',
            selectedModelKeys.length,
          ),
        );
      } else {
        showError(t('复制失败，请手动复制'));
      }
    });
  };

  const handleSelectSuccess = () => {
    if (!currentTestToken) return;
    const successKeys = filteredModels.filter((m) => {
      const result = modelTestResults[`${currentTestToken.id}-${m}`];
      return result && result.success;
    });
    if (successKeys.length === 0) {
      showInfo(t('暂无成功模型'));
    }
    setSelectedModelKeys(successKeys);
  };

  const columns = [
    {
      title: t('模型名称'),
      dataIndex: 'model',
      render: (text) => (
        <div className='flex items-center'>
          <Typography.Text strong>{text}</Typography.Text>
        </div>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      render: (text, record) => {
        const testResult =
          modelTestResults[`${currentTestToken.id}-${record.model}`];
        const isTesting = testingModels.has(record.model);

        if (isTesting) {
          return (
            <Tag color='blue' shape='circle'>
              {t('测试中')}
            </Tag>
          );
        }

        if (!testResult) {
          return (
            <Tag color='grey' shape='circle'>
              {t('未开始')}
            </Tag>
          );
        }

        return (
          <div className='flex flex-col gap-1'>
            <div className='flex items-center gap-2'>
              <Tag color={testResult.success ? 'green' : 'red'} shape='circle'>
                {testResult.success ? t('成功') : t('失败')}
              </Tag>
              {testResult.success && (
                <Typography.Text type='tertiary'>
                  {t('请求时长: ${time}s').replace(
                    '${time}',
                    testResult.time.toFixed(2),
                  )}
                </Typography.Text>
              )}
            </div>
            {!testResult.success && testResult.message && (
              <Typography.Text
                type='danger'
                size='small'
                className='break-all'
                style={{ maxWidth: '400px', fontSize: '12px' }}
              >
                {testResult.message}
              </Typography.Text>
            )}
          </div>
        );
      },
    },
    {
      title: '',
      dataIndex: 'operate',
      render: (text, record) => {
        const isTesting = testingModels.has(record.model);
        return (
          <Button
            type='tertiary'
            onClick={() =>
              testToken(currentTestToken, record.model, isStreamTest)
            }
            loading={isTesting}
            size='small'
          >
            {t('测试')}
          </Button>
        );
      },
    },
  ];

  const dataSource = (() => {
    if (!hasToken) return [];
    const start = (modelTablePage - 1) * MODEL_TABLE_PAGE_SIZE;
    const end = start + MODEL_TABLE_PAGE_SIZE;
    return filteredModels.slice(start, end).map((model) => ({
      model,
      key: model,
    }));
  })();

  return (
    <Modal
      title={
        hasToken ? (
          <div className='flex flex-col gap-2 w-full'>
            <div className='flex items-center gap-2'>
              <Typography.Text
                strong
                className='!text-[var(--semi-color-text-0)] !text-base'
              >
                {currentTestToken.name} {t('令牌的模型测试')}
              </Typography.Text>
              <Typography.Text type='tertiary' size='small'>
                {currentTestToken.group
                  ? `${currentTestToken.group} · `
                  : ''}
                {tokenModelsLoading
                  ? t('加载中')
                  : `${t('共')} ${models.length} ${t('个模型')}`}
              </Typography.Text>
            </div>
          </div>
        ) : null
      }
      visible={showModelTestModal}
      onCancel={handleCloseModal}
      footer={
        hasToken ? (
          <div className='flex justify-end'>
            {isBatchTesting ? (
              <Button type='danger' onClick={handleCloseModal}>
                {t('停止测试')}
              </Button>
            ) : (
              <Button type='tertiary' onClick={handleCloseModal}>
                {t('取消')}
              </Button>
            )}
            <Button
              onClick={batchTestModels}
              loading={isBatchTesting}
              disabled={isBatchTesting || filteredModels.length === 0}
            >
              {isBatchTesting
                ? t('测试中...')
                : t('批量测试${count}个模型').replace(
                    '${count}',
                    filteredModels.length,
                  )}
            </Button>
          </div>
        ) : null
      }
      maskClosable={!isBatchTesting}
      className='!rounded-lg'
      size={isMobile ? 'full-width' : 'large'}
    >
      {hasToken && (
        <div className='model-test-scroll'>
          <div className='flex items-center justify-end gap-2 mb-2'>
            <Typography.Text strong className='shrink-0'>
              {t('流式')}:
            </Typography.Text>
            <Switch
              checked={isStreamTest}
              onChange={setIsStreamTest}
              size='small'
              aria-label={t('流式')}
            />
          </div>

          <Banner
            type='info'
            closeIcon={null}
            icon={<IconInfoCircle />}
            className='!rounded-lg mb-2'
            description={t(
              '只显示当前令牌分组可用的模型。走真实令牌请求，会消耗少量额度。默认流式。',
            )}
          />

          <div className='flex flex-col sm:flex-row sm:items-center gap-2 w-full mb-2'>
            <Input
              placeholder={t('搜索模型...')}
              value={modelSearchKeyword}
              onChange={(v) => {
                setModelSearchKeyword(v);
                setModelTablePage(1);
              }}
              className='!w-full sm:!flex-1'
              prefix={<IconSearch />}
              showClear
            />
            <div className='flex items-center justify-end gap-2'>
              <Button onClick={handleCopySelected}>{t('复制已选')}</Button>
              <Button type='tertiary' onClick={handleSelectSuccess}>
                {t('选择成功')}
              </Button>
            </div>
          </div>

          <Spin spinning={!!tokenModelsLoading}>
            <Table
              columns={columns}
              dataSource={dataSource}
              empty={
                tokenModelsLoading
                  ? t('正在加载该令牌可用模型…')
                  : t('该令牌当前没有可用模型')
              }
              rowSelection={{
                selectedRowKeys: selectedModelKeys,
                onChange: (keys) => {
                  if (allSelectingRef.current) {
                    allSelectingRef.current = false;
                    return;
                  }
                  setSelectedModelKeys(keys);
                },
                onSelectAll: (checked) => {
                  allSelectingRef.current = true;
                  setSelectedModelKeys(checked ? filteredModels : []);
                },
              }}
              pagination={{
                currentPage: modelTablePage,
                pageSize: MODEL_TABLE_PAGE_SIZE,
                total: filteredModels.length,
                showSizeChanger: false,
                onPageChange: (page) => setModelTablePage(page),
              }}
            />
          </Spin>
        </div>
      )}
    </Modal>
  );
};

export default TokenModelTestModal;
