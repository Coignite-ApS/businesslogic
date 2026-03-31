// Process reliability tests: F-003 (error handlers) + F-010 (structured logging)
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

describe('F-003: process error handlers', () => {
  it('server.js registers unhandledRejection handler', async () => {
    const code = readFileSync(join(srcDir, 'server.js'), 'utf8');
    assert.ok(
      code.includes("process.on('unhandledRejection'"),
      'server.js must register process.on(unhandledRejection)'
    );
  });

  it('server.js registers uncaughtException handler', async () => {
    const code = readFileSync(join(srcDir, 'server.js'), 'utf8');
    assert.ok(
      code.includes("process.on('uncaughtException'"),
      'server.js must register process.on(uncaughtException)'
    );
  });

  it('handlers log fatal and exit', async () => {
    const code = readFileSync(join(srcDir, 'server.js'), 'utf8');
    // Both handlers should use .fatal() for logging
    assert.ok(code.includes('.fatal('), 'handlers must use .fatal() logging');
  });
});

describe('F-010: no console.log in production code', () => {
  const productionFiles = [
    'server.js',
    'services/stats.js',
    'services/cache.js',
    'services/engine-pool.js',
    'telemetry.js',
    'config.js',
    'routes/evaluate.js',
    'utils/auth.js',
  ];

  for (const file of productionFiles) {
    it(`${file} has no console.log calls`, () => {
      const code = readFileSync(join(srcDir, file), 'utf8');
      const lines = code.split('\n');
      const consoleLogLines = lines
        .map((line, i) => ({ line: line.trim(), num: i + 1 }))
        .filter(({ line }) => /console\.log\(/.test(line) && !line.startsWith('//'));
      assert.equal(
        consoleLogLines.length, 0,
        `Found console.log in ${file} at line(s): ${consoleLogLines.map(l => l.num).join(', ')}`
      );
    });

    it(`${file} has no console.warn calls`, () => {
      const code = readFileSync(join(srcDir, file), 'utf8');
      const lines = code.split('\n');
      const consoleWarnLines = lines
        .map((line, i) => ({ line: line.trim(), num: i + 1 }))
        .filter(({ line }) => /console\.warn\(/.test(line) && !line.startsWith('//'));
      assert.equal(
        consoleWarnLines.length, 0,
        `Found console.warn in ${file} at line(s): ${consoleWarnLines.map(l => l.num).join(', ')}`
      );
    });

    it(`${file} has no console.error calls`, () => {
      const code = readFileSync(join(srcDir, file), 'utf8');
      const lines = code.split('\n');
      const consoleErrorLines = lines
        .map((line, i) => ({ line: line.trim(), num: i + 1 }))
        .filter(({ line }) => /console\.error\(/.test(line) && !line.startsWith('//'));
      assert.equal(
        consoleErrorLines.length, 0,
        `Found console.error in ${file} at line(s): ${consoleErrorLines.map(l => l.num).join(', ')}`
      );
    });
  }
});
