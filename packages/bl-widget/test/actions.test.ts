import { describe, it, expect } from 'vitest';
import { BlActionEvent } from '../src/actions.js';
import type { ActionConfig } from '../src/actions.js';

describe('BlActionEvent', () => {
  it('has correct event name "bl-action"', () => {
    const ev = new BlActionEvent({ type: 'calculator.execute' });
    expect(ev.type).toBe('bl-action');
  });

  it('bubbles', () => {
    const ev = new BlActionEvent({ type: 'test' });
    expect(ev.bubbles).toBe(true);
  });

  it('is composed', () => {
    const ev = new BlActionEvent({ type: 'test' });
    expect(ev.composed).toBe(true);
  });

  it('detail contains the ActionConfig', () => {
    const action: ActionConfig = {
      type: 'assistant.message',
      payload: { text: 'hello' },
      handler: 'server',
    };
    const ev = new BlActionEvent(action);
    expect(ev.detail).toEqual(action);
  });
});
