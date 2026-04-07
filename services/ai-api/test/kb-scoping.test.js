import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAllowedKbIds, assertKbAccess } from '../src/utils/kb-access.js';

describe('KB scoping - verifyKbOwnership integration', () => {
  it('assertKbAccess blocks access to KB not in allowed list', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['allowed-kb-1'] } },
      },
    };
    try {
      assertKbAccess(req, 'other-kb-999');
      assert.fail('Should have thrown 403');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
    }
  });

  it('assertKbAccess allows access to KB in allowed list', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['allowed-kb-1', 'allowed-kb-2'] } },
      },
    };
    assert.doesNotThrow(() => assertKbAccess(req, 'allowed-kb-1'));
  });

  it('assertKbAccess allows all KBs when unrestricted (no permissionsRaw)', () => {
    assert.doesNotThrow(() => assertKbAccess({}, 'any-kb'));
  });

  it('assertKbAccess allows all KBs when wildcard', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['*'] } },
      },
    };
    assert.doesNotThrow(() => assertKbAccess(req, 'any-kb'));
  });
});

describe('KB scoping - list filtering', () => {
  it('getAllowedKbIds returns specific IDs for scoped key', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-1', 'kb-2'] } },
      },
    };
    assert.deepStrictEqual(getAllowedKbIds(req), ['kb-1', 'kb-2']);
  });

  it('getAllowedKbIds returns null for unrestricted key', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['*'] } },
      },
    };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('getAllowedKbIds returns empty array for empty resources (no access)', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: [] } },
      },
    };
    assert.deepStrictEqual(getAllowedKbIds(req), []);
  });
});
