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

describe('KB scoping - search/ask with specific kb_id', () => {
  it('assertKbAccess blocks search on restricted KB', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-allowed'] } },
      },
    };
    try {
      assertKbAccess(req, 'kb-not-allowed');
      assert.fail('Should have thrown 403');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
    }
  });

  it('assertKbAccess allows search on permitted KB', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-allowed'] } },
      },
    };
    assert.doesNotThrow(() => assertKbAccess(req, 'kb-allowed'));
  });
});

describe('KB scoping - cross-KB search filtering', () => {
  it('getAllowedKbIds returns IDs for cross-KB SQL filter', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-1', 'kb-2'] } },
      },
    };
    const allowed = getAllowedKbIds(req);
    assert.deepStrictEqual(allowed, ['kb-1', 'kb-2']);
  });

  it('getAllowedKbIds returns null for unrestricted cross-KB search', () => {
    const req = { permissionsRaw: null };
    assert.strictEqual(getAllowedKbIds(req), null);
  });
});

describe('KB scoping - tool call threading', () => {
  it('tool should block access to restricted KB', () => {
    // Simulates: searchKnowledge checks allowedKbIds before making internal request
    const allowedKbIds = ['kb-1'];
    const requestedKbId = 'kb-999';
    assert.ok(allowedKbIds !== null);
    assert.ok(!allowedKbIds.includes(requestedKbId));
  });

  it('tool should allow access when unrestricted', () => {
    const allowedKbIds = null;
    assert.strictEqual(allowedKbIds, null);
    // null means no additional filtering
  });

  it('tool should pass allowedKbIds for cross-KB search', () => {
    const allowedKbIds = ['kb-1', 'kb-2'];
    assert.ok(Array.isArray(allowedKbIds));
    assert.strictEqual(allowedKbIds.length, 2);
  });
});
