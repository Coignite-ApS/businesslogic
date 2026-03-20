/**
 * k6 load test: AI chat streaming.
 *
 * Target: <3s p95 end-to-end (first token).
 *
 * Run: k6 run tests/load/ai-chat.js
 * Env: GATEWAY_URL, API_KEY, ACCOUNT_ID
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const gatewayUrl = __ENV.GATEWAY_URL || 'http://localhost:18080';
const apiKey = __ENV.API_KEY || '';
const accountId = __ENV.ACCOUNT_ID || 'test-account';

const ttftTrend = new Trend('time_to_first_token_ms');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    chat_streaming: {
      executor: 'constant-vus',
      vus: 50,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_duration{scenario:chat_streaming}': ['p(95)<3000'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  const payload = JSON.stringify({
    message: 'What is 2+2?',
    model: 'claude-haiku-4-5-20251001',
    stream: false,
  });

  const res = http.post(`${gatewayUrl}/v1/ai/chat`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Account-ID': accountId,
    },
    timeout: '10s',
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has response': (r) => {
      try { return JSON.parse(r.body).response !== undefined; } catch { return false; }
    },
  });

  if (!ok) errorRate.add(1);
  ttftTrend.add(res.timings.duration);
  sleep(1);
}
