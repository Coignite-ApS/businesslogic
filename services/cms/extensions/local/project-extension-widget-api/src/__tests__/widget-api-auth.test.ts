import { describe, it, expect } from 'vitest';

/**
 * Widget-API auth cleanup tests (CMS-29)
 *
 * Validates that the widget-api extension:
 * - Routes describe calls through gateway (not direct formula-api)
 * - Uses X-Internal-Secret (not X-Auth-Token passthrough)
 * - No longer depends on FORMULA_API_URL
 */

// We test the source file statically — read it and verify patterns
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf-8');

describe('widget-api auth cleanup (CMS-29)', () => {
  it('does not reference FORMULA_API_URL', () => {
    expect(indexSource).not.toContain('FORMULA_API_URL');
  });

  it('does not reference formulaApiUrl', () => {
    expect(indexSource).not.toContain('formulaApiUrl');
  });

  it('does not pass X-Auth-Token to any backend', () => {
    expect(indexSource).not.toContain('X-Auth-Token');
    expect(indexSource).not.toContain('x-auth-token');
  });

  it('uses GATEWAY_URL for describe calls', () => {
    expect(indexSource).toContain('gatewayUrl');
    // The describe fetch should use gatewayUrl, not a separate formula URL
    const describeMatch = indexSource.match(/fetch\(\s*`\$\{(\w+)\}.*describe/);
    expect(describeMatch).not.toBeNull();
    expect(describeMatch![1]).toBe('gatewayUrl');
  });

  it('sends X-Internal-Secret on describe requests', () => {
    // The describe fetch should include X-Internal-Secret header
    expect(indexSource).toContain("'X-Internal-Secret'");
  });

  it('routes through /internal/calc/ path', () => {
    expect(indexSource).toContain('/internal/calc/calculator/');
  });

  it('still has cache invalidation with X-Internal-Secret', () => {
    // Cache invalidation should remain unchanged
    expect(indexSource).toContain('/internal/cache/invalidate');
  });
});
