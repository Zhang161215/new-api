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

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@douyinfe/semi-ui';
import {
  API,
  copy,
  showError,
  showSuccess,
  showInfo,
  encodeToBase64,
} from '../../helpers';
import { ITEMS_PER_PAGE } from '../../constants';
import { useTableCompactMode } from '../common/useTableCompactMode';
import {
  fetchTokenKey as fetchTokenKeyById,
  fetchTokenKeysBatch,
  getServerAddress,
  encodeChannelConnectionString,
} from '../../helpers/token';
import { getTokenTestModels, runTokenModelTest, fetchTokenEnabledModels } from '../../helpers/tokenTest';

export const useTokensData = (openFluentNotification, openCCSwitchModal) => {
  const { t } = useTranslation();

  // Basic state
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupRatios, setGroupRatios] = useState({});
  const [activePage, setActivePage] = useState(1);
  const [tokenCount, setTokenCount] = useState(0);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState(false); // 是否处于搜索结果视图

  // Selection state
  const [selectedKeys, setSelectedKeys] = useState([]);

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editingToken, setEditingToken] = useState({
    id: undefined,
  });

  // UI state
  const [compactMode, setCompactMode] = useTableCompactMode('tokens');
  const [showKeys, setShowKeys] = useState({});
  const [resolvedTokenKeys, setResolvedTokenKeys] = useState({});
  const [loadingTokenKeys, setLoadingTokenKeys] = useState({});
  const keyRequestsRef = useRef({});

  // Form state
  const [formApi, setFormApi] = useState(null);
  const [formInitValues] = useState({
    searchKeyword: '',
    searchToken: '',
  });

  const [tokenModelsMap, setTokenModelsMap] = useState({});
  const tokenModelsRef = useRef({});
  const groupModelsRef = useRef({});
  const pricingPromiseRef = useRef(null);
  const [tokenModelsLoading, setTokenModelsLoading] = useState(false);
  const [showModelTestModal, setShowModelTestModal] = useState(false);
  const [currentTestToken, setCurrentTestToken] = useState(null);
  const [modelSearchKeyword, setModelSearchKeyword] = useState('');
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModels, setTestingModels] = useState(new Set());
  const [selectedModelKeys, setSelectedModelKeys] = useState([]);
  const [isBatchTesting, setIsBatchTesting] = useState(false);
  const [modelTablePage, setModelTablePage] = useState(1);
  const [isStreamTest, setIsStreamTest] = useState(true);
  const allSelectingRef = useRef(false);
  const shouldStopBatchTestingRef = useRef(false);

  // Get form values helper function
  const getFormValues = () => {
    const formValues = formApi ? formApi.getValues() : {};
    return {
      searchKeyword: formValues.searchKeyword || '',
      searchToken: formValues.searchToken || '',
    };
  };

  // Close edit modal
  const closeEdit = () => {
    setShowEdit(false);
    setTimeout(() => {
      setEditingToken({
        id: undefined,
      });
    }, 500);
  };

  // Sync page data from API response
  const syncPageData = (payload) => {
    setTokens(payload.items || []);
    setTokenCount(payload.total || 0);
    setActivePage(payload.page || 1);
    setPageSize(payload.page_size || pageSize);
    setShowKeys({});
  };

  // Load tokens function
  const loadTokens = async (page = 1, size = pageSize) => {
    setLoading(true);
    setSearchMode(false);
    const res = await API.get(`/api/token/?p=${page}&size=${size}`);
    const { success, message, data } = res.data;
    if (success) {
      syncPageData(data);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  // Refresh function
  const refresh = async (page = activePage) => {
    await loadTokens(page);
    setSelectedKeys([]);
  };

  // Copy text function
  const copyText = async (text) => {
    if (await copy(text)) {
      showSuccess(t('已复制到剪贴板！'));
    } else {
      Modal.error({
        title: t('无法复制到剪贴板，请手动复制'),
        content: text,
        size: 'large',
      });
    }
  };

  const fetchTokenKey = async (tokenOrId, options = {}) => {
    const { suppressError = false } = options;
    const tokenId =
      typeof tokenOrId === 'object' ? tokenOrId?.id : Number(tokenOrId);

    if (!tokenId) {
      const error = new Error(t('令牌不存在'));
      if (!suppressError) {
        showError(error.message);
      }
      throw error;
    }

    if (resolvedTokenKeys[tokenId]) {
      return resolvedTokenKeys[tokenId];
    }

    if (keyRequestsRef.current[tokenId]) {
      return keyRequestsRef.current[tokenId];
    }

    const request = (async () => {
      setLoadingTokenKeys((prev) => ({ ...prev, [tokenId]: true }));
      try {
        const fullKey = await fetchTokenKeyById(tokenId);
        setResolvedTokenKeys((prev) => ({ ...prev, [tokenId]: fullKey }));
        return fullKey;
      } catch (error) {
        const normalizedError = new Error(
          error?.message || t('获取令牌密钥失败'),
        );
        if (!suppressError) {
          showError(normalizedError.message);
        }
        throw normalizedError;
      } finally {
        delete keyRequestsRef.current[tokenId];
        setLoadingTokenKeys((prev) => {
          const next = { ...prev };
          delete next[tokenId];
          return next;
        });
      }
    })();

    keyRequestsRef.current[tokenId] = request;
    return request;
  };

  const toggleTokenVisibility = async (record) => {
    const tokenId = record?.id;
    if (!tokenId) {
      return;
    }

    if (showKeys[tokenId]) {
      setShowKeys((prev) => ({ ...prev, [tokenId]: false }));
      return;
    }

    const fullKey = await fetchTokenKey(record);
    if (fullKey) {
      setShowKeys((prev) => ({ ...prev, [tokenId]: true }));
    }
  };

  const copyTokenKey = async (record) => {
    const fullKey = await fetchTokenKey(record);
    await copyText(`sk-${fullKey}`);
  };

  const copyTokenConnectionString = async (record) => {
    const fullKey = await fetchTokenKey(record);
    const serverUrl = getServerAddress();
    const connStr = encodeChannelConnectionString(`sk-${fullKey}`, serverUrl);
    await copyText(connStr);
  };

  // Open link function for chat integrations
  const onOpenLink = async (type, url, record) => {
    const fullKey = await fetchTokenKey(record);
    if (url && url.startsWith('ccswitch')) {
      openCCSwitchModal(fullKey, record?.name);
      return;
    }
    if (url && url.startsWith('fluent')) {
      openFluentNotification(fullKey);
      return;
    }
    let status = localStorage.getItem('status');
    let serverAddress = '';
    if (status) {
      status = JSON.parse(status);
      serverAddress = status.server_address;
    }
    if (serverAddress === '') {
      serverAddress = window.location.origin;
    }
    if (url.includes('{cherryConfig}') === true) {
      let cherryConfig = {
        id: 'new-api',
        baseUrl: serverAddress,
        apiKey: `sk-${fullKey}`,
      };
      let encodedConfig = encodeURIComponent(
        encodeToBase64(JSON.stringify(cherryConfig)),
      );
      url = url.replaceAll('{cherryConfig}', encodedConfig);
    } else if (url.includes('{aionuiConfig}') === true) {
      let aionuiConfig = {
        platform: 'new-api',
        baseUrl: serverAddress,
        apiKey: `sk-${fullKey}`,
      };
      let encodedConfig = encodeURIComponent(
        encodeToBase64(JSON.stringify(aionuiConfig)),
      );
      url = url.replaceAll('{aionuiConfig}', encodedConfig);
    } else {
      let encodedServerAddress = encodeURIComponent(serverAddress);
      url = url.replaceAll('{address}', encodedServerAddress);
      url = url.replaceAll('{key}', `sk-${fullKey}`);
    }

    window.open(url, '_blank');
  };

  const indexPricingModels = (pricing, autoGroups) => {
    const map = {};
    (pricing || []).forEach((m) => {
      const name = m.model_name;
      if (!name) return;
      (m.enable_groups || []).forEach((g) => {
        if (!map[g]) map[g] = [];
        map[g].push(name);
      });
    });
    if (Array.isArray(autoGroups) && autoGroups.length > 0) {
      const autoSet = new Set();
      autoGroups.forEach((g) => {
        (map[g] || []).forEach((name) => autoSet.add(name));
      });
      map.auto = Array.from(autoSet);
    }
    groupModelsRef.current = map;
  };

  const ensureGroupModels = () => {
    if (!pricingPromiseRef.current) {
      pricingPromiseRef.current = API.get('/api/pricing')
        .then((res) => {
          if (res.data?.success) {
            indexPricingModels(res.data.data, res.data.auto_groups);
          }
        })
        .catch(() => {
          pricingPromiseRef.current = null;
        });
    }
    return pricingPromiseRef.current;
  };

  const modelsFromGroupCache = (record) => {
    const group = record?.group || '';
    return groupModelsRef.current[group] || [];
  };

  const applyAndStoreTokenModels = (record, models) => {
    const filtered = getTokenTestModels(record, models);
    tokenModelsRef.current[record.id] = filtered;
    setTokenModelsMap({ ...tokenModelsRef.current });
    return filtered;
  };

  const loadTokenModels = async (record) => {
    const tokenId = record?.id;
    if (!tokenId) return [];
    if (tokenModelsRef.current[tokenId]?.length) {
      return tokenModelsRef.current[tokenId];
    }
    await ensureGroupModels();
    const fromGroup = modelsFromGroupCache(record);
    if (
      fromGroup.length > 0 ||
      (record.model_limits_enabled && record.model_limits)
    ) {
      return applyAndStoreTokenModels(record, fromGroup);
    }
    const apiKey = await fetchTokenKey(record);
    return applyAndStoreTokenModels(
      record,
      await fetchTokenEnabledModels(apiKey),
    );
  };

  const openTokenTest = async (record) => {
    if (!record) return;
    if (record.status !== 1) {
      showError(t('令牌未启用'));
      return;
    }
    setCurrentTestToken(record);
    setShowModelTestModal(true);
    const cached =
      tokenModelsRef.current[record.id] || modelsFromGroupCache(record);
    if (
      cached.length > 0 ||
      (record.model_limits_enabled && record.model_limits)
    ) {
      applyAndStoreTokenModels(record, cached);
      setTokenModelsLoading(false);
      return;
    }
    setTokenModelsLoading(true);
    try {
      await loadTokenModels(record);
    } catch (error) {
      showError(error?.message || t('获取模型列表失败'));
    } finally {
      setTokenModelsLoading(false);
    }
  };

  const onImportCCSwitch = async (record) => {
    try {
      const models = await loadTokenModels(record);
      const fullKey = await fetchTokenKey(record);
      openCCSwitchModal(fullKey, record?.name, models);
    } catch (_) {}
  };

  const testToken = async (record, model, stream = isStreamTest) => {
    if (!record) {
      return;
    }
    if (record.status !== 1) {
      showError(t('令牌未启用'));
      return;
    }
    const models = getTokenTestModels(
      record,
      tokenModelsRef.current[record.id] || [],
    );
    let testModel = model;
    if (!testModel) {
      if (record.model_limits_enabled && models[0]) {
        testModel = models[0];
      } else {
        setCurrentTestToken(record);
        setShowModelTestModal(true);
        return;
      }
    }
    const testKey = `${record.id}-${testModel}`;
    if (shouldStopBatchTestingRef.current && isBatchTesting) {
      return;
    }
    setTestingModels((prev) => new Set([...prev, testModel]));
    try {
      const apiKey = await fetchTokenKey(record);
      const time = await runTokenModelTest({
        apiKey,
        model: testModel,
        stream,
      });
      if (shouldStopBatchTestingRef.current && isBatchTesting) {
        return;
      }
      setModelTestResults((prev) => ({
        ...prev,
        [testKey]: {
          success: true,
          message: '',
          time,
          timestamp: Date.now(),
        },
      }));
      showInfo(
        t('令牌 ${name} 测试成功，模型 ${model} 耗时 ${time} 秒。')
          .replace('${name}', record.name)
          .replace('${model}', testModel)
          .replace('${time}', time.toFixed(2)),
      );
    } catch (error) {
      setModelTestResults((prev) => ({
        ...prev,
        [testKey]: {
          success: false,
          message: error?.message || t('测试失败'),
          time: 0,
          timestamp: Date.now(),
        },
      }));
      showError(error?.message || t('测试失败'));
    } finally {
      setTestingModels((prev) => {
        const next = new Set(prev);
        next.delete(testModel);
        return next;
      });
    }
  };

  const batchTestModels = async () => {
    if (!currentTestToken) {
      showError(t('令牌信息不完整'));
      return;
    }
    const models = getTokenTestModels(
      currentTestToken,
      tokenModelsRef.current[currentTestToken.id] || [],
    ).filter(
      (model) =>
        model.toLowerCase().includes((modelSearchKeyword || '').toLowerCase()),
    );
    if (models.length === 0) {
      showError(t('没有找到匹配的模型'));
      return;
    }
    setIsBatchTesting(true);
    shouldStopBatchTestingRef.current = false;
    setModelTestResults((prev) => {
      const next = { ...prev };
      models.forEach((model) => {
        delete next[`${currentTestToken.id}-${model}`];
      });
      return next;
    });
    try {
      showInfo(
        t('开始批量测试 ${count} 个模型，已清空上次结果...').replace(
          '${count}',
          models.length,
        ),
      );
      const concurrencyLimit = 3;
      for (let i = 0; i < models.length; i += concurrencyLimit) {
        if (shouldStopBatchTestingRef.current) {
          showInfo(t('批量测试已停止'));
          break;
        }
        const batch = models.slice(i, i + concurrencyLimit);
        await Promise.allSettled(
          batch.map((model) =>
            testToken(currentTestToken, model, isStreamTest),
          ),
        );
        if (shouldStopBatchTestingRef.current) {
          showInfo(t('批量测试已停止'));
          break;
        }
        if (i + concurrencyLimit < models.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (!shouldStopBatchTestingRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        setModelTestResults((currentResults) => {
          let successCount = 0;
          let failCount = 0;
          models.forEach((model) => {
            const result = currentResults[`${currentTestToken.id}-${model}`];
            if (result && result.success) successCount += 1;
            else failCount += 1;
          });
          setTimeout(() => {
            showSuccess(
              t(
                '批量测试完成！成功: ${success}, 失败: ${fail}, 总计: ${total}',
              )
                .replace('${success}', successCount)
                .replace('${fail}', failCount)
                .replace('${total}', models.length),
            );
          }, 50);
          return currentResults;
        });
      }
    } catch (error) {
      showError(t('批量测试过程中发生错误: ') + (error?.message || ''));
    } finally {
      setIsBatchTesting(false);
    }
  };

  const handleCloseModelTestModal = () => {
    if (isBatchTesting) {
      shouldStopBatchTestingRef.current = true;
      showInfo(t('关闭弹窗，已停止批量测试'));
    }
    setShowModelTestModal(false);
    setModelSearchKeyword('');
    setIsBatchTesting(false);
    setTestingModels(new Set());
    setSelectedModelKeys([]);
    setModelTablePage(1);
  };

  // Manage token function (delete, enable, disable)
  const manageToken = async (id, action, record) => {
    setLoading(true);
    let data = { id };
    let res;
    switch (action) {
      case 'delete':
        res = await API.delete(`/api/token/${id}/`);
        break;
      case 'enable':
        data.status = 1;
        res = await API.put('/api/token/?status_only=true', data);
        break;
      case 'disable':
        data.status = 2;
        res = await API.put('/api/token/?status_only=true', data);
        break;
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess(t('操作成功完成！'));
      let token = res.data.data;
      let newTokens = [...tokens];
      if (action !== 'delete') {
        record.status = token.status;
      }
      setTokens(newTokens);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  // Search tokens function
  const searchTokens = async (page = 1, size = pageSize) => {
    const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1;
    const normalizedSize =
      Number.isInteger(size) && size > 0 ? size : pageSize;

    const { searchKeyword, searchToken } = getFormValues();
    if (searchKeyword === '' && searchToken === '') {
      setSearchMode(false);
      await loadTokens(1);
      return;
    }
    setSearching(true);
    const res = await API.get(
      `/api/token/search?keyword=${encodeURIComponent(searchKeyword)}&token=${encodeURIComponent(searchToken)}&p=${normalizedPage}&size=${normalizedSize}`,
    );
    const { success, message, data } = res.data;
    if (success) {
      setSearchMode(true);
      syncPageData(data);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  // Sort tokens function
  const sortToken = (key) => {
    if (tokens.length === 0) return;
    setLoading(true);
    let sortedTokens = [...tokens];
    sortedTokens.sort((a, b) => {
      return ('' + a[key]).localeCompare(b[key]);
    });
    if (sortedTokens[0].id === tokens[0].id) {
      sortedTokens.reverse();
    }
    setTokens(sortedTokens);
    setLoading(false);
  };

  // Page handlers
  const handlePageChange = (page) => {
    if (searchMode) {
      searchTokens(page, pageSize).then();
    } else {
      loadTokens(page, pageSize).then();
    }
  };

  const handlePageSizeChange = async (size) => {
    setPageSize(size);
    if (searchMode) {
      await searchTokens(1, size);
    } else {
      await loadTokens(1, size);
    }
  };

  // Row selection handlers
  const rowSelection = {
    onSelect: (record, selected) => {},
    onSelectAll: (selected, selectedRows) => {},
    onChange: (selectedRowKeys, selectedRows) => {
      setSelectedKeys(selectedRows);
    },
  };

  // Handle row styling
  const handleRow = (record, index) => {
    if (record.status !== 1) {
      return {
        style: {
          background: 'var(--semi-color-disabled-border)',
        },
      };
    } else {
      return {};
    }
  };

  // Batch delete tokens
  const batchDeleteTokens = async () => {
    if (selectedKeys.length === 0) {
      showError(t('请先选择要删除的令牌！'));
      return;
    }
    setLoading(true);
    try {
      const ids = selectedKeys.map((token) => token.id);
      const res = await API.post('/api/token/batch', { ids });
      if (res?.data?.success) {
        const count = res.data.data || 0;
        showSuccess(t('已删除 {{count}} 个令牌！', { count }));
        await refresh();
        setTimeout(() => {
          if (tokens.length === 0 && activePage > 1) {
            refresh(activePage - 1);
          }
        }, 100);
      } else {
        showError(res?.data?.message || t('删除失败'));
      }
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Batch copy tokens
  const batchCopyTokens = async (copyType) => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    try {
      const ids = selectedKeys.map((token) => token.id);
      const keysMap = await fetchTokenKeysBatch(ids);

      setResolvedTokenKeys((prev) => ({ ...prev, ...keysMap }));

      let content = '';
      for (const token of selectedKeys) {
        const fullKey = keysMap[token.id];
        if (!fullKey) continue;
        if (copyType === 'name+key') {
          content += `${token.name}    sk-${fullKey}\n`;
        } else {
          content += `sk-${fullKey}\n`;
        }
      }
      await copyText(content);
    } catch (error) {
      showError(error?.message || t('复制令牌失败'));
    }
  };

  // Initialize data
  useEffect(() => {
    loadTokens(1)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    API.get('/api/user/self/groups')
      .then((res) => {
        if (res.data.success && res.data.data) {
          const ratios = {};
          for (const [name, info] of Object.entries(res.data.data)) {
            ratios[name] = info.ratio;
          }
          setGroupRatios(ratios);
        }
      })
      .catch(() => {});
    ensureGroupModels();
  }, [pageSize]);

  return {
    // Basic state
    tokens,
    loading,
    activePage,
    tokenCount,
    pageSize,
    searching,
    groupRatios,

    // Selection state
    selectedKeys,
    setSelectedKeys,

    // Edit state
    showEdit,
    setShowEdit,
    editingToken,
    setEditingToken,
    closeEdit,

    // UI state
    compactMode,
    setCompactMode,
    showKeys,
    setShowKeys,
    resolvedTokenKeys,
    loadingTokenKeys,

    // Form state
    formApi,
    setFormApi,
    formInitValues,
    getFormValues,

    // Functions
    loadTokens,
    refresh,
    copyText,
    fetchTokenKey,
    toggleTokenVisibility,
    copyTokenKey,
    copyTokenConnectionString,
    onOpenLink,
    onImportCCSwitch,
    openTokenTest,
    testToken,
    batchTestModels,
    handleCloseModelTestModal,
    manageToken,
    searchTokens,
    sortToken,
    handlePageChange,
    handlePageSizeChange,
    rowSelection,
    handleRow,
    batchDeleteTokens,
    batchCopyTokens,
    syncPageData,

    userModels: [],
    tokenModelsMap,
    tokenModelsLoading,

    showModelTestModal,
    setShowModelTestModal,
    currentTestToken,
    setCurrentTestToken,
    modelSearchKeyword,
    setModelSearchKeyword,
    modelTestResults,
    testingModels,
    selectedModelKeys,
    setSelectedModelKeys,
    isBatchTesting,
    modelTablePage,
    setModelTablePage,
    isStreamTest,
    setIsStreamTest,
    allSelectingRef,

    // Translation
    t,
  };
};
