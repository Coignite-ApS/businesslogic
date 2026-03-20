/**
 * k6 load test: Gateway auth + proxy overhead.
 *
 * Target: <5ms p95 overhead (gateway processing, not backend latency).
 *
 * Run: k6 run tests/load/gateway.js
 * Env: GATEWAY_URL (default http://localhost:18080)
 *      API_KEY (required — valid API key for auth)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const gatewayUrl = __ENV.GATEWAY_URL || 'http://localhost:18080';
const apiKey = __ENV.API_KEY || '';

const overheadTrend = new Trend('gateway_overhead_ms');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    auth_proxy: {
      executor: 'constant-vus',
      vus: 200,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_duration{scenario:auth_proxy}': ['p(95)<50'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${gatewayUrl}/health`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has response body': (r) => r.body && r.body.length > 0,
  }) || errorRate.add(1);

  overheadTrend.add(res.timings.duration);
  sleep(0.1);
}
