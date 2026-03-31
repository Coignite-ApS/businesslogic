import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectCategories,
  getToolManifest,
  getToolsForCategories,
  TOOL_CATEGORIES,
} from '../src/services/tool-categories.js';
import { AI_TOOLS } from '../src/services/tools.js';

describe('tool-categories', () => {
  // ─── detectCategories ──────────────────────────────────────

  it('detects calculators from "build me a calculator"', () => {
    const cats = detectCategories('build me a calculator');
    assert.ok(cats.has('calculators'), 'should detect calculators');
  });

  it('detects calculators from "execute this formula"', () => {
    const cats = detectCategories('execute this formula');
    assert.ok(cats.has('calculators'));
  });

  it('detects knowledge from "search my documents"', () => {
    const cats = detectCategories('search my documents');
    assert.ok(cats.has('knowledge'));
  });

  it('detects knowledge from "ask a question from knowledge base"', () => {
    const cats = detectCategories('ask a question from knowledge base');
    assert.ok(cats.has('knowledge'));
  });

  it('returns empty set for a greeting', () => {
    const cats = detectCategories('hello, how are you?');
    assert.strictEqual(cats.size, 0);
  });

  it('returns empty set for generic question', () => {
    const cats = detectCategories('what can you do?');
    assert.strictEqual(cats.size, 0);
  });

  it('detects both categories from combined message', () => {
    const cats = detectCategories('search the KB and then execute the calculator');
    assert.ok(cats.has('calculators'), 'should detect calculators');
    assert.ok(cats.has('knowledge'), 'should detect knowledge');
  });

  it('sticky loading: previous calculator tool_use keeps calculators loaded', () => {
    const history = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'list_calculators', id: 'tu_1', input: {} },
        ],
      },
    ];
    // message has no keywords — sticky should pull it in
    const cats = detectCategories('ok thanks', history);
    assert.ok(cats.has('calculators'), 'calculators should be sticky');
  });

  it('sticky loading: previous knowledge tool_use keeps knowledge loaded', () => {
    const history = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'search_knowledge', id: 'tu_1', input: {} },
        ],
      },
    ];
    const cats = detectCategories('and what else?', history);
    assert.ok(cats.has('knowledge'), 'knowledge should be sticky');
  });

  it('ignores non-assistant messages in history', () => {
    const history = [
      { role: 'user', content: 'list my calculators' },
    ];
    const cats = detectCategories('thanks', history);
    // user message not sticky — no tool_use blocks
    assert.strictEqual(cats.size, 0);
  });

  // ─── getToolManifest ───────────────────────────────────────

  it('returns non-empty manifest with no permissions', () => {
    const manifest = getToolManifest(null, false);
    assert.ok(manifest.length > 0);
    assert.ok(manifest.includes('Calculators'));
    assert.ok(manifest.includes('Knowledge Base'));
  });

  it('manifest hides calculators when permissions.calc === false', () => {
    const manifest = getToolManifest({ calc: false, kb: true }, false);
    assert.ok(!manifest.includes('Calculators'), 'should not mention Calculators');
    assert.ok(manifest.includes('Knowledge Base'));
  });

  it('manifest hides knowledge when permissions.kb === false', () => {
    const manifest = getToolManifest({ calc: true, kb: false }, false);
    assert.ok(!manifest.includes('Knowledge Base'));
    assert.ok(manifest.includes('Calculators'));
  });

  it('manifest returns empty string when all permissions denied', () => {
    const manifest = getToolManifest({ calc: false, kb: false }, false);
    assert.strictEqual(manifest, '');
  });

  it('public manifest has restricted descriptions (no create/configure/deploy)', () => {
    const manifest = getToolManifest(null, true);
    assert.ok(!manifest.includes('create'), 'public manifest should not mention create');
    assert.ok(!manifest.includes('deploy'), 'public manifest should not mention deploy');
    assert.ok(!manifest.includes('configure'), 'public manifest should not mention configure');
  });

  it('private manifest mentions create/deploy/configure for calculators', () => {
    const manifest = getToolManifest(null, false);
    assert.ok(manifest.includes('create') || manifest.includes('deploy'));
  });

  it('manifest stays under 500 chars (lightweight)', () => {
    const manifest = getToolManifest(null, false);
    assert.ok(manifest.length < 500, `manifest too long: ${manifest.length} chars`);
  });

  // ─── getToolsForCategories ─────────────────────────────────

  it('returns empty array for empty categories set', () => {
    const tools = getToolsForCategories(AI_TOOLS, new Set());
    assert.strictEqual(tools.length, 0);
  });

  it('returns only calculator tools for calculators category', () => {
    const tools = getToolsForCategories(AI_TOOLS, new Set(['calculators']));
    const names = tools.map(t => t.name);
    assert.ok(names.includes('list_calculators'));
    assert.ok(names.includes('execute_calculator'));
    assert.ok(!names.includes('search_knowledge'), 'should not include KB tools');
  });

  it('returns only knowledge tools for knowledge category', () => {
    const tools = getToolsForCategories(AI_TOOLS, new Set(['knowledge']));
    const names = tools.map(t => t.name);
    assert.ok(names.includes('search_knowledge'));
    assert.ok(names.includes('ask_knowledge'));
    assert.ok(!names.includes('list_calculators'), 'should not include calc tools');
  });

  it('returns all tools for both categories', () => {
    const tools = getToolsForCategories(AI_TOOLS, new Set(['calculators', 'knowledge']));
    assert.strictEqual(tools.length, AI_TOOLS.length, 'all tools should be returned');
  });

  // ─── Cross-category reference safety ──────────────────────

  it('calculator tool descriptions do not reference knowledge tool names', () => {
    const kbNames = TOOL_CATEGORIES.knowledge;
    const calcTools = AI_TOOLS.filter(t => TOOL_CATEGORIES.calculators.includes(t.name));
    for (const tool of calcTools) {
      for (const kbName of kbNames) {
        assert.ok(
          !tool.description.includes(kbName),
          `calc tool "${tool.name}" description references KB tool "${kbName}"`,
        );
      }
    }
  });

  it('knowledge tool descriptions do not reference calculator tool names', () => {
    const calcNames = TOOL_CATEGORIES.calculators;
    const kbTools = AI_TOOLS.filter(t => TOOL_CATEGORIES.knowledge.includes(t.name));
    for (const tool of kbTools) {
      for (const calcName of calcNames) {
        assert.ok(
          !tool.description.includes(calcName),
          `KB tool "${tool.name}" description references calc tool "${calcName}"`,
        );
      }
    }
  });

  // ─── TOOL_CATEGORIES completeness ─────────────────────────

  it('all AI_TOOLS are covered by a category', () => {
    const allCategoryTools = new Set(
      Object.values(TOOL_CATEGORIES).flat(),
    );
    for (const tool of AI_TOOLS) {
      assert.ok(
        allCategoryTools.has(tool.name),
        `Tool "${tool.name}" not assigned to any category`,
      );
    }
  });
});
