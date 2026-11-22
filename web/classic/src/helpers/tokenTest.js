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

export function applyModelLimits(record, models) {
  const list = Array.isArray(models) ? models : [];
  if (record?.model_limits_enabled && record.model_limits) {
    const allow = new Set(
      String(record.model_limits)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const hit = list.filter((m) => allow.has(m));
    return hit.length ? hit : [...allow];
  }
  return list;
}

export function getTokenTestModels(record, tokenModels = []) {
  return applyModelLimits(record, tokenModels);
}

function parseApiError(text, fallback) {
  if (!text) return fallback;
  try {
    const j = JSON.parse(text);
    return j?.error?.message || j?.message || fallback;
  } catch (_) {
    return String(text).slice(0, 240) || fallback;
  }
}

export async function fetchTokenEnabledModels(apiKey) {
  const res = await fetch('/v1/models', {
    headers: { Authorization: `Bearer sk-${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseApiError(text, `HTTP ${res.status}`));
  }
  const data = await res.json();
  const list = data?.data || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter(Boolean);
}

async function drainSSE(res, signal) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const line of parts) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
          const j = JSON.parse(payload);
          if (j?.error?.message) {
            throw new Error(j.error.message);
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {}
  }
}

export async function runTokenModelTest({
  apiKey,
  model,
  stream = true,
  timeoutMs = 45000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body = {
    model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 8,
    stream: !!stream,
  };
  if (/gpt-|o[1-9]|codex/i.test(model)) {
    body.reasoning_effort = 'low';
  }
  const t0 = performance.now();
  try {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer sk-${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseApiError(text, `HTTP ${res.status}`));
    }
    if (stream) {
      await drainSSE(res, controller.signal);
    } else {
      const data = await res.json();
      if (data?.error?.message) {
        throw new Error(data.error.message);
      }
    }
    return (performance.now() - t0) / 1000;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('超时');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
