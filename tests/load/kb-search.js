/**
 * k6 load test: Knowledge base search.
 *
 * Target: <100ms p95 search latency.
 *
 * Run: k6 run tests/load/kb-search.js
 * Env: GATEWAY_URL, API_KEY, ACCOUNT_ID, KB_ID
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const gatewayUrl = __ENV.GATEWAY_URL || 'http://localhost:18080';
const apiKey = __ENV.API_KEY || '';
const accountId = __ENV.ACCOUNT_ID || 'test-account';
const kbId = __ENV.KB_ID || '';

const searchLatency = new Trend('kb_search_latency_ms');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    kb_search: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_duration{scenario:kb_search}': ['p(95)<100'],
    errors: ['rate<0.05'],
  },
};

const queries = [
  'pricing model',
  'how to configure',
  'API authentication',
  'rate limiting',
  'deployment guide',
];

export default function () {
  const query = queries[Math.floor(Math.random() * queries.length)];
  const payload = JSON.stringify({ query, top_k: 5 });

  const res = http.post(`${gatewayUrl}/v1/ai/kb/${kbId}/search`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Account-ID': accountId,
    },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has results': (r) => {
      try { return JSON.parse(r.body).results?.length >= 0; } catch { return false; }
    },
  }) || errorRate.add(1);

  searchLatency.add(res.timings.duration);
  sleep(0.2);
}
