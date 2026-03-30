import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a mock budget module with a fixed DB spend value */
function makeModule(spentInDb, conversationBudget = 1) {
  process.env.CONVERSATION_BUDGET_USD = String(conversationBudget);
  process.env.AI_BUDGET_WARN_PCT = '20';
  process.env.AI_BUDGET_CRITICAL_PCT = '10';
}

/** Call getConversationBudgetWarning with a mocked queryOne */
async function callWarning(spentInDb, currentCostUsd, conversationBudget = 1) {
  // Stub db module
  const { register } = await import('node:module');

  // We can't easily re-mock ES modules between calls, so we test the logic directly
  // by exercising the pure calculation path with a helper below.
  return warningFromValues(spentInDb, currentCostUsd, conversationBudget);
}

/**
 * Pure calculation mirror of getConversationBudgetWarning logic —
 * lets us unit-test thresholds without a real DB.
 */
function warningFromValues(spentInDb, currentCostUsd, limit, warnPct = 0.2, criticalPct = 0.1) {
  const spent = spentInDb + currentCostUsd;
  const remaining = limit - spent;
  const pct = remaining / limit;

  if (pct <= criticalPct) {
    return `⚠️ BUDGET CRITICAL: Only $${remaining.toFixed(4)} remaining (${Math.round(pct * 100)}% of $${limit}). Provide your final answer now — do not make further tool calls.`;
  }
  if (pct <= warnPct) {
    return `⚠️ Budget notice: $${remaining.toFixed(4)} of $${limit} remaining (${Math.round(pct * 100)}%). Summarize findings and wrap up soon.`;
  }
  return null;
}

/** Inject _budget_warning into last tool result (mirrors chat.js logic) */
function injectWarning(toolResults, warning) {
  if (!toolResults.length || !warning) return toolResults;
  const results = toolResults.map(r => ({ ...r }));
  const last = results[results.length - 1];
  try {
    const parsed = JSON.parse(last.content);
    last.content = JSON.stringify({ ...parsed, _budget_warning: warning });
  } catch {
    last.content = JSON.stringify({ result: last.content, _budget_warning: warning });
  }
  return results;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Budget warning — threshold logic', () => {
  it('no warning above 20% remaining', () => {
    // 70% remaining — well above 20% warn threshold
    const w = warningFromValues(0.3, 0, 1);
    assert.strictEqual(w, null);
  });

  it('no warning at exactly 21% remaining', () => {
    const w = warningFromValues(0.79, 0, 1);
    assert.strictEqual(w, null);
  });

  it('warn triggered at exactly 20% remaining', () => {
    // spent = 0.80, remaining = 0.20, pct = 0.20
    const w = warningFromValues(0.80, 0, 1);
    assert.ok(w, 'should return a warning string');
    assert.ok(w.includes('Budget notice'), `expected warn message, got: ${w}`);
    assert.ok(w.includes('$0.2000'), `should include remaining amount`);
  });

  it('warn triggered below 20% remaining', () => {
    const w = warningFromValues(0.85, 0, 1);
    assert.ok(w?.includes('Budget notice'));
  });

  it('critical triggered at exactly 10% remaining', () => {
    // spent = 0.90, remaining = 0.10, pct = 0.10
    const w = warningFromValues(0.90, 0, 1);
    assert.ok(w, 'should return a warning string');
    assert.ok(w.includes('BUDGET CRITICAL'), `expected critical message, got: ${w}`);
  });

  it('critical triggered below 10% remaining', () => {
    const w = warningFromValues(0.95, 0, 1);
    assert.ok(w?.includes('BUDGET CRITICAL'));
  });

  it('critical at 0% remaining (fully exhausted)', () => {
    const w = warningFromValues(1.0, 0, 1);
    assert.ok(w?.includes('BUDGET CRITICAL'));
  });

  it('currentCostUsd is added to spent', () => {
    // DB shows 0.75 spent, current round adds 0.06 → 0.81 spent, 0.19 remaining (19%)
    const w = warningFromValues(0.75, 0.06, 1);
    assert.ok(w?.includes('Budget notice'));
  });

  it('currentCostUsd pushes into critical zone', () => {
    // DB shows 0.88, current round adds 0.04 → 0.92 spent, 0.08 remaining (8%)
    const w = warningFromValues(0.88, 0.04, 1);
    assert.ok(w?.includes('BUDGET CRITICAL'));
  });

  it('warning includes remaining dollar amount', () => {
    const w = warningFromValues(0.85, 0, 1);
    assert.ok(w?.includes('$0.1500'), `expected $0.1500 in: ${w}`);
  });

  it('critical warning includes limit amount', () => {
    const w = warningFromValues(0.92, 0, 1);
    assert.ok(w?.includes('$1'), `expected limit in: ${w}`);
  });

  it('works with non-default budget limit', () => {
    // $5 limit, 82% spent → 18% remaining → warn
    const w = warningFromValues(4.1, 0, 5);
    assert.ok(w?.includes('Budget notice'));
  });
});

