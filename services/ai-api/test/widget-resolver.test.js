import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { hydrateTemplate, clearTemplateCache, loadBuiltinTemplates, getBuiltinTemplate } from '../src/widgets/resolver.js';
import { initWidgetCache, closeWidgetCache } from '../src/widgets/cache.js';

// Test hydration only (findTemplate requires DB)
describe('Widget template hydration', () => {
  beforeEach(() => clearTemplateCache());

  it('replaces simple placeholders', () => {
    const tree = {
      component: 'Title',
      props: { value: '{{title}}', size: 'lg' },
    };
    const data = { title: 'Insurance Calculator' };
    const result = hydrateTemplate(tree, data);
    assert.strictEqual(result.component, 'Title');
    assert.strictEqual(result.props.value, 'Insurance Calculator');
    assert.strictEqual(result.props.size, 'lg');
  });

  it('preserves non-placeholder values', () => {
    const tree = {
      component: 'Badge',
      props: { label: 'Active', color: 'success' },
    };
    const result = hydrateTemplate(tree, {});
    assert.strictEqual(result.props.label, 'Active');
  });

  it('handles nested children', () => {
    const tree = {
      component: 'Card',
      children: [
        { component: 'Title', props: { value: '{{name}}' } },
        { component: 'Text', props: { value: '{{desc}}' } },
      ],
    };
    const data = { name: 'Calc', desc: 'A calculator' };
    const result = hydrateTemplate(tree, data);
    assert.strictEqual(result.children.length, 2);
    assert.strictEqual(result.children[0].props.value, 'Calc');
  });

  it('handles __each loops', () => {
    const tree = {
      component: 'ListView',
      children: [
        {
          component: '__each',
          props: { source: 'items' },
          children: [
            {
              component: 'ListViewItem',
              children: [
                { component: 'Text', props: { value: '{{name}}' } },
              ],
            },
          ],
        },
      ],
    };
    const data = {
      items: [{ name: 'Item 1' }, { name: 'Item 2' }],
    };
    const result = hydrateTemplate(tree, data);
    assert.strictEqual(result.children.length, 2);
    assert.strictEqual(result.children[0].children[0].props.value, 'Item 1');
  });

  it('handles nested value access in placeholders', () => {
    const tree = {
      component: 'Text',
      props: { value: '{{meta.score}}' },
    };
    const data = { meta: { score: 95 } };
    const result = hydrateTemplate(tree, data);
    assert.strictEqual(result.props.value, 95);
  });

  it('returns null for null tree', () => {
    assert.strictEqual(hydrateTemplate(null, {}), null);
  });
});

describe('Built-in template fallback', () => {
  beforeEach(() => initWidgetCache(null));
  afterEach(() => closeWidgetCache());

  it('loads built-in templates from JSON files', () => {
    const templates = loadBuiltinTemplates();
    assert.ok(templates.size > 0, 'should load at least one template');
    assert.ok(templates.has('execute_calculator'), 'should have execute_calculator');
    assert.ok(templates.has('list_calculators'), 'should have list_calculators');
    assert.ok(templates.has('search_knowledge'), 'should have search_knowledge');
  });

  it('getBuiltinTemplate returns template for known tool', () => {
    loadBuiltinTemplates();
    const tpl = getBuiltinTemplate('execute_calculator');
    assert.ok(tpl, 'should return a template');
    assert.strictEqual(tpl.tool_binding, 'execute_calculator');
    assert.ok(tpl.template, 'should have template field');
    assert.ok(tpl.data_mapping, 'should have data_mapping field');
  });

  it('getBuiltinTemplate returns null for unknown tool', () => {
    loadBuiltinTemplates();
    const tpl = getBuiltinTemplate('nonexistent_tool');
    assert.strictEqual(tpl, null);
  });
});
