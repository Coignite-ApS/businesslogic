import Anthropic from '@anthropic-ai/sdk';

const SUMMARIZE_MODEL = 'claude-haiku-4-5-20251001';
const SUMMARIZE_PROMPT = `Summarize this conversation. Preserve:
1. The user's original goal
2. Key decisions made
3. Calculator configuration details (inputs, outputs, field names)
4. Any requirements or constraints stated
5. Knowledge base operations performed

Be concise — this summary replaces the original messages for context.`;

/**
 * Summarize older messages to compress conversation context.
 * @param {Array} messages - Messages to summarize
 * @param {string} apiKey - Anthropic API key
 * @returns {{ summary: string, inputTokens: number, outputTokens: number }}
 */
export async function summarizeMessages(messages, apiKey) {
  const client = new Anthropic({ apiKey });

  const formatted = messages.map(m => {
    const role = m.role;
    const content = m.content;
    let text;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map(block => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_use') return `[tool_use: ${block.name}(${JSON.stringify(block.input)})]`;
          if (block.type === 'tool_result') return `[tool_result: ${typeof block.content === 'string' ? block.content : JSON.stringify(block.content)}]`;
          return JSON.stringify(block);
        })
        .join(' ');
    } else {
      text = JSON.stringify(content);
    }
    return `${role}: ${text}`;
  }).join('\n\n');

  const response = await client.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 1024,
    system: SUMMARIZE_PROMPT,
    messages: [{ role: 'user', content: formatted }],
  });

  const summary = response.content[0]?.text || '';
  return {
    summary,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

/**
 * Compress messages by summarizing older ones if threshold is exceeded.
 * Returns updated messages array and token counts used for summarization.
 *
 * @param {Array} messages - Current message array (after pushing new user message)
 * @param {number} maxMessages - Config max (e.g. 50)
 * @param {string} apiKey - Anthropic API key
 * @param {Function} [logger] - Optional warn logger
 * @returns {{ messages: Array, inputTokens: number, outputTokens: number }}
 */
export async function compressIfNeeded(messages, maxMessages, apiKey, logger) {
  const threshold = Math.floor(maxMessages * 0.7);
  const keepRecent = 15;

  if (messages.length <= threshold) {
    return { messages, inputTokens: 0, outputTokens: 0 };
  }

  try {
    const olderMessages = messages.slice(0, messages.length - keepRecent);
    let recentMessages = messages.slice(-keepRecent);

    const { summary, inputTokens, outputTokens } = await summarizeMessages(olderMessages, apiKey);

    if (!summary) {
      throw new Error('empty summary returned');
    }

    const timestamp = new Date().toISOString();
    const summaryMessage = {
      role: 'user',
      content: `[Conversation summary as of ${timestamp}]\n${summary}`,
    };

    // Anthropic requires messages to alternate and start with user.
    // If first recent message is assistant, prepend summary as user — valid.
    // If first recent message is user, combine summary with it.
    if (recentMessages.length > 0 && recentMessages[0].role === 'user') {
      // Merge: put summary before the first user message as separate entry is fine since
      // summary is also user role — but two consecutive user messages is invalid.
      // Instead, prepend the summary text into the first user message.
      const firstMsg = recentMessages[0];
      const firstText = typeof firstMsg.content === 'string'
        ? firstMsg.content
        : JSON.stringify(firstMsg.content);
      recentMessages = [
        { role: 'user', content: `[Conversation summary as of ${timestamp}]\n${summary}\n\n---\n\n${firstText}` },
        ...recentMessages.slice(1),
      ];
    } else {
      recentMessages = [summaryMessage, ...recentMessages];
    }

    return { messages: recentMessages, inputTokens, outputTokens };
  } catch (err) {
    if (logger) logger(`Summarization failed, falling back to truncation: ${err.message}`);
    // Fallback: simple truncation
    return { messages: messages.slice(-maxMessages), inputTokens: 0, outputTokens: 0 };
  }
}
