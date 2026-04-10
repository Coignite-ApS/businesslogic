import { describe, it, expect } from 'vitest';

/**
 * Widget-API auth tests (CMS-29)
 *
 * Validates that the widget-api extension:
 * - Uses X-Internal-Secret for describe calls via gateway internal proxy
 * - Does not pass X-Auth-Token to any backend
 * - Uses gateway internal endpoint for cache invalidation
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf-8');

describe('widget-api auth (CMS-29)', () => {
  it('does not pass X-Auth-Token to any backend', () => {
    expect(indexSource).not.toContain('X-Auth-Token');
    expect(indexSource).not.toContain('x-auth-token');
  });

  it('uses gateway internal proxy for describe calls', () => {
    expect(indexSource).toContain('gatewayUrl');
    expect(indexSource).toContain('/internal/formula/calculator/');
    expect(indexSource).toContain('describe');
  });

  it('sends X-Internal-Secret on internal requests', () => {
    expect(indexSource).toContain("'X-Internal-Secret'");
    expect(indexSource).toContain('gatewayInternalSecret');
  });

  it('reads GATEWAY_INTERNAL_SECRET from env', () => {
    expect(indexSource).toContain("GATEWAY_INTERNAL_SECRET");
  });

  it('has cache invalidation via gateway with X-Internal-Secret', () => {
    expect(indexSource).toContain('/internal/cache/invalidate');
    expect(indexSource).toContain("'X-Internal-Secret'");
  });
});
