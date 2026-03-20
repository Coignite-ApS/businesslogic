/**
 * k6 load test: Flow webhook trigger.
 *
 * Target: <10ms p95 trigger latency, <5s flow completion.
 *
 * Run: k6 run tests/load/flow-trigger.js
 * Env: GATEWAY_URL, API_KEY, FLOW_ID, WEBHOOK_SECRET
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { crypto } from 'k6/experimental/webcrypto';

const gatewayUrl = __ENV.GATEWAY_URL || 'http://localhost:18080';
const apiKey = __ENV.API_KEY || '';
const flowId = __ENV.FLOW_ID || '';
const webhookSecret = __ENV.WEBHOOK_SECRET || '';

const triggerLatency = new Trend('flow_trigger_latency_ms');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    webhook_trigger: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_duration{scenario:webhook_trigger}': ['p(95)<10'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  const payload = JSON.stringify({
    event: 'test',
    data: { value: Math.random() * 100 },
    timestamp: new Date().toISOString(),
  });

  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const url = flowId
    ? `${gatewayUrl}/v1/flows/${flowId}/trigger`
    : `${gatewayUrl}/flows/trigger`;

  const res = http.post(url, payload, { headers });

  check(res, {
    'status is 200 or 202': (r) => r.status === 200 || r.status === 202,
  }) || errorRate.add(1);

  triggerLatency.add(res.timings.duration);
  sleep(0.1);
}
