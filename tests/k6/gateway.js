import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const gatewayOverhead = new Trend('gateway_overhead_ms');

export const options = {
  scenarios: {
    // Smoke test: low load, verify correctness
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '10s',
      exec: 'smokeTest',
    },
    // Load test: sustained traffic
    load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      startTime: '15s',
      exec: 'loadTest',
    },
    // Spike test: sudden burst
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 100 },
        { duration: '10s', target: 100 },
        { duration: '5s', target: 0 },
      ],
      startTime: '50s',
      exec: 'loadTest',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<50'],  // p95 < 50ms total
    gateway_overhead_ms: ['p(95)<5'], // gateway adds < 5ms
    errors: ['rate<0.01'],            // < 1% error rate
  },
};

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:18080';
const API_KEY = __ENV.API_KEY || '';

const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};

export function smokeTest() {
  // Health endpoint (no auth required)
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    'health status 200': (r) => r.status === 200,
    'health has status field': (r) => JSON.parse(r.body).status !== undefined,
  });

  errorRate.add(health.status !== 200);
  gatewayOverhead.add(health.timings.duration);
}

export function loadTest() {
  const res = http.get(`${BASE_URL}/v1/calc/health`, { headers });

  const isOk = res.status === 200 || res.status === 401; // 401 if no key configured
  check(res, {
    'response ok or expected auth': () => isOk,
  });

  errorRate.add(!isOk);
  gatewayOverhead.add(res.timings.duration);
  sleep(0.01); // small pause to avoid overwhelming
}
