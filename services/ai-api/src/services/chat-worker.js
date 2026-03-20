import { parentPort, workerData } from 'node:worker_threads';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: workerData.anthropicApiKey });

parentPort.on('message', async (msg) => {
  const { id, type } = msg;

  try {
    if (type === 'chat') {
      const {
        model = workerData.defaultModel,
        systemPrompt,
        messages,
        tools,
        maxOutputTokens = workerData.maxOutputTokens,
      } = msg;

      const params = {
        model,
        max_tokens: maxOutputTokens,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      };
      if (tools?.length > 0) params.tools = tools;

      const stream = client.messages.stream(params);

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            parentPort.postMessage({
              id,
              type: 'chunk',
              data: { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name },
            });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            parentPort.postMessage({
              id,
              type: 'chunk',
              data: { type: 'text_delta', text: event.delta.text },
            });
          } else if (event.delta.type === 'input_json_delta') {
            parentPort.postMessage({
              id,
              type: 'chunk',
              data: { type: 'tool_use_delta', partial_json: event.delta.partial_json },
            });
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      parentPort.postMessage({
        id,
        result: {
          content: finalMessage.content,
          stop_reason: finalMessage.stop_reason,
          usage: finalMessage.usage,
        },
      });
    } else if (type === 'ping') {
      parentPort.postMessage({ id, result: { ok: true } });
    } else {
      parentPort.postMessage({ id, error: `Unknown type: ${type}` });
    }
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
