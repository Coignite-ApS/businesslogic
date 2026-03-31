import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Calculator } from '../src/calculator.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const describeResp = {
  name: 'Test Calc',
  version: '1.0',
  description: 'A test calculator',
  expected_input: {
    type: 'object',
    properties: {
      amount: { type: 'number', title: 'Amount', default: 100 },
    },
  },
  expected_output: {
    type: 'object',
    properties: {
      result: { type: 'number', title: 'Result' },
    },
  },
};

const executeResp = { result: 200 };

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(describeResp) }),
  );
});

function mockFetchSequence() {
  let callCount = 0;
  mockFetch.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(describeResp) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(executeResp) });
  });
}

describe('Calculator', () => {
  it('emits ready after init', async () => {
    mockFetchSequence();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    await new Promise<void>((resolve) => calc.on('ready', () => resolve()));
  });

  it('emits result after auto-calculate', async () => {
    mockFetchSequence();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    const result = await new Promise<unknown>((resolve) => calc.on('result', (data) => resolve(data)));
    expect(result).toEqual({ result: 200 });
  });

  it('setInput updates values', async () => {
    mockFetchSequence();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    await new Promise<void>((resolve) => calc.on('ready', () => resolve()));
    calc.setInput('amount', 500);
    expect(calc.getInputs()).toEqual({ amount: 500 });
  });

  it('setInputs merges values', async () => {
    mockFetchSequence();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    await new Promise<void>((resolve) => calc.on('ready', () => resolve()));
    calc.setInputs({ amount: 999 });
    expect(calc.getInputs().amount).toBe(999);
  });

  it('getOutputs returns results', async () => {
    mockFetchSequence();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    await new Promise<void>((resolve) => calc.on('result', () => resolve()));
    expect(calc.getOutputs()).toEqual({ result: 200 });
  });

  it('on/off manages listeners', async () => {
    mockFetchSequence();
    const cb = vi.fn();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    calc.on('loading', cb);
    await new Promise<void>((resolve) => calc.on('result', () => resolve()));
    expect(cb).toHaveBeenCalled();

    cb.mockReset();
    calc.off('loading', cb);
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(executeResp) }),
    );
    await calc.calculate();
    expect(cb).not.toHaveBeenCalled();
  });

  it('destroy clears listeners', async () => {
    mockFetchSequence();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    await new Promise<void>((resolve) => calc.on('ready', () => resolve()));
    calc.destroy();
    // After destroy, internal map is cleared
    const cb = vi.fn();
    calc.on('result', cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('defaults are set from schema', async () => {
    mockFetchSequence();
    const calc = new Calculator({ id: 'test', token: 'tok' });
    await new Promise<void>((resolve) => calc.on('ready', () => resolve()));
    expect(calc.getInputs().amount).toBe(100);
  });
});
