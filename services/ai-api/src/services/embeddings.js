import OpenAI from 'openai';

export class EmbeddingClient {
  constructor(apiKey, model = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async embedQuery(text) {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts) {
    const results = [];
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.callWithRetry(() =>
        this.client.embeddings.create({ model: this.model, input: batch }),
      );
      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) results.push(item.embedding);
    }
    return results;
  }

  async callWithRetry(fn, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err?.status === 429 && attempt < retries - 1) {
          await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Max retries exceeded');
  }
}
