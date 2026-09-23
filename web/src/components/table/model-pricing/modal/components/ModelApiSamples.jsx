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

import React, { useEffect, useMemo, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { ChevronRight, Copy, KeyRound, ScrollText } from 'lucide-react';
import { copy, getServerAddress } from '../../../../../helpers';

// 调用示例生成器移植自上游 model-details-api.tsx；
// 上游的“支持的参数 / 限流”是按模型名随机生成的 mock 数据，这里不搬。

const LANGS = [
  { value: 'curl', label: 'cURL' },
  { value: 'python', label: 'Python' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
];

const USER_MESSAGE = 'Explain quantum entanglement in one paragraph.';
const indentBody = (json) => json.replace(/\n/g, '\n     ');

const buildChatSample = (lang, ctx) => {
  const url = `${ctx.baseUrl}${ctx.endpointPath}`;
  const isResponses = String(ctx.endpointType).startsWith('openai-response');
  const isReasoning = /^o[1-4]|reasoning|thinking|deepseek-r/i.test(
    ctx.modelName,
  );
  const bodyJson = isResponses
    ? JSON.stringify({ model: ctx.modelName, input: USER_MESSAGE }, null, 2)
    : JSON.stringify(
        {
          model: ctx.modelName,
          messages: [{ role: 'user', content: USER_MESSAGE }],
          ...(isReasoning ? {} : { temperature: 0.7 }),
        },
        null,
        2,
      );
  const fnCall = isResponses ? 'responses.create' : 'chat.completions.create';

  if (lang === 'curl') {
    return [
      `curl ${url} \\`,
      `  -H "Authorization: Bearer $${ctx.apiKeyEnv}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${indentBody(bodyJson)}'`,
    ].join('\n');
  }
  if (lang === 'python') {
    return [
      'from openai import OpenAI',
      '',
      'client = OpenAI(',
      `    base_url="${ctx.baseUrl}/v1",`,
      `    api_key="<YOUR_API_KEY>",`,
      ')',
      '',
      isResponses
        ? `response = client.${fnCall}(\n    model="${ctx.modelName}",\n    input="${USER_MESSAGE}",\n)\n\nprint(response.output_text)`
        : `completion = client.${fnCall}(\n    model="${ctx.modelName}",\n    messages=[\n        {"role": "user", "content": "${USER_MESSAGE}"}\n    ],\n)\n\nprint(completion.choices[0].message.content)`,
    ].join('\n');
  }
  if (lang === 'typescript') {
    return [
      `import OpenAI from 'openai'`,
      '',
      `const client = new OpenAI({`,
      `  baseURL: '${ctx.baseUrl}/v1',`,
      `  apiKey: process.env.${ctx.apiKeyEnv},`,
      `})`,
      '',
      isResponses
        ? `const response = await client.${fnCall}({\n  model: '${ctx.modelName}',\n  input: '${USER_MESSAGE}',\n})\n\nconsole.log(response.output_text)`
        : `const completion = await client.${fnCall}({\n  model: '${ctx.modelName}',\n  messages: [{ role: 'user', content: '${USER_MESSAGE}' }],\n})\n\nconsole.log(completion.choices[0].message.content)`,
    ].join('\n');
  }
  return [
    `const response = await fetch('${url}', {`,
    `  method: 'POST',`,
    `  headers: {`,
    `    Authorization: \`Bearer \${process.env.${ctx.apiKeyEnv}}\`,`,
    `    'Content-Type': 'application/json',`,
    `  },`,
    `  body: JSON.stringify(${bodyJson}),`,
    `})`,
    '',
    `const data = await response.json()`,
    `console.log(data)`,
  ].join('\n');
};

const buildAnthropicSample = (lang, ctx) => {
  const url = `${ctx.baseUrl}${ctx.endpointPath}`;
  if (lang === 'curl') {
    const body = JSON.stringify(
      {
        model: ctx.modelName,
        max_tokens: 1024,
        messages: [{ role: 'user', content: USER_MESSAGE }],
      },
      null,
      2,
    );
    return [
      `curl ${url} \\`,
      `  -H "x-api-key: $${ctx.apiKeyEnv}" \\`,
      `  -H "anthropic-version: 2023-06-01" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${indentBody(body)}'`,
    ].join('\n');
  }
  if (lang === 'python') {
    return [
      'import anthropic',
      '',
      'client = anthropic.Anthropic(',
      `    base_url="${ctx.baseUrl}",`,
      `    api_key="<YOUR_API_KEY>",`,
      ')',
      '',
      `message = client.messages.create(`,
      `    model="${ctx.modelName}",`,
      `    max_tokens=1024,`,
      `    messages=[{"role": "user", "content": "${USER_MESSAGE}"}],`,
      ')',
      '',
      'print(message.content[0].text)',
    ].join('\n');
  }
  if (lang === 'typescript') {
    return [
      `import Anthropic from '@anthropic-ai/sdk'`,
      '',
      `const client = new Anthropic({`,
      `  baseURL: '${ctx.baseUrl}',`,
      `  apiKey: process.env.${ctx.apiKeyEnv},`,
      `})`,
      '',
      `const message = await client.messages.create({`,
      `  model: '${ctx.modelName}',`,
      `  max_tokens: 1024,`,
      `  messages: [{ role: 'user', content: '${USER_MESSAGE}' }],`,
      `})`,
      '',
      `console.log(message.content[0].text)`,
    ].join('\n');
  }
  return [
    `const response = await fetch('${url}', {`,
    `  method: 'POST',`,
    `  headers: {`,
    `    'x-api-key': process.env.${ctx.apiKeyEnv},`,
    `    'anthropic-version': '2023-06-01',`,
    `    'Content-Type': 'application/json',`,
    `  },`,
    `  body: JSON.stringify({`,
    `    model: '${ctx.modelName}',`,
    `    max_tokens: 1024,`,
    `    messages: [{ role: 'user', content: '${USER_MESSAGE}' }],`,
    `  }),`,
    `})`,
    '',
    `const data = await response.json()`,
    `console.log(data.content[0].text)`,
  ].join('\n');
};

const buildGeminiSample = (lang, ctx) => {
  const url = `${ctx.baseUrl}${ctx.endpointPath}?key=$${ctx.apiKeyEnv}`;
  if (lang === 'curl') {
    const body = JSON.stringify(
      { contents: [{ parts: [{ text: USER_MESSAGE }] }] },
      null,
      2,
    );
    return [
      `curl '${url}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '${indentBody(body)}'`,
    ].join('\n');
  }
  if (lang === 'python') {
    return [
      'import google.generativeai as genai',
      '',
      `genai.configure(api_key="<YOUR_API_KEY>")`,
      '',
      `model = genai.GenerativeModel("${ctx.modelName}")`,
      `response = model.generate_content("${USER_MESSAGE}")`,
      '',
      `print(response.text)`,
    ].join('\n');
  }
  if (lang === 'typescript') {
    return [
      `import { GoogleGenerativeAI } from '@google/generative-ai'`,
      '',
      `const genAI = new GoogleGenerativeAI(process.env.${ctx.apiKeyEnv}!)`,
      `const model = genAI.getGenerativeModel({ model: '${ctx.modelName}' })`,
      '',
      `const result = await model.generateContent('${USER_MESSAGE}')`,
      `console.log(result.response.text())`,
    ].join('\n');
  }
  return [
    `const response = await fetch('${url}', {`,
    `  method: 'POST',`,
    `  headers: { 'Content-Type': 'application/json' },`,
    `  body: JSON.stringify({`,
    `    contents: [{ parts: [{ text: '${USER_MESSAGE}' }] }],`,
    `  }),`,
    `})`,
    '',
    `const data = await response.json()`,
    `console.log(data.candidates[0].content.parts[0].text)`,
  ].join('\n');
};

// 通用 JSON 请求：embeddings / rerank / 图片 / 视频
const buildJsonSample = (lang, ctx, payload, pyCall, tsCall, pick) => {
  const url = `${ctx.baseUrl}${ctx.endpointPath}`;
  const bodyJson = JSON.stringify(payload, null, 2);
  if (lang === 'curl') {
    return [
      `curl ${url} \\`,
      `  -H "Authorization: Bearer $${ctx.apiKeyEnv}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${indentBody(bodyJson)}'`,
    ].join('\n');
  }
  if (lang === 'python' && pyCall) {
    return [
      'from openai import OpenAI',
      '',
      `client = OpenAI(base_url="${ctx.baseUrl}/v1", api_key="<YOUR_API_KEY>")`,
      '',
      pyCall,
    ].join('\n');
  }
  if (lang === 'typescript' && tsCall) {
    return [
      `import OpenAI from 'openai'`,
      '',
      `const client = new OpenAI({`,
      `  baseURL: '${ctx.baseUrl}/v1',`,
      `  apiKey: process.env.${ctx.apiKeyEnv},`,
      `})`,
      '',
      tsCall,
    ].join('\n');
  }
  return [
    `const response = await fetch('${url}', {`,
    `  method: 'POST',`,
    `  headers: {`,
    `    Authorization: \`Bearer \${process.env.${ctx.apiKeyEnv}}\`,`,
    `    'Content-Type': 'application/json',`,
    `  },`,
    `  body: JSON.stringify(${bodyJson}),`,
    `})`,
    '',
    `const data = await response.json()`,
    `console.log(${pick || 'data'})`,
  ].join('\n');
};

const buildSample = (lang, ctx) => {
  const m = ctx.modelName;
  switch (ctx.endpointType) {
    case 'anthropic':
      return buildAnthropicSample(lang, ctx);
    case 'gemini':
      return buildGeminiSample(lang, ctx);
    case 'embeddings': {
      const text = 'The food was delicious and the waiter…';
      return buildJsonSample(
        lang,
        ctx,
        { model: m, input: text },
        `response = client.embeddings.create(\n    model="${m}",\n    input="${text}",\n)\n\nprint(response.data[0].embedding[:8])`,
        `const response = await client.embeddings.create({\n  model: '${m}',\n  input: '${text}',\n})\n\nconsole.log(response.data[0].embedding.slice(0, 8))`,
        'data.data[0].embedding.slice(0, 8)',
      );
    }
    case 'jina-rerank':
      return buildJsonSample(
        lang,
        ctx,
        {
          model: m,
          query: 'What is quantum entanglement?',
          documents: [
            'Quantum entanglement links particles.',
            'Koi ponds are calm.',
          ],
        },
        null,
        null,
        'data.results',
      );
    case 'image-generation': {
      const prompt = 'A serene koi pond at sunset, ukiyo-e style.';
      return buildJsonSample(
        lang,
        ctx,
        { model: m, prompt, size: '1024x1024', n: 1 },
        `response = client.images.generate(\n    model="${m}",\n    prompt="${prompt}",\n    size="1024x1024",\n    n=1,\n)\n\nprint(response.data[0].url)`,
        `const response = await client.images.generate({\n  model: '${m}',\n  prompt: '${prompt}',\n  size: '1024x1024',\n  n: 1,\n})\n\nconsole.log(response.data[0].url)`,
        'data.data[0].url',
      );
    }
    case 'openai-video':
      return buildJsonSample(
        lang,
        ctx,
        { model: m, prompt: 'A serene koi pond at sunset, ukiyo-e style.' },
        null,
        null,
        'data',
      );
    default:
      return buildChatSample(lang, ctx);
  }
};

// 上游 Tabs（bg-muted/40 h-8 p-0.5）的 Semi 版
const Segmented = ({ value, options, onChange }) => (
  <div className='pricing-segmented'>
    {options.map((option) => (
      <button
        key={option.value}
        type='button'
        data-active={value === option.value ? 'true' : undefined}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const SectionTitle = ({ icon: Icon, children }) => (
  <h3
    className='mb-3 flex items-center gap-1.5 text-sm font-semibold'
    style={{ color: 'var(--semi-color-text-0)' }}
  >
    <Icon
      size={14}
      style={{ color: 'var(--semi-color-text-2)', opacity: 0.8 }}
    />
    {children}
  </h3>
);

const InlineCode = ({ children }) => (
  <code
    className='rounded px-1 py-0.5 font-mono text-[11px]'
    style={{ background: 'var(--semi-color-fill-1)' }}
  >
    {children}
  </code>
);

const ModelApiSamples = ({ modelData, endpointMap = {}, t }) => {
  const endpoints = useMemo(() => {
    const types = modelData?.supported_endpoint_types || [];
    return types
      .map((type) => {
        const info = endpointMap[type] || {};
        let path = info.path || '';
        if (path.includes('{model}')) {
          path = path.replaceAll('{model}', modelData?.model_name || '');
        }
        return { type, path, method: info.method || 'POST' };
      })
      .filter((item) => item.path);
  }, [endpointMap, modelData]);
  const modelName = modelData?.model_name || '';
  const [endpointType, setEndpointType] = useState(endpoints[0]?.type || '');
  const [lang, setLang] = useState('curl');
  useEffect(() => {
    setEndpointType('');
  }, [modelName]);
  const active =
    endpoints.find((item) => item.type === endpointType) || endpoints[0];
  const baseUrl = String(getServerAddress() || '').replace(/\/$/, '');

  const code = active
    ? buildSample(lang, {
        baseUrl,
        apiKeyEnv: 'NEW_API_KEY',
        modelName,
        endpointType: active.type,
        endpointPath: active.path,
      })
    : '';

  return (
    <div className='space-y-6'>
      {active ? (
        <section>
          <SectionTitle icon={ScrollText}>{t('调用示例')}</SectionTitle>
          <div className='flex flex-wrap items-center gap-2'>
            {endpoints.length > 1 && (
              <Segmented
                value={active.type}
                options={endpoints.map((item) => ({
                  value: item.type,
                  label: item.type,
                }))}
                onChange={setEndpointType}
              />
            )}
            <div className='ml-auto'>
              <Segmented value={lang} options={LANGS} onChange={setLang} />
            </div>
          </div>
          <div className='pricing-code-block mt-3'>
            <button
              type='button'
              aria-label={t('复制')}
              className='pricing-code-copy'
              onClick={async () => {
                if (await copy(code)) Toast.success(t('已复制'));
                else Toast.error(t('复制失败'));
              }}
            >
              <Copy size={14} />
            </button>
            <pre>{code}</pre>
          </div>
          <p
            className='mt-2 text-xs'
            style={{ color: 'var(--semi-color-text-2)' }}
          >
            {t('替换')} <InlineCode>{'<YOUR_API_KEY>'}</InlineCode>{' '}
            {t('为令牌设置中的 API Key。')}
          </p>
        </section>
      ) : (
        <div className='text-sm' style={{ color: 'var(--semi-color-text-2)' }}>
          {t('该模型没有可用的 API 端点。')}
        </div>
      )}

      <section>
        <SectionTitle icon={KeyRound}>{t('身份验证')}</SectionTitle>
        <div
          className='flex items-start gap-2 rounded-lg border p-3'
          style={{
            borderColor: 'var(--semi-color-border)',
            background: 'var(--semi-color-fill-0)',
          }}
        >
          <ChevronRight
            size={14}
            style={{
              marginTop: 2,
              flexShrink: 0,
              color: 'var(--semi-color-text-2)',
            }}
          />
          <div className='space-y-1.5 text-xs leading-relaxed'>
            <p>
              {t('所有请求必须携带')}{' '}
              <InlineCode>Authorization: Bearer &lt;TOKEN&gt;</InlineCode>{' '}
              {t('请求头。Anthropic 格式的端点也接受')}{' '}
              <InlineCode>x-api-key</InlineCode> {t('请求头。')}
            </p>
            <p style={{ color: 'var(--semi-color-text-2)' }}>
              {t(
                '在「令牌」页面生成 API Key，可以按模型、分组、IP 等维度精细化授权。',
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ModelApiSamples;
