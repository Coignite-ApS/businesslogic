import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceRoot = join(__dirname, '..');

const script = `
  import { validateSecrets } from './src/config.js';
  validateSecrets();
  console.log('STARTUP_OK');
`;

function runValidation(env) {
  const r = spawnSync('node', ['--input-type=module', '-e', script], {
    cwd: serviceRoot,
    env: { ...process.env, ...env },
    timeout: 5000,
    encoding: 'utf8',
  });
  return { exitCode: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

describe('formula-api startup secret validation', () => {
  it('exits with error when GATEWAY_SHARED_SECRET missing', () => {
    const r = runValidation({ ADMIN_TOKEN: 'tok', GATEWAY_SHARED_SECRET: '', SKIP_SECRET_VALIDATION: '' });
    assert.notStrictEqual(r.exitCode, 0);
    assert.ok(r.stderr.includes('GATEWAY_SHARED_SECRET'));
  });

  it('exits with error when FORMULA_API_ADMIN_TOKEN missing', () => {
    const r = runValidation({ GATEWAY_SHARED_SECRET: 'sec', ADMIN_TOKEN: '', SKIP_SECRET_VALIDATION: '' });
    assert.notStrictEqual(r.exitCode, 0);
    assert.ok(r.stderr.includes('FORMULA_API_ADMIN_TOKEN'));
  });

  it('exits with error when both secrets missing', () => {
    const r = runValidation({ GATEWAY_SHARED_SECRET: '', ADMIN_TOKEN: '', SKIP_SECRET_VALIDATION: '' });
    assert.notStrictEqual(r.exitCode, 0);
    assert.ok(r.stderr.includes('GATEWAY_SHARED_SECRET'));
    assert.ok(r.stderr.includes('FORMULA_API_ADMIN_TOKEN'));
  });

  it('starts OK when all secrets provided', () => {
    const r = runValidation({ GATEWAY_SHARED_SECRET: 'sec', ADMIN_TOKEN: 'tok' });
    assert.strictEqual(r.exitCode, 0);
    assert.ok(r.stdout.includes('STARTUP_OK'));
  });

  it('warns but continues when SKIP_SECRET_VALIDATION=true', () => {
    const r = runValidation({ GATEWAY_SHARED_SECRET: '', ADMIN_TOKEN: '', SKIP_SECRET_VALIDATION: 'true' });
    assert.strictEqual(r.exitCode, 0);
    assert.ok(r.stdout.includes('STARTUP_OK'));
  });
});
