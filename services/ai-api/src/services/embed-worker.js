import { parentPort, workerData } from 'node:worker_threads';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: workerData.openaiApiKey });
const model = workerData.embeddingModel;

parentPort.on('message', async (msg) => {
  const { id, type } = msg;

  try {
    if (type === 'embed') {
      const { texts } = msg;
      const response = await client.embeddings.create({
        model,
        input: texts,
      });
      const sorted = response.data.sort((a, b) => a.index - b.index);
      const embeddings = sorted.map(item => item.embedding);
      parentPort.postMessage({ id, result: embeddings });
    } else if (type === 'ping') {
      parentPort.postMessage({ id, result: { ok: true } });
    } else {
      parentPort.postMessage({ id, error: `Unknown type: ${type}` });
    }
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
