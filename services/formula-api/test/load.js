// Load testing script - run with: node test/load.js
// Requires: npm install -D autocannon

import autocannon from 'autocannon';

const BASE = process.env.API_URL || 'http://localhost:3000';

const tests = [
  {
    name: 'Single formula (SUM)',
    url: `${BASE}/execute`,
    method: 'POST',
    body: JSON.stringify({ formula: 'SUM(1,2,3,4,5)' }),
  },
  {
    name: 'Single formula (complex)',
    url: `${BASE}/execute`,
    method: 'POST',
    body: JSON.stringify({ formula: 'ROUND(AVERAGE(SUM(1,2,3),PRODUCT(2,3,4)),2)' }),
  },
  {
    name: 'Batch (10 formulas)',
    url: `${BASE}/execute/batch`,
    method: 'POST',
    body: JSON.stringify({
      formulas: Array.from({ length: 10 }, (_, i) => `SUM(${i},${i + 1})`),
    }),
  },
  {
    name: 'Batch (100 formulas)',
    url: `${BASE}/execute/batch`,
    method: 'POST',
    body: JSON.stringify({
      formulas: Array.from({ length: 100 }, (_, i) => `SUM(${i},${i + 1})`),
    }),
  },
];

async function run() {
  console.log('Load Testing Formula API\n');
  console.log('=' .repeat(60) + '\n');

  for (const test of tests) {
    console.log(`Test: ${test.name}`);
    console.log('-'.repeat(40));

    const result = await autocannon({
      url: test.url,
      method: test.method,
      headers: { 'Content-Type': 'application/json' },
      body: test.body,
      connections: 100,
      duration: 10,
      pipelining: 10,
    });

    console.log(`  Requests/sec: ${result.requests.average.toFixed(0)}`);
    console.log(`  Latency avg:  ${result.latency.average.toFixed(2)}ms`);
    console.log(`  Latency p99:  ${result.latency.p99.toFixed(2)}ms`);
    console.log(`  Throughput:   ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`);
    console.log(`  Errors:       ${result.errors}`);
    console.log('');
  }
}

run().catch(console.error);
