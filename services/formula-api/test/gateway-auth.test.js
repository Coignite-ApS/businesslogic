// Gateway auth utility tests
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';

// We test the auth functions directly via dynamic import
// since config needs to be set first
const mockConfig = {
  gatewaySharedSecret: 'test-shared-secret-123',
};

// Mock the config before importing auth
const originalEnv = process.env.GATEWAY_SHARED_SECRET;
process.env.GATEWAY_SHARED_SECRET = 'test-shared-secret-123';

const { isGatewayRequest, validateGatewayAuth, safeTokenCompare } = await import('../src/utils/auth.js');

function makeGatewayHeaders(accountId, keyId, secret, timestampOverride) {
  const ts = String(timestampOverride ?? Date.now());
  const payload = `${accountId}|${keyId}|${ts}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'x-gateway-auth': 'true',
    'x-gateway-signature': sig,
    'x-gateway-timestamp': ts,
    'x-account-id': accountId,
    'x-api-key-id': keyId,
    'x-api-permissions': JSON.stringify({ services: { calc: { enabled: true } } }),
  };
}

describe('isGatewayRequest', () => {
  it('returns true when gateway headers present', () => {
    const req = { headers: { 'x-gateway-auth': 'true', 'x-gateway-signature': 'abc' } };
    assert.strictEqual(isGatewayRequest(req), true);
  });

  it('returns false without gateway headers', () => {
    const req = { headers: {} };
    assert.strictEqual(isGatewayRequest(req), false);
  });

  it('returns false with spoofed x-gateway-auth but no signature', () => {
    const req = { headers: { 'x-gateway-auth': 'true' } };
    assert.strictEqual(isGatewayRequest(req), false);
  });
});

describe('validateGatewayAuth', () => {
  const secret = 'test-shared-secret-123';

  it('validates correct HMAC signature', () => {
    const headers = makeGatewayHeaders('acc-1', 'key-1', secret);
    const result = validateGatewayAuth({ headers });
    assert.ok(result, 'should return auth data');
    assert.strictEqual(result.accountId, 'acc-1');
    assert.strictEqual(result.keyId, 'key-1');
  });

  it('rejects invalid HMAC signature', () => {
    const headers = makeGatewayHeaders('acc-1', 'key-1', 'wrong-secret');
    const result = validateGatewayAuth({ headers });
    assert.strictEqual(result, null);
  });

  it('rejects old timestamp (replay attack)', () => {
    const oldTs = Date.now() - 60_000; // 60 seconds ago
    const headers = makeGatewayHeaders('acc-1', 'key-1', secret, oldTs);
    const result = validateGatewayAuth({ headers });
    assert.strictEqual(result, null);
  });

  it('rejects missing account ID', () => {
    const headers = makeGatewayHeaders('acc-1', 'key-1', secret);
    delete headers['x-account-id'];
    const result = validateGatewayAuth({ headers });
    assert.strictEqual(result, null);
  });

  it('parses permissions from header', () => {
    const headers = makeGatewayHeaders('acc-1', 'key-1', secret);
    const result = validateGatewayAuth({ headers });
    assert.ok(result.permissions.services);
    assert.strictEqual(result.permissions.services.calc.enabled, true);
  });
});

// Cleanup
if (originalEnv === undefined) {
  delete process.env.GATEWAY_SHARED_SECRET;
} else {
  process.env.GATEWAY_SHARED_SECRET = originalEnv;
}
