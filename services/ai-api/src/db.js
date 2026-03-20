import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function getPool() {
  return pool;
}

export async function initDb(databaseUrl) {
  if (!databaseUrl) return null;
  pool = new Pool({ connectionString: databaseUrl, max: 20 });
  // Test connection
  const client = await pool.connect();
  client.release();
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Run a parameterized query */
export async function query(text, params = []) {
  if (!pool) throw new Error('Database not initialized');
  return pool.query(text, params);
}

/** Get a single row */
export async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

/** Get all rows */
export async function queryAll(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}
