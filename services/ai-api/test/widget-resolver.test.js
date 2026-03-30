import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { hydrateTemplate, clearTemplateCache } from '../src/widgets/resolver.js';

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
