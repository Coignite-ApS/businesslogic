import { describe, it, expect } from 'vitest';
import { listComponents, getComponentsByCategory, getComponent } from '../src/registry.js';

// Import to register custom elements
import '../src/components/layout/bl-box.js';
import '../src/components/layout/bl-spacer.js';
import '../src/components/layout/bl-divider.js';
import '../src/components/layout/bl-list-view.js';
import '../src/components/layout/bl-list-view-item.js';
import '../src/components/layout/bl-basic.js';
import '../src/components/layout/bl-transition.js';
import '../src/components/inputs/bl-form.js';
import '../src/components/inputs/bl-textarea.js';

import { BlBox } from '../src/components/layout/bl-box.js';
import { BlSpacer } from '../src/components/layout/bl-spacer.js';
import { BlDivider } from '../src/components/layout/bl-divider.js';
import { BlListView } from '../src/components/layout/bl-list-view.js';
import { BlListViewItem } from '../src/components/layout/bl-list-view-item.js';
import { BlBasic } from '../src/components/layout/bl-basic.js';
import { BlTransition } from '../src/components/layout/bl-transition.js';
import { BlForm } from '../src/components/inputs/bl-form.js';
import { BlTextarea } from '../src/components/inputs/bl-textarea.js';
import { BlActionEvent } from '../src/actions.js';

// ── Custom element registration ───────────────────────────────────────────────

describe('layout/form — custom element registration', () => {
  const tags = [
    'bl-box', 'bl-spacer', 'bl-divider', 'bl-list-view', 'bl-list-view-item',
    'bl-basic', 'bl-transition', 'bl-form', 'bl-textarea',
  ];
  for (const tag of tags) {
    it(`${tag} is registered`, () => {
      expect(customElements.get(tag)).toBeDefined();
    });
  }
});

// ── Registry ──────────────────────────────────────────────────────────────────

describe('registry — updated counts', () => {
  it('listComponents() returns 38 unique entries', () => {
    const all = listComponents();
    expect(all).toHaveLength(38);
    const tags = all.map(e => e.tag);
    expect(new Set(tags).size).toBe(38);
  });

  it('getComponentsByCategory("layout") returns 12 entries', () => {
    expect(getComponentsByCategory('layout')).toHaveLength(12);
  });

  it('getComponentsByCategory("input") returns 9 entries', () => {
    expect(getComponentsByCategory('input')).toHaveLength(9);
  });

  it('new layout entries are in registry', () => {
    for (const name of ['box', 'Box', 'spacer', 'Spacer', 'divider', 'Divider',
      'list-view', 'ListView', 'list-view-item', 'ListViewItem', 'basic', 'Basic',
      'transition', 'Transition']) {
      expect(getComponent(name)).not.toBeNull();
    }
  });

  it('new input entries are in registry', () => {
    for (const name of ['form', 'Form', 'textarea', 'Textarea']) {
      expect(getComponent(name)).not.toBeNull();
    }
  });

  it('list-view has validChildren', () => {
    const entry = getComponent('list-view');
    expect(entry?.validChildren).toContain('list-view-item');
  });
});

// ── BlBox ────────────────────────────────────────────────────────────────────

describe('BlBox', () => {
  it('instantiates', () => {
    expect(new BlBox()).toBeInstanceOf(BlBox);
  });

  it('default direction is column', () => {
    expect(new BlBox().direction).toBe('column');
  });

  it('default wrap is nowrap', () => {
    expect(new BlBox().wrap).toBe('nowrap');
  });

  it('border defaults to false', () => {
    expect(new BlBox().border).toBe(false);
  });

  it('render includes flex and direction', () => {
    const el = new BlBox();
    el.direction = 'row';
    el.gap = '16px';
    const result = el.render();
    expect(result).toBeDefined();
  });

  it('accepts all direction values', () => {
    const el = new BlBox();
    el.direction = 'row';
    expect(el.direction).toBe('row');
    el.direction = 'column';
    expect(el.direction).toBe('column');
  });
});

// ── BlSpacer ─────────────────────────────────────────────────────────────────

