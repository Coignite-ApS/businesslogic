/**
 * k6 load test: Calculator/formula execution.
 *
 * Target: <50ms p95 eval latency.
 *
 * Run: k6 run tests/load/calculator.js
 * Env: GATEWAY_URL, API_KEY, ACCOUNT_ID, CALCULATOR_ID
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const gatewayUrl = __ENV.GATEWAY_URL || 'http://localhost:18080';
const apiKey = __ENV.API_KEY || '';
const accountId = __ENV.ACCOUNT_ID || 'test-account';
const calcId = __ENV.CALCULATOR_ID || '';

const evalLatency = new Trend('calc_eval_latency_ms');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    calculator_exec: {
      executor: 'constant-vus',
      vus: 200,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_duration{scenario:calculator_exec}': ['p(95)<50'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  const payload = JSON.stringify({
    inputs: { amount: Math.random() * 10000, rate: 5 + Math.random() * 10 },
  });

  const url = calcId
    ? `${gatewayUrl}/v1/calculators/${calcId}/execute`
    : `${gatewayUrl}/evaluate`;

  const res = http.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Account-ID': accountId,
    },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  evalLatency.add(res.timings.duration);
  sleep(0.05);
}
