import Anthropic from '@anthropic-ai/sdk';

/**
 * Streaming AI client wrapping the Anthropic SDK.
 * Yields typed events for SSE forwarding.
 */
export class AiClient {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Stream a chat completion with tool support.
   * @param {Object} options
   * @param {string} options.model
   * @param {string} options.systemPrompt
   * @param {Array} options.messages
   * @param {Array} [options.tools]
   * @param {number} [options.maxOutputTokens=4096]
   * @param {AbortSignal} [options.signal]
   * @yields {{ type: string, data: any }}
   */
  async *streamChat({ model, systemPrompt, messages, tools, maxOutputTokens = 4096, signal }) {
    const params = {
      model,
      max_tokens: maxOutputTokens,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };

    if (tools?.length > 0) params.tools = tools;

    try {
      const stream = this.client.messages.stream(params, { signal });

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            yield { type: 'tool_use_start', data: { id: event.content_block.id, name: event.content_block.name } };
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', data: { text: event.delta.text } };
          } else if (event.delta.type === 'input_json_delta') {
            yield { type: 'tool_use_delta', data: { partial_json: event.delta.partial_json } };
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      yield { type: 'usage', data: finalMessage.usage };
      yield {
        type: 'message_stop',
        data: {
          content: finalMessage.content,
          stop_reason: finalMessage.stop_reason,
          usage: finalMessage.usage,
        },
      };
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) return;
      yield { type: 'error', data: { message: err.message } };
    }
  }
}
