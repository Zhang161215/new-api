import React, { useEffect, useState, useRef } from 'react';
import {
  Banner,
  Button,
  Form,
  Row,
  Col,
  Typography,
  Spin,
} from '@douyinfe/semi-ui';
const { Text } = Typography;
import {
  API,
  removeTrailingSlash,
  showError,
  showSuccess,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

export default function SettingsPaymentGatewayXunhu(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    XunhuPayAppId: '',
    XunhuPayAppSecret: '',
    XunhuPayApiUrl: '',
  });
  const formApiRef = useRef(null);

  useEffect(() => {
    if (props.options && formApiRef.current) {
      const currentInputs = {
        XunhuPayAppId: props.options.XunhuPayAppId || '',
        XunhuPayAppSecret: props.options.XunhuPayAppSecret || '',
        XunhuPayApiUrl: props.options.XunhuPayApiUrl || '',
      };
      setInputs(currentInputs);
      formApiRef.current.setValues(currentInputs);
    }
  }, [props.options]);

  const handleFormChange = (values) => {
    setInputs(values);
  };

  const submitXunhuSetting = async () => {
    if (props.options.ServerAddress === '') {
      showError(t('请先填写服务器地址'));
      return;
    }

    setLoading(true);
    try {
      const options = [];

      if (inputs.XunhuPayAppId) {
        options.push({ key: 'XunhuPayAppId', value: inputs.XunhuPayAppId });
      }
      if (inputs.XunhuPayAppSecret) {
        options.push({ key: 'XunhuPayAppSecret', value: inputs.XunhuPayAppSecret });
      }
      if (inputs.XunhuPayApiUrl) {
        options.push({ key: 'XunhuPayApiUrl', value: inputs.XunhuPayApiUrl });
      }

      const requestQueue = options.map((opt) =>
        API.put('/api/option/', {
          key: opt.key,
          value: opt.value,
        }),
      );

      const results = await Promise.all(requestQueue);

      const errorResults = results.filter((res) => !res.data.success);
      if (errorResults.length > 0) {
        errorResults.forEach((res) => {
          showError(res.data.message);
        });
      } else {
        showSuccess(t('更新成功'));
        props.refresh?.();
      }
    } catch (error) {
      showError(t('更新失败'));
    }
    setLoading(false);
  };

  return (
    <Spin spinning={loading}>
      <Form
        initValues={inputs}
        onValueChange={handleFormChange}
        getFormApi={(api) => (formApiRef.current = api)}
      >
        <Form.Section text={t('虎皮椒支付设置')}>
          <Text>
            虎皮椒支付配置，请前往
            <a
              href='https://admin.xunhupay.com'
              target='_blank'
              rel='noreferrer'
            >
              虎皮椒后台
            </a>
            获取 AppId 和 AppSecret。
          </Text>
          <Banner
            type='info'
            description={`回调地址填：${props.options.ServerAddress ? removeTrailingSlash(props.options.ServerAddress) : t('网站地址')}/api/user/xunhu/notify`}
          />
          <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='XunhuPayAppId'
                label='App ID'
                placeholder={t('虎皮椒 App ID')}
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='XunhuPayAppSecret'
                label='App Secret'
                placeholder={t('虎皮椒 App Secret，敏感信息不显示')}
                type='password'
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='XunhuPayApiUrl'
                label='API URL'
                placeholder='https://api.xunhupay.com/payment/do.html'
              />
            </Col>
          </Row>
          <Button onClick={submitXunhuSetting}>{t('更新虎皮椒设置')}</Button>
        </Form.Section>
      </Form>
    </Spin>
  );
}
