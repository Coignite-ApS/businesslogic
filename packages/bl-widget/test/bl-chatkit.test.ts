import { describe, it, expect } from 'vitest';
import '../src/bl-chatkit.js';
import type { ChatKitNode } from '../src/types.js';

describe('bl-chatkit custom element', () => {
  it('is registered as a custom element', () => {
    const el = document.createElement('bl-chatkit');
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe('bl-chatkit');
  });

  it('has null tree by default', () => {
    const el = document.createElement('bl-chatkit') as any;
    expect(el.tree).toBeNull();
  });

  it('accepts a tree property', () => {
    const el = document.createElement('bl-chatkit') as any;
    const tree: ChatKitNode = { component: 'Title', props: { value: 'Test' } };
    el.tree = tree;
    expect(el.tree).toBe(tree);
  });

  it('renders tree into shadow DOM after firstUpdated', async () => {
    const el = document.createElement('bl-chatkit') as any;
    const tree: ChatKitNode = { component: 'Title', props: { value: 'Hello' } };
    el.tree = tree;
    document.body.appendChild(el);

    // Wait for Lit update cycle
    await el.updateComplete;

    const container = el.shadowRoot?.querySelector('.chatkit-root');
    expect(container).not.toBeNull();
    expect(container!.children.length).toBeGreaterThan(0);
    expect(container!.children[0].tagName.toLowerCase()).toBe('bl-title');

    document.body.removeChild(el);
  });

  it('clears and re-renders when tree changes', async () => {
    const el = document.createElement('bl-chatkit') as any;
    document.body.appendChild(el);

    el.tree = { component: 'Title', props: { value: 'First' } };
    await el.updateComplete;

    const container = el.shadowRoot?.querySelector('.chatkit-root');
    expect(container!.children[0].tagName.toLowerCase()).toBe('bl-title');

    el.tree = { component: 'Metric', props: { label: 'Revenue', value: 100 } };
    await el.updateComplete;

    expect(container!.children[0].tagName.toLowerCase()).toBe('bl-metric');

    document.body.removeChild(el);
  });

  it('renders empty container when tree is null', async () => {
    const el = document.createElement('bl-chatkit') as any;
    el.tree = null;
    document.body.appendChild(el);
    await el.updateComplete;

    const container = el.shadowRoot?.querySelector('.chatkit-root');
    expect(container).not.toBeNull();
    expect(container!.children).toHaveLength(0);

    document.body.removeChild(el);
  });
});
