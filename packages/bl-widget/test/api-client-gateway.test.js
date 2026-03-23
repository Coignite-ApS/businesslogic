// Unit tests for ApiClient — dual mode (gateway vs direct)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

let server;
let baseUrl;
let lastRequest;

function startServer(handler) {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
        handler(req, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

describe('ApiClient', () => {
  afterEach(() => stopServer());

  describe('direct mode (token)', () => {
    it('describe() calls /calculator/:id/describe with X-Auth-Token', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'Test', version: '1', description: null,
          expected_input: { type: 'object', properties: { x: { type: 'number' } } },
          expected_output: { type: 'object', properties: { y: { type: 'number' } } },
        }));
      });

      const { ApiClient } = await import('../src/api-client.ts');
      const client = new ApiClient({ token: 'tok-123', calculatorId: 'calc-1', apiUrl: baseUrl });
      const result = await client.describe();

      assert.strictEqual(lastRequest.url, '/calculator/calc-1/describe');
      assert.strictEqual(lastRequest.headers['x-auth-token'], 'tok-123');
      assert.strictEqual(result.name, 'Test');
    });

    it('execute() calls /execute/calculator/:id with X-Auth-Token', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: 42 }));
      });

      const { ApiClient } = await import('../src/api-client.ts');
      const client = new ApiClient({ token: 'tok-123', calculatorId: 'calc-1', apiUrl: baseUrl });
      const result = await client.execute({ x: 10 });

      assert.strictEqual(lastRequest.method, 'POST');
      assert.strictEqual(lastRequest.url, '/execute/calculator/calc-1');
      assert.strictEqual(lastRequest.headers['x-auth-token'], 'tok-123');
      assert.deepStrictEqual(result, { result: 42 });
    });
  });

  describe('gateway mode (apiKey)', () => {
    it('display() calls /v1/widget/:id/display with X-API-Key', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          calculator_id: 'calc-1', name: 'Test', description: null,
          layout: { theme: 'default', layout: {} },
          input_schema: { type: 'object', properties: {} },
          output_schema: { type: 'object', properties: {} },
        }));
      });

      const { ApiClient } = await import('../src/api-client.ts');
      const client = new ApiClient({ apiKey: 'bl_test123', calculatorId: 'calc-1', gatewayUrl: baseUrl });
      const result = await client.display();

      assert.strictEqual(lastRequest.url, '/v1/widget/calc-1/display');
      assert.strictEqual(lastRequest.headers['x-api-key'], 'bl_test123');
      assert.strictEqual(result.name, 'Test');
    });

    it('execute() calls /v1/widget/:id/execute with X-API-Key', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: 42 }));
      });

      const { ApiClient } = await import('../src/api-client.ts');
      const client = new ApiClient({ apiKey: 'bl_test123', calculatorId: 'calc-1', gatewayUrl: baseUrl });
      const result = await client.execute({ x: 10 });

      assert.strictEqual(lastRequest.method, 'POST');
      assert.strictEqual(lastRequest.url, '/v1/widget/calc-1/execute');
      assert.strictEqual(lastRequest.headers['x-api-key'], 'bl_test123');
      assert.ok(!lastRequest.headers['x-auth-token']);
      assert.deepStrictEqual(result, { result: 42 });
    });

    it('describe() in gateway mode delegates to display()', async () => {
      await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          calculator_id: 'calc-1', name: 'GW Test', description: 'Desc',
          layout: null,
          input_schema: { type: 'object', properties: { a: { type: 'number' } } },
          output_schema: { type: 'object', properties: { b: { type: 'number' } } },
        }));
      });

      const { ApiClient } = await import('../src/api-client.ts');
      const client = new ApiClient({ apiKey: 'bl_key', calculatorId: 'calc-1', gatewayUrl: baseUrl });
      const result = await client.describe();

      assert.strictEqual(lastRequest.url, '/v1/widget/calc-1/display');
      assert.strictEqual(result.name, 'GW Test');
      assert.ok(result.expected_input.properties.a);
    });
  });
});
