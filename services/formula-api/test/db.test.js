// Unit tests for formula-api db module
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sslConfigFromUrl, initDb, closeDb, getPool, query, queryOne, queryAll } from '../src/db.js';

describe('sslConfigFromUrl', () => {
  it('returns false for null', () => {
    assert.equal(sslConfigFromUrl(null), false);
  });

  it('returns false for no sslmode', () => {
    assert.equal(sslConfigFromUrl('postgresql://user:pass@host/db'), false);
  });

  it('returns rejectUnauthorized:false for sslmode=require', () => {
    const ssl = sslConfigFromUrl('postgresql://user:pass@host/db?sslmode=require');
    assert.deepEqual(ssl, { rejectUnauthorized: false });
  });

  it('returns rejectUnauthorized:true for sslmode=verify-full', () => {
    const ssl = sslConfigFromUrl('postgresql://user:pass@host/db?sslmode=verify-full');
    assert.deepEqual(ssl, { rejectUnauthorized: true });
  });

  it('returns false for invalid URL', () => {
    assert.equal(sslConfigFromUrl('not-a-url'), false);
  });
});

describe('db pool', () => {
  const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://directus:directus@localhost:15432/directus';

  before(async () => {
    await initDb(DATABASE_URL);
  });

  after(async () => {
    await closeDb();
  });

  it('getPool returns a Pool after initDb', () => {
    const pool = getPool();
    assert.ok(pool, 'pool should be non-null after initDb');
  });

  it('query executes SQL', async () => {
    const result = await query('SELECT 1 AS val');
    assert.equal(result.rows[0].val, 1);
  });

  it('queryOne returns single row', async () => {
    const row = await queryOne('SELECT 42 AS answer');
    assert.equal(row.answer, 42);
  });

  it('queryOne returns null when no rows', async () => {
    const row = await queryOne('SELECT 1 WHERE false');
    assert.equal(row, null);
  });

  it('queryAll returns array', async () => {
    const rows = await queryAll('SELECT generate_series(1, 3) AS n');
    assert.equal(rows.length, 3);
    assert.equal(rows[0].n, 1);
  });

  it('closeDb sets pool to null', async () => {
    await closeDb();
    assert.equal(getPool(), null);
    // Re-init so after() doesn't fail
    await initDb(DATABASE_URL);
  });
});
