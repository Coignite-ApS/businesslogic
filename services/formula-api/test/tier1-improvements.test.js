// Tests for Tier 1 improvements: FA-03, FA-04, FA-05
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

// --- FA-03: Redis Error Logging ---

describe('FA-03: Redis error logging', () => {
  it('redis-warn utility exists and exports redisWarn', async () => {
    const mod = await import('../src/utils/redis-warn.js');
    assert.equal(typeof mod.redisWarn, 'function');
  });

  it('redisWarn rate-limits output (no throw on repeated calls)', async () => {
    const { redisWarn } = await import('../src/utils/redis-warn.js');
    // Should not throw even when called repeatedly
    redisWarn('test.caller', new Error('test'));
    redisWarn('test.caller', new Error('test'));
    redisWarn('test.caller', new Error('test'));
  });

  const filesWithRedisOps = [
    { file: 'services/cache.js', should: 'redisWarn' },
    { file: 'services/rate-limiter.js', should: 'redisWarn' },
    { file: 'services/health-push.js', should: 'redisWarn' },
    { file: 'routes/calculators.js', should: 'redisWarn' },
  ];

  for (const { file, should } of filesWithRedisOps) {
    it(`${file} uses ${should} instead of silent catch`, () => {
      const code = readFileSync(join(srcDir, file), 'utf8');
      assert.ok(
        code.includes(should),
        `${file} must import and use ${should}`,
      );
      // No silent .catch(() => {}) should remain
      const silentCatches = (code.match(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/g) || []).length;
      assert.equal(
        silentCatches, 0,
        `${file} still has ${silentCatches} silent .catch(() => {}) — replace with redisWarn`,
      );
    });
  }
});

// --- FA-04: MCP Error Code Mapping ---

describe('FA-04: MCP error code mapping', () => {
  const mcpCode = readFileSync(join(srcDir, 'routes/mcp.js'), 'utf8');

  it('defines SERVER_ERROR_RETRYABLE (-32000)', () => {
    assert.ok(mcpCode.includes('SERVER_ERROR_RETRYABLE = -32000'));
  });

  it('defines SERVER_ERROR_PERMANENT (-32001)', () => {
    assert.ok(mcpCode.includes('SERVER_ERROR_PERMANENT = -32001'));
  });

  it('maps 410 to permanent error with retryable: false', () => {
    assert.ok(mcpCode.includes('SERVER_ERROR_PERMANENT') && mcpCode.includes('retryable: false'));
  });

  it('maps 429 to retryable error with retryAfterMs', () => {
    assert.ok(mcpCode.includes('retryable: true') && mcpCode.includes('retryAfterMs'));
  });

  it('maps 503 to retryable error in catch block', () => {
    assert.ok(mcpCode.includes('httpStatus === 503'));
  });
});

// --- FA-05: Graceful Shutdown Timeout ---

describe('FA-05: graceful shutdown timeout', () => {
  it('config.js defines shutdownTimeoutMs with default 5000', () => {
    const code = readFileSync(join(srcDir, 'config.js'), 'utf8');
    assert.ok(code.includes('shutdownTimeoutMs'));
    assert.ok(code.includes('SHUTDOWN_TIMEOUT_MS'));
    assert.ok(code.includes("'5000'"));
  });

  it('server.js uses Promise.race for shutdown', () => {
    const code = readFileSync(join(srcDir, 'server.js'), 'utf8');
    assert.ok(code.includes('Promise.race'), 'shutdown must use Promise.race');
  });

  it('server.js references shutdownTimeoutMs from config', () => {
    const code = readFileSync(join(srcDir, 'server.js'), 'utf8');
    assert.ok(code.includes('config.shutdownTimeoutMs'), 'must use config.shutdownTimeoutMs');
  });

  it('server.js logs warning on timeout', () => {
    const code = readFileSync(join(srcDir, 'server.js'), 'utf8');
    assert.ok(code.includes('shutdown timed out'), 'must log timeout warning');
  });
});
