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
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Banner,
  Button,
  Modal,
  RadioGroup,
  Radio,
  Select,
  Input,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { copy, selectFilter } from '../../../../helpers';

// 唤起成功时浏览器窗口会失焦；超过这个时间还没失焦，就提示用户检查本机 CC Switch
const LAUNCH_DETECT_MS = 2500;

const APP_CONFIGS = {
  claude: {
    label: 'Claude',
    defaultName: 'My Claude',
    modelFields: [
      { key: 'model', label: '主模型' },
      { key: 'haikuModel', label: 'Haiku 模型' },
      { key: 'sonnetModel', label: 'Sonnet 模型' },
      { key: 'opusModel', label: 'Opus 模型' },
    ],
  },
  codex: {
    label: 'Codex',
    defaultName: 'My Codex',
    modelFields: [{ key: 'model', label: '主模型' }],
  },
  gemini: {
    label: 'Gemini',
    defaultName: 'My Gemini',
    modelFields: [{ key: 'model', label: '主模型' }],
  },
};

function getServerAddress() {
  try {
    const raw = localStorage.getItem('status');
    if (raw) {
      const status = JSON.parse(raw);
      if (status.server_address) return status.server_address;
    }
  } catch (_) {}
  return window.location.origin;
}

function buildCCSwitchURL(app, name, models, apiKey) {
  const serverAddress = getServerAddress();
  const endpoint = app === 'codex' ? serverAddress + '/v1' : serverAddress;
  const params = new URLSearchParams();
  params.set('resource', 'provider');
  params.set('app', app);
  params.set('name', name);
  params.set('endpoint', endpoint);
  params.set('apiKey', apiKey);
  for (const [k, v] of Object.entries(models)) {
    if (v) params.set(k, v);
  }
  params.set('homepage', serverAddress);
  params.set('enabled', 'true');
  return `ccswitch://v1/import?${params.toString()}`;
}

// 自定义协议不能用 window.open(url, '_blank')：浏览器会先开一个 about:blank 新标签再把协议交给它，
// 多数情况下就停在空白页、唤不起应用。改为在当前页点一个隐藏链接，协议交给系统处理，页面本身不会跳走。
function openCCSwitch(url) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function CCSwitchModal({
  visible,
  onClose,
  tokenKey,
  tokenName,
  modelOptions,
}) {
  const { t } = useTranslation();
  const [app, setApp] = useState('claude');
  const [name, setName] = useState(APP_CONFIGS.claude.defaultName);
  const [models, setModels] = useState({});
  // idle：未点击；waiting：已发出链接、等窗口失焦；failed：超时仍无反应
  const [launchState, setLaunchState] = useState('idle');
  const launchCleanupRef = useRef(null);

  const currentConfig = APP_CONFIGS[app];

  const stopLaunchDetect = () => {
    launchCleanupRef.current?.();
    launchCleanupRef.current = null;
  };

  useEffect(() => {
    if (visible) {
      setModels({});
      setApp('claude');
      setName(tokenName || APP_CONFIGS.claude.defaultName);
      setLaunchState('idle');
    }
    return stopLaunchDetect;
  }, [visible, tokenName]);

  const buildLink = () => {
    const key = tokenKey.startsWith('sk-') ? tokenKey : 'sk-' + tokenKey;
    return buildCCSwitchURL(app, name, models, key);
  };

  const handleAppChange = (val) => {
    setApp(val);
    setName(tokenName || APP_CONFIGS[val].defaultName);
    setModels({});
  };

  const handleModelChange = (field, value) => {
    setModels((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    if (!models.model) {
      Toast.warning(t('请选择主模型'));
      return;
    }
    stopLaunchDetect();
    setLaunchState('waiting');
    const onLaunched = () => {
      stopLaunchDetect();
      setLaunchState('idle');
      Toast.success(t('已唤起 CC Switch，请在 CC Switch 中确认导入'));
      onClose();
    };
    const onVisibility = () => document.hidden && onLaunched();
    // 超时只亮提示、不停监听：浏览器"要打开 CC Switch 吗"的确认框期间窗口不失焦，用户稍后点允许仍能自动关窗
    const timer = setTimeout(() => setLaunchState('failed'), LAUNCH_DETECT_MS);
    window.addEventListener('blur', onLaunched);
    document.addEventListener('visibilitychange', onVisibility);
    launchCleanupRef.current = () => {
      clearTimeout(timer);
      window.removeEventListener('blur', onLaunched);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    openCCSwitch(buildLink());
  };

  const handleCopyLink = async () => {
    if (!models.model) {
      Toast.warning(t('请选择主模型'));
      return;
    }
    if (await copy(buildLink())) {
      Toast.success(
        t('已复制导入链接，粘贴到浏览器地址栏回车即可唤起 CC Switch'),
      );
    }
  };

  const fieldLabelStyle = useMemo(
    () => ({
      marginBottom: 4,
      fontSize: 13,
      color: 'var(--semi-color-text-1)',
    }),
    [],
  );

  return (
    <Modal
      title={t('填入 CC Switch')}
      visible={visible}
      onCancel={onClose}
      maskClosable={false}
      width={480}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button onClick={handleCopyLink}>{t('复制导入链接')}</Button>
          <Button
            theme='solid'
            type='primary'
            loading={launchState === 'waiting'}
            onClick={handleSubmit}
          >
            {t('打开 CC Switch')}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {launchState === 'failed' && (
          <Banner
            type='warning'
            fullMode={false}
            closeIcon={null}
            description={
              <div className='text-xs leading-5'>
                <div className='mb-1 text-sm font-semibold'>
                  {t('没有检测到 CC Switch 响应')}
                </div>
                <div>
                  {t(
                    '1. 确认 CC Switch 已安装在「应用程序」（Windows 为安装版），并且手动打开过一次；便携版、直接在下载目录里运行的不会注册 ccswitch:// 协议。',
                  )}
                </div>
                <div>
                  {t('2. 浏览器如果弹出「要打开 CC Switch 吗」，请点允许。')}
                </div>
                <div>
                  {t(
                    '3. 仍然不行时点「复制导入链接」，粘贴到浏览器地址栏回车。',
                  )}
                </div>
              </div>
            }
          />
        )}
        <div>
          <div style={fieldLabelStyle}>{t('应用')}</div>
          <RadioGroup
            type='button'
            value={app}
            onChange={(e) => handleAppChange(e.target.value)}
            style={{ width: '100%' }}
          >
            {Object.entries(APP_CONFIGS).map(([key, cfg]) => (
              <Radio key={key} value={key}>
                {cfg.label}
              </Radio>
            ))}
          </RadioGroup>
        </div>

        <div>
          <div style={fieldLabelStyle}>{t('名称')}</div>
          <Input
            value={name}
            onChange={setName}
            placeholder={currentConfig.defaultName}
          />
        </div>

        {currentConfig.modelFields.map((field) => (
          <div key={field.key}>
            <div style={fieldLabelStyle}>
              {t(field.label)}
              {field.key === 'model' && (
                <Typography.Text type='danger'> *</Typography.Text>
              )}
            </div>
            <Select
              placeholder={t('请选择模型')}
              optionList={modelOptions}
              value={models[field.key] || undefined}
              onChange={(val) => handleModelChange(field.key, val)}
              filter={selectFilter}
              style={{ width: '100%' }}
              showClear
              searchable
              emptyContent={t('暂无数据')}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
