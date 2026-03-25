/**
 * Tests for POST /mcp/account/:accountId JSON-RPC handler.
 * Unit tests only — no live DB or Redis required.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// ── helpers ──────────────────────────────────────────────────────────────────

const SHARED_SECRET = 'test-gateway-secret-xyz';

function makeGatewayHeaders(accountId, keyId = 'key-1', secret = SHARED_SECRET, tsOverride) {
  const ts = String(tsOverride ?? Date.now());
  const payload = `${accountId}|${keyId}|${ts}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'x-gateway-auth': 'true',
    'x-gateway-signature': sig,
    'x-gateway-timestamp': ts,
    'x-account-id': accountId,
    'x-api-key-id': keyId,
  };
}

// ── unit: account MCP handler helpers ────────────────────────────────────────

describe('account MCP — buildAccountTools', () => {
  let buildAccountTools;

  before(async () => {
    const mod = await import('../src/routes/mcp.js');
    buildAccountTools = mod._buildAccountTools;
  });

  it('exports _buildAccountTools helper', () => {
    assert.equal(typeof buildAccountTools, 'function');
  });

  it('filters out calculators without mcp.enabled', () => {
    const rows = [
      { id: 'c1', name: 'calc1', mcp: { enabled: false, toolName: 'tool1', toolDescription: 'desc1' }, input: { type: 'object', properties: {} } },
      { id: 'c2', name: 'calc2', mcp: { enabled: true, toolName: 'tool2', toolDescription: 'desc2' }, input: { type: 'object', properties: {} } },
    ];
    const tools = buildAccountTools(rows);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'tool2');
  });

  it('filters out rows with null mcp', () => {
    const rows = [
      { id: 'c1', name: 'calc1', mcp: null, input: { type: 'object', properties: {} } },
    ];
    const tools = buildAccountTools(rows);
    assert.equal(tools.length, 0);
  });

  it('builds tool with correct shape', () => {
    const rows = [
      {
        id: 'c1',
        name: 'calc1',
        mcp: { enabled: true, toolName: 'loan_calculator', toolDescription: 'Calculates loan' },
        input: { type: 'object', properties: { amount: { type: 'number', title: 'Loan Amount' } }, required: ['amount'] },
      },
    ];
    const tools = buildAccountTools(rows);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'loan_calculator');
    assert.equal(tools[0].description, 'Calculates loan');
    assert.ok(tools[0].inputSchema);
    assert.equal(tools[0].inputSchema.type, 'object');
    // calculatorId must be attached for routing tools/call
    assert.equal(tools[0]._calculatorId, 'c1');
  });

  it('uses empty string description when not set', () => {
    const rows = [
      {
        id: 'c2',
        name: 'calc2',
        mcp: { enabled: true, toolName: 'tool2' },
        input: { type: 'object', properties: {} },
      },
    ];
    const tools = buildAccountTools(rows);
    assert.equal(tools[0].description, '');
  });
});

// ── unit: JSON-RPC method routing ─────────────────────────────────────────────

describe('account MCP — JSON-RPC methods', () => {
  it('module exports registerRoutes', async () => {
    const mod = await import('../src/routes/mcp.js');
    assert.equal(typeof mod.registerRoutes, 'function');
  });
});

// ── unit: gateway auth for account endpoint ───────────────────────────────────
// Set env before module is loaded (config reads env at import time)
process.env.GATEWAY_SHARED_SECRET = SHARED_SECRET;

describe('account MCP — HMAC auth requirement', () => {
  it('validateGatewayAuth accepts correct signature', async () => {
    const { validateGatewayAuth } = await import('../src/utils/auth.js');
    const headers = makeGatewayHeaders('acc-42');
    const result = validateGatewayAuth({ headers });
    assert.ok(result !== null, 'should accept valid gateway signature');
    assert.equal(result.accountId, 'acc-42');
  });

  it('validateGatewayAuth rejects bad signature', async () => {
    const { validateGatewayAuth } = await import('../src/utils/auth.js');
    const headers = makeGatewayHeaders('acc-42', 'key-1', 'wrong-secret');
    const result = validateGatewayAuth({ headers });
    assert.equal(result, null);
  });

  it('validateGatewayAuth rejects stale timestamp', async () => {
    const { validateGatewayAuth } = await import('../src/utils/auth.js');
    const headers = makeGatewayHeaders('acc-42', 'key-1', SHARED_SECRET, Date.now() - 60_000);
    const result = validateGatewayAuth({ headers });
    assert.equal(result, null);
  });
});

// ── unit: account MCP cache key format ────────────────────────────────────────

describe('account MCP — cache key format', () => {
  it('cache key follows fa:mcp:account:{accountId} pattern', async () => {
    const mod = await import('../src/routes/mcp.js');
    const getKey = mod._getAccountMcpCacheKey;
    assert.equal(typeof getKey, 'function');
    assert.equal(getKey('abc-123'), 'fa:mcp:account:abc-123');
  });
});

// ── unit: stats record with mcp_call type ────────────────────────────────────

describe('account MCP — stats type', () => {
  it('stats.record is a no-op without DB (does not throw)', async () => {
    const stats = await import('../src/services/stats.js');
    assert.doesNotThrow(() => stats.record({
      calculatorId: 'test-c1',
      cached: false,
      error: false,
      responseTimeMs: 50,
      type: 'mcp_call',
      account: 'acc-42',
    }));
  });
});
