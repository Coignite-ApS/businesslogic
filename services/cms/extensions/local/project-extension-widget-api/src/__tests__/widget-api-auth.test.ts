import { describe, it, expect } from 'vitest';

/**
 * Widget-API auth cleanup tests (CMS-29)
 *
 * Validates that the widget-api extension:
 * - Uses X-Admin-Token for describe calls (not X-Auth-Token passthrough)
 * - Calls formula-api directly with admin auth
 * - Still uses gateway for cache invalidation
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf-8');

describe('widget-api auth cleanup (CMS-29)', () => {
  it('does not pass X-Auth-Token to any backend', () => {
    expect(indexSource).not.toContain('X-Auth-Token');
    expect(indexSource).not.toContain('x-auth-token');
  });

  it('uses FORMULA_API_URL for describe calls', () => {
    expect(indexSource).toContain('formulaApiUrl');
    const describeMatch = indexSource.match(/fetch\(\s*`\$\{(\w+)\}.*describe/);
    expect(describeMatch).not.toBeNull();
    expect(describeMatch![1]).toBe('formulaApiUrl');
  });

  it('sends X-Admin-Token on describe requests', () => {
    expect(indexSource).toContain("'X-Admin-Token'");
    expect(indexSource).toContain('formulaAdminToken');
  });

  it('reads FORMULA_API_ADMIN_TOKEN from env', () => {
    expect(indexSource).toContain("FORMULA_API_ADMIN_TOKEN");
  });

  it('still has cache invalidation via gateway with X-Internal-Secret', () => {
    expect(indexSource).toContain('/internal/cache/invalidate');
    expect(indexSource).toContain("'X-Internal-Secret'");
  });
});
