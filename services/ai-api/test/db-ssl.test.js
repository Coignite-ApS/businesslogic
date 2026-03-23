import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the SSL configuration helper directly
import { sslConfigFromUrl } from '../src/db.js';

describe('DB SSL configuration', () => {
  it('returns false when URL has no sslmode', () => {
    const result = sslConfigFromUrl('postgresql://user:pass@localhost:5432/db');
    assert.equal(result, false);
  });

  it('returns ssl config when URL has sslmode=require', () => {
    const result = sslConfigFromUrl('postgresql://user:pass@host:5432/db?sslmode=require');
    assert.deepEqual(result, { rejectUnauthorized: false });
  });

  it('returns ssl config when URL has sslmode=verify-full', () => {
    const result = sslConfigFromUrl('postgresql://user:pass@host:5432/db?sslmode=verify-full');
    assert.deepEqual(result, { rejectUnauthorized: true });
  });

  it('returns false when URL has sslmode=disable', () => {
    const result = sslConfigFromUrl('postgresql://user:pass@host:5432/db?sslmode=disable');
    assert.equal(result, false);
  });

  it('returns false when URL has sslmode=prefer', () => {
    const result = sslConfigFromUrl('postgresql://user:pass@host:5432/db?sslmode=prefer');
    assert.equal(result, false);
  });

  it('returns false for empty URL', () => {
    const result = sslConfigFromUrl('');
    assert.equal(result, false);
  });

  it('returns false for undefined', () => {
    const result = sslConfigFromUrl(undefined);
    assert.equal(result, false);
  });
});
