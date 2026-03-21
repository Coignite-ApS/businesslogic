import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BusinessLogic, BusinessLogicError } from '../dist/index.js';

describe('BusinessLogic SDK', () => {
  it('creates client with required options', () => {
    const bl = new BusinessLogic({ apiKey: 'bl_test_123' });
    assert.ok(bl);
    assert.ok(bl.chat);
    assert.ok(bl.conversations);
    assert.ok(bl.kb);
    assert.ok(bl.embeddings);
  });

  it('creates client with custom base URL', () => {
    const bl = new BusinessLogic({
      apiKey: 'bl_test_123',
      baseUrl: 'http://localhost:3200',
      timeout: 5000,
    });
    assert.ok(bl);
  });

  it('BusinessLogicError has status and body', () => {
    const err = new BusinessLogicError(403, { error: 'Forbidden' });
    assert.strictEqual(err.status, 403);
    assert.strictEqual(err.message, 'Forbidden');
    assert.strictEqual(err.body.error, 'Forbidden');
    assert.ok(err instanceof Error);
  });

  it('BusinessLogicError handles errors array', () => {
    const err = new BusinessLogicError(400, { errors: [{ message: 'Bad input' }] });
    assert.strictEqual(err.message, 'Bad input');
  });

  it('chat.send rejects with BusinessLogicError on bad URL', async () => {
    const bl = new BusinessLogic({
      apiKey: 'bl_test_123',
      baseUrl: 'http://localhost:1',
      timeout: 1000,
    });
    await assert.rejects(
      () => bl.chat.send({ message: 'hello' }),
      (err) => err instanceof Error,
    );
  });
});
