import pg from 'pg';

const { Pool } = pg;

let pool = null;

/**
 * Derive pg SSL config from a connection URL's sslmode parameter.
 * Returns false (no SSL) or an SSL options object.
 */
export function sslConfigFromUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const mode = parsed.searchParams.get('sslmode');
    if (mode === 'require') return { rejectUnauthorized: false };
    if (mode === 'verify-ca' || mode === 'verify-full') return { rejectUnauthorized: true };
    return false;
  } catch {
    return false;
  }
}

export function getPool() {
  return pool;
}

export async function initDb(databaseUrl) {
  if (!databaseUrl) return null;
  const ssl = sslConfigFromUrl(databaseUrl);
  pool = new Pool({ connectionString: databaseUrl, max: 10, ...(ssl && { ssl }) });
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
