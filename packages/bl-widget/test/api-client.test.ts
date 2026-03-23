import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../src/api-client.js';

const TOKEN = 'test-token';
const CALC_ID = 'vat-calc';

describe('ApiClient', () => {
  let client: ApiClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new ApiClient({ token: TOKEN, calculatorId: CALC_ID });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('describe()', () => {
    it('calls GET /calculator/:id/describe with token header', async () => {
      const mockResponse = {
        name: 'VAT Calculator',
        version: '1.0',
        description: null,
        expected_input: { type: 'object', properties: { amount: { type: 'number' } } },
        expected_output: { type: 'object', properties: { vat: { type: 'number' } } },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.describe();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.businesslogic.online/calculator/vat-calc/describe',
        { headers: { 'X-Auth-Token': TOKEN } },
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws on non-OK response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      await expect(client.describe()).rejects.toThrow('Describe failed: 401');
    });

    it('uses custom API URL', async () => {
      const customClient = new ApiClient({
        apiUrl: 'https://staging.example.com/',
        token: TOKEN,
        calculatorId: CALC_ID,
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await customClient.describe();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://staging.example.com/calculator/vat-calc/describe',
        expect.any(Object),
      );
    });
  });

  describe('execute()', () => {
    it('calls POST /execute/calculator/:id with inputs and token', async () => {
      const inputs = { amount: 1000 };
      const outputs = { vat: 250 };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(outputs),
      });

      const result = await client.execute(inputs);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.businesslogic.online/execute/calculator/vat-calc',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN },
          body: JSON.stringify(inputs),
        },
      );
      expect(result).toEqual(outputs);
    });

    it('throws with error message from response body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Input validation failed' }),
      });

      await expect(client.execute({})).rejects.toThrow('Input validation failed');
    });

    it('throws generic message when body has no error field', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('no json')),
      });

      await expect(client.execute({})).rejects.toThrow('Execute failed: 500');
    });
  });
});