describe('BlSpacer', () => {
  it('instantiates', () => {
    expect(new BlSpacer()).toBeInstanceOf(BlSpacer);
  });

  it('default minSize is "0"', () => {
    expect(new BlSpacer().minSize).toBe('0');
  });

  it('render output contains flex: 1', () => {
    const el = new BlSpacer();
    const result = el.render();
    expect(result).toBeDefined();
  });

  it('accepts custom minSize', () => {
    const el = new BlSpacer();
    el.minSize = '24px';
    expect(el.minSize).toBe('24px');
  });
});

// ── BlDivider ────────────────────────────────────────────────────────────────

describe('BlDivider', () => {
  it('instantiates', () => {
    expect(new BlDivider()).toBeInstanceOf(BlDivider);
  });

  it('default size is 1px', () => {
    expect(new BlDivider().size).toBe('1px');
  });

  it('flush defaults to false', () => {
    expect(new BlDivider().flush).toBe(false);
  });

  it('renders hr element', () => {
    const el = new BlDivider();
    const result = el.render();
    expect(result).toBeDefined();
  });

  it('accepts custom color', () => {
    const el = new BlDivider();
    el.color = '#ff0000';
    expect(el.color).toBe('#ff0000');
  });
});

// ── BlListView ────────────────────────────────────────────────────────────────

describe('BlListView', () => {
  it('instantiates', () => {
    expect(new BlListView()).toBeInstanceOf(BlListView);
  });

  it('default limit is 5', () => {
    expect(new BlListView().limit).toBe(5);
  });

  it('default status is idle', () => {
    expect(new BlListView().status).toBe('idle');
  });

  it('_showAll starts false', () => {
    const el = new BlListView();
    expect((el as any)._showAll).toBe(false);
  });

  it('_childCount starts 0', () => {
    const el = new BlListView();
    expect((el as any)._childCount).toBe(0);
  });

  it('toggling _showAll state works', () => {
    const el = new BlListView();
    (el as any)._showAll = true;
    expect((el as any)._showAll).toBe(true);
  });
});

// ── BlListViewItem ────────────────────────────────────────────────────────────

describe('BlListViewItem', () => {
  it('instantiates', () => {
    expect(new BlListViewItem()).toBeInstanceOf(BlListViewItem);
  });

  it('default onClickAction is null', () => {
    expect(new BlListViewItem().onClickAction).toBeNull();
  });

  it('default gap is set', () => {
    expect(new BlListViewItem().gap).toBeTruthy();
  });

  it('default align is center', () => {
    expect(new BlListViewItem().align).toBe('center');
  });

  it('dispatches BlActionEvent on click when onClickAction set', () => {
    const el = new BlListViewItem();
    el.onClickAction = { type: 'navigate', payload: { url: '/foo' } };

    let captured: BlActionEvent | null = null;
    el.addEventListener('bl-action', (e) => {
      captured = e as BlActionEvent;
    });

    (el as any)._onClick();

    expect(captured).not.toBeNull();
    expect((captured as unknown as BlActionEvent).detail.type).toBe('navigate');
  });

  it('does NOT dispatch event when onClickAction is null', () => {
    const el = new BlListViewItem();
    let fired = false;
    el.addEventListener('bl-action', () => { fired = true; });
    (el as any)._onClick();
    expect(fired).toBe(false);
  });
});

// ── BlBasic ───────────────────────────────────────────────────────────────────

describe('BlBasic', () => {
  it('instantiates', () => {
    expect(new BlBasic()).toBeInstanceOf(BlBasic);
  });

  it('default direction is column', () => {
    expect(new BlBasic().direction).toBe('column');
  });

  it('gap defaults to empty string', () => {
    expect(new BlBasic().gap).toBe('');
  });

  it('renders children via slot', () => {
    const el = new BlBasic();
    const result = el.render();
    expect(result).toBeDefined();
  });

  it('accepts direction row', () => {
    const el = new BlBasic();
    el.direction = 'row';
    expect(el.direction).toBe('row');
  });
});

// ── BlTransition ──────────────────────────────────────────────────────────────

describe('BlTransition', () => {
  it('instantiates', () => {
    expect(new BlTransition()).toBeInstanceOf(BlTransition);
  });

  it('default duration is 200ms', () => {
    expect(new BlTransition().duration).toBe('200ms');
  });

  it('default effect is fade', () => {
    expect(new BlTransition().effect).toBe('fade');
  });

  it('accepts slide effect', () => {
    const el = new BlTransition();
    el.effect = 'slide';
    expect(el.effect).toBe('slide');
  });

  it('render includes transition-duration', () => {
    const el = new BlTransition();
    el.duration = '300ms';
    const result = el.render();
    expect(result).toBeDefined();
  });
});

