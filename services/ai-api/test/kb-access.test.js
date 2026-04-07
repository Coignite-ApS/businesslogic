import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAllowedKbIds, assertKbAccess } from '../src/utils/kb-access.js';

describe('getAllowedKbIds', () => {
  it('returns null when no permissionsRaw (admin/no restrictions)', () => {
    assert.strictEqual(getAllowedKbIds({}), null);
    assert.strictEqual(getAllowedKbIds({ permissionsRaw: null }), null);
    assert.strictEqual(getAllowedKbIds({ permissionsRaw: undefined }), null);
  });

  it('returns null when kb service missing (unrestricted)', () => {
    const req = { permissionsRaw: { services: { ai: { enabled: true } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when kb.resources is null (all KBs)', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: null } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when kb.resources is missing (all KBs)', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when kb.resources contains wildcard', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['*'] } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns specific UUIDs when kb.resources is an array', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['uuid-1', 'uuid-2'] } } } };
    const result = getAllowedKbIds(req);
    assert.deepStrictEqual(result, ['uuid-1', 'uuid-2']);
  });

  it('returns empty array when kb.resources is empty (no access)', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: [] } } } };
    const result = getAllowedKbIds(req);
    assert.deepStrictEqual(result, []);
  });

  it('returns null when kb.enabled is false', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: false, resources: ['uuid-1'] } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when services is null', () => {
    const req = { permissionsRaw: { services: null } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });
});

describe('assertKbAccess', () => {
  it('does not throw when allowed is null (unrestricted)', () => {
    const req = {};
    assert.doesNotThrow(() => assertKbAccess(req, 'any-uuid'));
  });

  it('does not throw when kbId is in allowed list', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['uuid-1', 'uuid-2'] } } } };
    assert.doesNotThrow(() => assertKbAccess(req, 'uuid-1'));
  });

  it('throws 403 when kbId is not in allowed list', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['uuid-1'] } } } };
    try {
      assertKbAccess(req, 'uuid-999');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
      assert.ok(err.message.includes('does not have access'));
    }
  });

  it('throws 403 when allowed list is empty', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: [] } } } };
    try {
      assertKbAccess(req, 'uuid-1');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
    }
  });
});
