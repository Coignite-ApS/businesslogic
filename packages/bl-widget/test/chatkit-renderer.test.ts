import { describe, it, expect, beforeAll } from 'vitest';
import { renderChatKitTree } from '../src/chatkit-renderer.js';
import type { ChatKitNode } from '../src/types.js';

// chatkit-renderer imports all components — custom elements get registered as side-effect

describe('renderChatKitTree', () => {
  it('returns null for null input', () => {
    expect(renderChatKitTree(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(renderChatKitTree(undefined)).toBeNull();
  });

  it('returns null for node with no component', () => {
    expect(renderChatKitTree({} as ChatKitNode)).toBeNull();
  });

  it('returns error div for unknown component', () => {
    const el = renderChatKitTree({ component: 'UnknownWidget' });
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('div');
    expect(el!.textContent).toContain('Unknown');
    expect(el!.textContent).toContain('UnknownWidget');
  });

  it('creates element with correct tag for ChatKit name', () => {
    const el = renderChatKitTree({ component: 'Title', props: { value: 'Hello' } });
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('bl-title');
  });

  it('creates element with correct tag for LayoutNode name', () => {
    const el = renderChatKitTree({ component: 'title', props: { value: 'Hello' } });
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('bl-title');
  });

  it('sets props on element', () => {
    const el = renderChatKitTree({ component: 'Metric', props: { label: 'Revenue', value: 42 } }) as any;
    expect(el).not.toBeNull();
    expect(el.label).toBe('Revenue');
    expect(el.value).toBe(42);
  });

  it('appends children as DOM nodes', () => {
    const node: ChatKitNode = {
      component: 'Card',
      children: [
        { component: 'Title', props: { value: 'Hello' } },
        { component: 'Text', props: { value: 'World' } },
      ],
    };
    const el = renderChatKitTree(node);
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('bl-card');
    expect(el!.children).toHaveLength(2);
    expect(el!.children[0].tagName.toLowerCase()).toBe('bl-title');
    expect(el!.children[1].tagName.toLowerCase()).toBe('bl-text');
  });

  it('renders nested tree: Card > Col > [Title, Text]', () => {
    const tree: ChatKitNode = {
      component: 'Card',
      children: [
        {
          component: 'Col',
          children: [
            { component: 'Title', props: { value: 'Nested Title' } },
            { component: 'Text', props: { value: 'Nested Text' } },
          ],
        },
      ],
    };
    const el = renderChatKitTree(tree);
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('bl-card');
    const col = el!.children[0];
    expect(col.tagName.toLowerCase()).toBe('bl-col');
    expect(col.children[0].tagName.toLowerCase()).toBe('bl-title');
    expect(col.children[1].tagName.toLowerCase()).toBe('bl-text');
  });

  it('renders Chart component via ChatKit name', () => {
    const el = renderChatKitTree({ component: 'Chart', props: { height: '300px' } }) as any;
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('bl-chart');
    expect(el.height).toBe('300px');
  });

  it('renders Chart component via LayoutNode name', () => {
    const el = renderChatKitTree({ component: 'chart' });
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('bl-chart');
  });

  it('handles node with empty children array', () => {
    const el = renderChatKitTree({ component: 'Row', children: [] });
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe('bl-row');
    expect(el!.children).toHaveLength(0);
  });
});