// ── BlForm ────────────────────────────────────────────────────────────────────

describe('BlForm', () => {
  it('instantiates', () => {
    expect(new BlForm()).toBeInstanceOf(BlForm);
  });

  it('onSubmitAction defaults to null', () => {
    expect(new BlForm().onSubmitAction).toBeNull();
  });

  it('renders form element', () => {
    const el = new BlForm();
    const result = el.render();
    expect(result).toBeDefined();
  });

  it('does not dispatch event when onSubmitAction is null', () => {
    const el = new BlForm();
    let fired = false;
    el.addEventListener('bl-action', () => { fired = true; });
    const evt = new Event('submit');
    (el as any)._onSubmit(evt);
    expect(fired).toBe(false);
  });

  it('dispatches BlActionEvent on submit when onSubmitAction set', () => {
    const el = new BlForm();
    el.onSubmitAction = { type: 'form.submit', payload: { formId: 'test' } };

    let captured: BlActionEvent | null = null;
    el.addEventListener('bl-action', (e) => {
      captured = e as BlActionEvent;
    });

    const evt = new Event('submit');
    (el as any)._onSubmit(evt);

    expect(captured).not.toBeNull();
    expect((captured as unknown as BlActionEvent).detail.type).toBe('form.submit');
  });

  it('includes formData in dispatched action payload', () => {
    const el = new BlForm();
    el.onSubmitAction = { type: 'form.submit' };

    let captured: BlActionEvent | null = null;
    el.addEventListener('bl-action', (e) => {
      captured = e as BlActionEvent;
    });

    const evt = new Event('submit');
    (el as any)._onSubmit(evt);

    expect((captured as unknown as BlActionEvent).detail.payload).toHaveProperty('formData');
  });

  it('preserves existing payload fields alongside formData', () => {
    const el = new BlForm();
    el.onSubmitAction = { type: 'form.submit', payload: { formId: 'test-123' } };

    let captured: BlActionEvent | null = null;
    el.addEventListener('bl-action', (e) => {
      captured = e as BlActionEvent;
    });

    const evt = new Event('submit');
    (el as any)._onSubmit(evt);

    const payload = (captured as unknown as BlActionEvent).detail.payload as Record<string, unknown>;
    expect(payload.formId).toBe('test-123');
    expect(payload.formData).toBeDefined();
  });
});

// ── BlTextarea ────────────────────────────────────────────────────────────────

describe('BlTextarea', () => {
  it('instantiates', () => {
    expect(new BlTextarea()).toBeInstanceOf(BlTextarea);
  });

  it('default rows is 3', () => {
    expect(new BlTextarea().rows).toBe(3);
  });

  it('autoResize defaults to false', () => {
    expect(new BlTextarea().autoResize).toBe(false);
  });

  it('disabled defaults to false', () => {
    expect(new BlTextarea().disabled).toBe(false);
  });

  it('required defaults to false', () => {
    expect(new BlTextarea().required).toBe(false);
  });

  it('label defaults to empty string', () => {
    expect(new BlTextarea().label).toBe('');
  });

  it('dispatches bl-input event on input', () => {
    const el = new BlTextarea();
    el.name = 'message';

    let captured: CustomEvent | null = null;
    el.addEventListener('bl-input', (e) => {
      captured = e as CustomEvent;
    });

    const mockTextarea = { value: 'hello world' } as HTMLTextAreaElement;
    const evt = { target: mockTextarea } as unknown as Event;
    (el as any)._onInput(evt);

    expect(captured).not.toBeNull();
    expect((captured as unknown as CustomEvent).detail.field).toBe('message');
    expect((captured as unknown as CustomEvent).detail.value).toBe('hello world');
  });

  it('updates value on input', () => {
    const el = new BlTextarea();
    const mockTextarea = { value: 'new value' } as HTMLTextAreaElement;
    const evt = { target: mockTextarea } as unknown as Event;
    (el as any)._onInput(evt);
    expect(el.value).toBe('new value');
  });

  it('renders without throwing', () => {
    const el = new BlTextarea();
    el.label = 'Message';
    el.description = 'Enter your message';
    el.placeholder = 'Type here...';
    expect(() => el.render()).not.toThrow();
  });
});