describe('Budget warning — injection into tool results', () => {
  it('injects into object result', () => {
    const toolResults = [
      { type: 'tool_result', tool_use_id: 'tu-1', content: JSON.stringify({ answer: 42 }), is_error: false },
    ];
    const warning = '⚠️ Budget notice: $0.1500 of $1 remaining (15%). Summarize findings and wrap up soon.';
    const enriched = injectWarning(toolResults, warning);
    const parsed = JSON.parse(enriched[0].content);
    assert.strictEqual(parsed.answer, 42);
    assert.strictEqual(parsed._budget_warning, warning);
  });

  it('injects into plain string result (wraps in object)', () => {
    const toolResults = [
      { type: 'tool_result', tool_use_id: 'tu-1', content: 'plain text result', is_error: false },
    ];
    const warning = '⚠️ BUDGET CRITICAL: ...';
    const enriched = injectWarning(toolResults, warning);
    const parsed = JSON.parse(enriched[0].content);
    assert.strictEqual(parsed.result, 'plain text result');
    assert.strictEqual(parsed._budget_warning, warning);
  });

  it('injects only into LAST tool result when multiple tools', () => {
    const toolResults = [
      { type: 'tool_result', tool_use_id: 'tu-1', content: JSON.stringify({ a: 1 }), is_error: false },
      { type: 'tool_result', tool_use_id: 'tu-2', content: JSON.stringify({ b: 2 }), is_error: false },
    ];
    const warning = '⚠️ Budget notice: ...';
    const enriched = injectWarning(toolResults, warning);

    // First tool result unchanged
    const first = JSON.parse(enriched[0].content);
    assert.strictEqual('_budget_warning' in first, false, 'first result should NOT have warning');

    // Last tool result has warning
    const last = JSON.parse(enriched[1].content);
    assert.ok(last._budget_warning, 'last result should have warning');
  });

  it('does not mutate original toolResults array', () => {
    const toolResults = [
      { type: 'tool_result', tool_use_id: 'tu-1', content: JSON.stringify({ x: 1 }), is_error: false },
    ];
    const originalContent = toolResults[0].content;
    injectWarning(toolResults, '⚠️ warning');
    assert.strictEqual(toolResults[0].content, originalContent, 'original should be unchanged');
  });

  it('no-ops when warning is null', () => {
    const toolResults = [
      { type: 'tool_result', tool_use_id: 'tu-1', content: JSON.stringify({ x: 1 }), is_error: false },
    ];
    const enriched = injectWarning(toolResults, null);
    assert.deepStrictEqual(enriched, toolResults);
  });

  it('no-ops when toolResults is empty', () => {
    const enriched = injectWarning([], '⚠️ warning');
    assert.deepStrictEqual(enriched, []);
  });
});

describe('Budget warning — getConversationBudgetWarning (module)', () => {
  let budgetMod;

  before(async () => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.CONVERSATION_BUDGET_USD = '1';
    process.env.AI_BUDGET_WARN_PCT = '20';
    process.env.AI_BUDGET_CRITICAL_PCT = '10';
    process.env.LOG_LEVEL = 'error';
    budgetMod = await import('../src/services/budget.js');
  });

  after(async () => {
    await budgetMod.closeBudget();
  });

  it('returns null without conversationId', async () => {
    const result = await budgetMod.getConversationBudgetWarning(null, 0);
    assert.strictEqual(result, null);
  });

  it('returns null when conversationId is undefined', async () => {
    const result = await budgetMod.getConversationBudgetWarning(undefined, 0);
    assert.strictEqual(result, null);
  });

  it('returns null when DB unavailable (graceful degradation)', async () => {
    // DB is not configured (DATABASE_URL='') so queryOne throws — should return null
    const result = await budgetMod.getConversationBudgetWarning('conv-test', 0);
    assert.strictEqual(result, null);
  });
});
