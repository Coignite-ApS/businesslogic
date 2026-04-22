// Cross-language envelope shape contract test (TypeScript side).
// Parses the canonical JSON fixture and asserts required fields/types.
// If this breaks, task 21's aggregator will silently mis-parse events.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'envelope-samples.json');

const VALID_MODULES = ['calculators', 'kb', 'flows', 'ai'];
const VALID_KINDS = [
  'calc.call',
  'kb.search',
  'kb.ask',
  'ai.message',
  'embed.tokens',
  'flow.execution',
  'flow.step',
  'flow.failed',
];

/** Minimal shape check — mirrors UsageEventEnvelope from src/types.ts */
function assertEnvelopeShape(sample, index) {
  assert.ok(
    typeof sample.account_id === 'string' && sample.account_id.length > 0,
    `[${index}] account_id must be non-empty string`,
  );
  assert.ok(
    sample.api_key_id === null || typeof sample.api_key_id === 'string',
    `[${index}] api_key_id must be string or null`,
  );
  assert.ok(
    VALID_MODULES.includes(sample.module),
    `[${index}] module "${sample.module}" not in ${VALID_MODULES}`,
  );
  assert.ok(
    VALID_KINDS.includes(sample.event_kind),
    `[${index}] event_kind "${sample.event_kind}" not in valid kinds`,
  );
  assert.ok(
    typeof sample.quantity === 'number' && sample.quantity >= 0,
    `[${index}] quantity must be non-negative number`,
  );
  assert.equal(sample.cost_eur, null, `[${index}] cost_eur must be null (computed by task 21)`);
  assert.ok(
    sample.metadata !== null && typeof sample.metadata === 'object',
    `[${index}] metadata must be an object`,
  );
  assert.ok(
    typeof sample.occurred_at === 'string' && sample.occurred_at.endsWith('Z'),
    `[${index}] occurred_at must be UTC ISO 8601`,
  );
}

describe('envelope-samples.json shape contract', () => {
  const samples = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

  it('fixture contains all 8 event kinds', () => {
    const kinds = new Set(samples.map((s) => s.event_kind));
    for (const k of VALID_KINDS) {
      assert.ok(kinds.has(k), `Missing event_kind: ${k}`);
    }
  });

  it('every sample matches envelope shape', () => {
    for (let i = 0; i < samples.length; i++) {
      assertEnvelopeShape(samples[i], i);
    }
  });

  it('calc.call metadata has expected fields', () => {
    const s = samples.find((e) => e.event_kind === 'calc.call');
    assert.ok(typeof s.metadata.formula_id === 'string');
    assert.ok(typeof s.metadata.duration_ms === 'number');
    assert.ok(typeof s.metadata.inputs_size_bytes === 'number');
  });

  it('ai.message quantity equals input_tokens + output_tokens', () => {
    const s = samples.find((e) => e.event_kind === 'ai.message');
    assert.equal(s.quantity, s.metadata.input_tokens + s.metadata.output_tokens);
  });

  it('flow.failed metadata has error field', () => {
    const s = samples.find((e) => e.event_kind === 'flow.failed');
    assert.ok(typeof s.metadata.error === 'string');
  });
});
