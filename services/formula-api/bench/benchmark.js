#!/usr/bin/env node
/**
 * Engine benchmark: HyperFormula vs bl-excel
 *
 * Measures memory, build time, eval latency, and calculator execution.
 * Starts the API server with each engine, runs tests, reports comparison.
 *
 * Usage:
 *   node bench/benchmark.js                  # full benchmark
 *   node bench/benchmark.js --engine bl-excel # single engine
 *   node bench/benchmark.js --quick           # fewer iterations
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'bench-token';
const PORT = parseInt(process.env.BENCH_PORT || '3099', 10);
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const singleEngine = args.find(a => a === '--engine') ? args[args.indexOf('--engine') + 1] : null;
const quick = args.includes('--quick');

// ── Helpers ──────────────────────────────────────────────────────────────────

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
    body: JSON.stringify(body),
  });
  return res.json();
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Admin-Token': ADMIN_TOKEN },
  });
  return res.json();
};

const del = async (path) => {
  await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Token': ADMIN_TOKEN },
  });
};

async function waitForServer(maxMs = 15000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/health`);
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Server did not start');
}

function startServer(engine) {
  const env = {
    ...process.env,
    ENGINE: engine,
    PORT: String(PORT),
    ADMIN_TOKEN,
    POOL_SIZE: '1',
    LOG_LEVEL: 'error',
    MAX_CALCULATORS: '50',
  };
  const child = spawn('node', ['src/server.js'], { cwd: ROOT, env, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.on('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3000);
  });
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(s.length * p / 100) - 1;
  return s[Math.max(0, idx)];
}

function fmt(ms) {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

function fmtMB(mb) {
  return `${mb.toFixed(1)}MB`;
}

// ── Benchmark Suites ─────────────────────────────────────────────────────────

async function benchEvalSingle(iterations = 200) {
  const formulas = [
    'SUM(1,2,3)',
    'IF(10>5,ROUND(3.14159*2,4),0)',
    'VLOOKUP(3,{1,10;2,20;3,30},2,FALSE)',
    'SUMPRODUCT({1,2,3},{4,5,6})',
    'PMT(0.05/12,360,200000)',
  ];

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const formula = formulas[i % formulas.length];
    const t0 = performance.now();
    await post('/execute', { formula });
    times.push(performance.now() - t0);
  }

  return {
    label: `evalSingle (${iterations} calls)`,
    p50: fmt(median(times)),
    p95: fmt(percentile(times, 95)),
    p99: fmt(percentile(times, 99)),
    avg: fmt(times.reduce((a, b) => a + b, 0) / times.length),
  };
}

async function benchEvalBatch(batchSize = 100, iterations = 20) {
  const formulas = Array.from({ length: batchSize }, (_, i) =>
    `SUM(${i},${i + 1},${i + 2})`
  );

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await post('/execute/batch', { formulas });
    times.push(performance.now() - t0);
  }

  return {
    label: `evalBatch (${batchSize} formulas × ${iterations})`,
    p50: fmt(median(times)),
    p95: fmt(percentile(times, 95)),
    avg: fmt(times.reduce((a, b) => a + b, 0) / times.length),
    throughput: `${Math.round(batchSize * iterations / (times.reduce((a, b) => a + b, 0) / 1000))} formulas/s`,
  };
}

async function benchCalculatorSmall() {
  const id = `bench-small-${Date.now()}`;
  // 100 cells, 50 formulas
  const rows = 50;
  const data = Array.from({ length: rows }, (_, r) => [r + 1, (r + 1) * 10]);
  const formulas = Array.from({ length: rows }, (_, r) => ({
    sheet: 'Sheet1', cell: `C${r + 1}`, formula: `A${r + 1}+B${r + 1}`,
  }));

  const t0 = performance.now();
  const result = await post('/calculator', {
    calculatorId: id, token: 'bench', accountId: 'bench',
    sheets: { Sheet1: data }, formulas,
    input: { type: 'object', properties: { v: { type: 'number', mapping: "'Sheet1'!A1", default: 0 } } },
    output: { type: 'object', properties: { total: { type: 'number', mapping: "'Sheet1'!C1" } } },
  });
  const buildMs = performance.now() - t0;

  // Execute
  const execTimes = [];
  const runs = quick ? 20 : 100;
  for (let i = 0; i < runs; i++) {
    const t1 = performance.now();
    await post(`/execute/calculator/${id}`, { v: i });
    execTimes.push(performance.now() - t1);
  }

  await del(`/calculator/${id}`);

  return {
    label: `calculator small (${rows} formulas)`,
    buildMs: fmt(buildMs),
    execP50: fmt(median(execTimes)),
    execP95: fmt(percentile(execTimes, 95)),
    profileBuildMs: result.profile?.buildMs,
  };
}

async function benchCalculatorMedium() {
  const id = `bench-med-${Date.now()}`;
  const rows = 500;
  const sheets = {
    Data: Array.from({ length: rows }, (_, r) => [r + 1, (r + 1) * 2, (r + 1) * 3]),
    Calc: Array.from({ length: rows }, () => [0, 0]),
  };
  const formulas = Array.from({ length: rows }, (_, r) => ({
    sheet: 'Calc', cell: `A${r + 1}`, formula: `Data!A${r + 1}+Data!B${r + 1}+Data!C${r + 1}`,
  }));
  // Add some aggregation formulas
  formulas.push(
    { sheet: 'Calc', cell: `B1`, formula: `SUM(A1:A${rows})` },
    { sheet: 'Calc', cell: `B2`, formula: `AVERAGE(A1:A${rows})` },
    { sheet: 'Calc', cell: `B3`, formula: `MAX(A1:A${rows})` },
  );

  const t0 = performance.now();
  const result = await post('/calculator', {
    calculatorId: id, token: 'bench', accountId: 'bench',
    sheets, formulas,
    input: { type: 'object', properties: { v: { type: 'number', mapping: "'Data'!A1", default: 0 } } },
    output: { type: 'object', properties: { sum: { type: 'number', mapping: "'Calc'!B1" } } },
  });
  const buildMs = performance.now() - t0;

  const execTimes = [];
  const runs = quick ? 10 : 50;
  for (let i = 0; i < runs; i++) {
    const t1 = performance.now();
    await post(`/execute/calculator/${id}`, { v: i });
    execTimes.push(performance.now() - t1);
  }

  await del(`/calculator/${id}`);

  return {
    label: `calculator medium (${formulas.length} formulas, 2 sheets)`,
    buildMs: fmt(buildMs),
    execP50: fmt(median(execTimes)),
    execP95: fmt(percentile(execTimes, 95)),
    profileBuildMs: result.profile?.buildMs,
  };
}

async function benchMemory() {
  // Get baseline memory
  const before = await get('/server/stats');
  const baseHeap = before.cluster?.totalHeapUsedMB ?? 0;

  // Create calculators at various sizes and measure heap delta
  const sizes = [50, 200, 500];
  const results = [];

  for (const rows of sizes) {
    const id = `bench-mem-${rows}-${Date.now()}`;
    const data = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: 10 }, (_, c) => r * 10 + c)
    );
    const formulas = Array.from({ length: rows }, (_, r) => ({
      sheet: 'Sheet1', cell: `K${r + 1}`, formula: `SUM(A${r + 1}:J${r + 1})`,
    }));

    const res = await post('/calculator', {
      calculatorId: id, token: 'bench', accountId: 'bench',
      sheets: { Sheet1: data }, formulas,
      input: { type: 'object', properties: { v: { type: 'number', mapping: "'Sheet1'!A1", default: 0 } } },
      output: { type: 'object', properties: { s: { type: 'number', mapping: "'Sheet1'!K1" } } },
    });

    const after = await get('/server/stats');
    const heapNow = after.cluster?.totalHeapUsedMB ?? 0;

    results.push({
      rows,
      cells: rows * 11,
      profileBuildMs: res.profile?.buildMs,
      heapDeltaMB: res.profile?.heapDeltaMB,
    });

    await del(`/calculator/${id}`);
  }

  // Final heap
  const finalStats = await get('/server/stats');
  const finalHeap = finalStats.cluster?.totalHeapUsedMB ?? 0;

  return { label: 'memory', baseHeapMB: fmtMB(baseHeap), finalHeapMB: fmtMB(finalHeap), sizes: results };
}

// ── Jaap calculator (if xlsx available) ──────────────────────────────────────

async function benchJaap() {
  const jaapPath = resolve(ROOT, 'tmp/jaap.xlsx');
  if (!existsSync(jaapPath)) return { label: 'jaap', skipped: true, reason: 'tmp/jaap.xlsx not found' };

  // Upload and parse
  const buf = readFileSync(jaapPath);
  const boundary = '----bench' + Date.now();
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="file"; filename="jaap.xlsx"\r\n`);
  parts.push(`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`);
  const header = Buffer.from(parts.join(''));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, buf, footer]);

  const res = await fetch(`${BASE}/parse/xlsx`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Admin-Token': ADMIN_TOKEN },
    body,
  });
  const parsed = await res.json();

  if (!parsed.calculatorId) return { label: 'jaap', error: 'parse failed', data: parsed };

  // Get memory after build
  const stats = await get('/server/stats');
  const heapMB = stats.cluster?.totalHeapUsedMB ?? 0;

  // Execute a few times
  const execTimes = [];
  const runs = quick ? 5 : 20;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await post(`/execute/calculator/${parsed.calculatorId}`, {});
    execTimes.push(performance.now() - t0);
  }

  const result = {
    label: 'jaap (38 sheets, ~34k formulas)',
    profile: parsed.profile,
    heapAfterMB: fmtMB(heapMB),
    execP50: fmt(median(execTimes)),
    execP95: fmt(percentile(execTimes, 95)),
  };

  await del(`/calculator/${parsed.calculatorId}`);
  return result;
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runBenchmarks(engine) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ENGINE = ${engine}`);
  console.log(`${'═'.repeat(60)}\n`);

  const server = startServer(engine);
  try {
    await waitForServer();

    const iters = quick ? 50 : 200;
    const results = {};

    results.evalSingle = await benchEvalSingle(iters);
    console.log('  ✓', results.evalSingle.label, `p50=${results.evalSingle.p50} p95=${results.evalSingle.p95}`);

    results.evalBatch = await benchEvalBatch(100, quick ? 5 : 20);
    console.log('  ✓', results.evalBatch.label, `avg=${results.evalBatch.avg} ${results.evalBatch.throughput}`);

    results.calcSmall = await benchCalculatorSmall();
    console.log('  ✓', results.calcSmall.label, `build=${results.calcSmall.buildMs} exec_p50=${results.calcSmall.execP50}`);

    results.calcMedium = await benchCalculatorMedium();
    console.log('  ✓', results.calcMedium.label, `build=${results.calcMedium.buildMs} exec_p50=${results.calcMedium.execP50}`);

    results.memory = await benchMemory();
    console.log('  ✓ memory:', results.memory.sizes.map(s => `${s.rows}r→${s.heapDeltaMB ?? '?'}MB`).join(', '));

    results.jaap = await benchJaap();
    if (results.jaap.skipped) {
      console.log('  ⊘ jaap: skipped —', results.jaap.reason);
    } else if (results.jaap.error) {
      console.log('  ✗ jaap:', results.jaap.error);
    } else {
      console.log('  ✓', results.jaap.label, `build=${results.jaap.profile?.buildMs}ms heap=${results.jaap.heapAfterMB} exec_p50=${results.jaap.execP50}`);
    }

    return results;
  } finally {
    await stopServer(server);
    await sleep(500); // port release
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nEngine Benchmark — ${new Date().toISOString()}`);
  console.log(`Mode: ${singleEngine || 'comparison'}, Quick: ${quick}\n`);

  const engines = singleEngine ? [singleEngine] : ['hyperformula', 'bl-excel'];
  const all = {};

  for (const engine of engines) {
    all[engine] = await runBenchmarks(engine);
  }

  if (engines.length === 2) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('  COMPARISON');
    console.log(`${'═'.repeat(60)}\n`);

    const hf = all.hyperformula;
    const bl = all['bl-excel'];

    const rows = [
      ['Metric', 'HyperFormula', 'bl-excel'],
      ['evalSingle p50', hf.evalSingle.p50, bl.evalSingle.p50],
      ['evalSingle p95', hf.evalSingle.p95, bl.evalSingle.p95],
      ['evalBatch throughput', hf.evalBatch.throughput, bl.evalBatch.throughput],
      ['calc small build', hf.calcSmall.buildMs, bl.calcSmall.buildMs],
      ['calc small exec p50', hf.calcSmall.execP50, bl.calcSmall.execP50],
      ['calc medium build', hf.calcMedium.buildMs, bl.calcMedium.buildMs],
      ['calc medium exec p50', hf.calcMedium.execP50, bl.calcMedium.execP50],
    ];

    if (hf.jaap?.profile && bl.jaap?.profile) {
      rows.push(
        ['jaap build', `${hf.jaap.profile.buildMs}ms`, `${bl.jaap.profile.buildMs}ms`],
        ['jaap heap', hf.jaap.heapAfterMB, bl.jaap.heapAfterMB],
        ['jaap exec p50', hf.jaap.execP50, bl.jaap.execP50],
      );
    }

    // Print table
    const colWidths = rows[0].map((_, ci) => Math.max(...rows.map(r => String(r[ci]).length)));
    for (const [i, row] of rows.entries()) {
      const line = row.map((cell, ci) => String(cell).padEnd(colWidths[ci])).join('  ');
      console.log(`  ${line}`);
      if (i === 0) console.log(`  ${colWidths.map(w => '─'.repeat(w)).join('  ')}`);
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
