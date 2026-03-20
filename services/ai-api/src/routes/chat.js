import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { AiClient } from '../services/ai-client.js';
import { AI_TOOLS, executeTool } from '../services/tools.js';
import { DEFAULT_SYSTEM_PROMPT } from '../services/system-prompt.js';
import { sendSSE, setSSEHeaders } from '../utils/streaming.js';
import { sanitizeMessage } from '../utils/sanitize.js';
import { checkRateLimit } from '../utils/rate-limit.js';
import { calculateCost } from '../utils/cost.js';
import { checkAiQuota, getActiveAccount } from '../utils/auth.js';

export async function registerRoutes(app) {
  // ─── Chat (SSE) ────────────────────────────────────────────
  app.post('/v1/ai/chat', {
    preHandler: [app.verifyAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          conversation_id: { type: 'string' },
          prompt_id: { type: 'string' },
        },
        required: ['message'],
      },
    },
  }, async (req, reply) => {
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ error: 'AI Assistant not configured' });
    }

    const { message: rawMessage, conversation_id, prompt_id } = req.body;
    const message = sanitizeMessage(rawMessage, config.maxMessageLength);
    if (!message?.trim()) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    // Resolve account
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) {
      return reply.code(403).send({ error: 'No active account' });
    }

    // Rate limit (skip for admins)
    if (!req.isAdmin) {
      const rl = checkRateLimit(req.userId || accountId, config.rateLimitPerMinute);
      if (!rl.allowed) {
        return reply.code(429).header('Retry-After', String(rl.retryAfter)).send({
          error: `Rate limit exceeded. Try again in ${rl.retryAfter}s.`,
        });
      }
    }

    // Quota check (skip for admins)
    let quota = null;
    if (!req.isAdmin) {
      quota = await checkAiQuota(accountId);
      if (!quota.allowed) {
        return reply.code(429).send({ error: quota.reason });
      }
    }

    // Set SSE headers
    setSSEHeaders(reply);

    const abortController = new AbortController();
    let clientDisconnected = false;
    req.raw.on('close', () => {
      clientDisconnected = true;
      abortController.abort();
    });

    try {
      // Load or create conversation
      let conversationId = conversation_id;
      let messages = [];

      if (conversationId) {
        const conv = await queryOne(
          'SELECT messages FROM ai_conversations WHERE id = $1 AND account = $2',
          [conversationId, accountId],
        );
        if (!conv) {
          sendSSE(reply, 'error', { message: 'Conversation not found' });
          return reply.raw.end();
        }
        messages = conv.messages || [];
      } else {
        conversationId = randomUUID();
        await query(
          `INSERT INTO ai_conversations (id, account, user_created, title, messages, status, total_input_tokens, total_output_tokens, date_created, date_updated)
           VALUES ($1, $2, $3, $4, $5, 'active', 0, 0, NOW(), NOW())`,
          [conversationId, accountId, req.userId, message.slice(0, 100), JSON.stringify([])],
        );
        sendSSE(reply, 'conversation_created', { id: conversationId });
      }

      // Load system prompt
      let systemPrompt = DEFAULT_SYSTEM_PROMPT;
      if (prompt_id) {
        try {
          const prompt = await queryOne(
            "SELECT system_prompt FROM ai_prompts WHERE id = $1 AND status = 'published'",
            [prompt_id],
          );
          if (prompt?.system_prompt) systemPrompt = prompt.system_prompt;
        } catch { /* use default */ }
      }

      // Add user message
      messages.push({ role: 'user', content: message });

      // Trim to max
      if (messages.length > config.maxConversationMessages) {
        messages = messages.slice(-config.maxConversationMessages);
      }

      // Resolve model
      let model = config.defaultModel;
      let maxOutputTokens = config.maxOutputTokens;
      try {
        const modelCfg = await queryOne(
          "SELECT model, max_output_tokens FROM ai_model_config WHERE task_category = 'execute' AND enabled = true LIMIT 1",
        );
        if (modelCfg) {
          model = modelCfg.model;
          maxOutputTokens = modelCfg.max_output_tokens || maxOutputTokens;
        }
      } catch { /* use default */ }

      // Plan-based model restriction
      if (quota?.allowedModels?.length > 0 && !quota.allowedModels.includes(model)) {
        model = quota.allowedModels[0];
      }

      const client = new AiClient(config.anthropicApiKey);
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // Tool loop
      for (let round = 0; round < config.maxToolRounds; round++) {
        if (clientDisconnected) break;

        let assistantText = '';
        let toolUses = [];
        let stopReason = null;

        const stream = client.streamChat({
          model,
          systemPrompt,
          messages,
          tools: AI_TOOLS,
          maxOutputTokens,
          signal: abortController.signal,
        });

        for await (const event of stream) {
          if (clientDisconnected) break;

          switch (event.type) {
            case 'text_delta':
              assistantText += event.data.text;
              sendSSE(reply, 'text_delta', { text: event.data.text });
              break;
            case 'tool_use_start':
              sendSSE(reply, 'tool_use_start', { name: event.data.name });
              break;
            case 'tool_use_delta':
              break;
            case 'usage':
              totalInputTokens += event.data.input_tokens || 0;
              totalOutputTokens += event.data.output_tokens || 0;
              break;
            case 'message_stop':
              stopReason = event.data.stop_reason;
              for (const block of (event.data.content || [])) {
                if (block.type === 'tool_use') {
                  toolUses.push({ id: block.id, name: block.name, input: block.input });
                }
              }
              break;
            case 'error':
              sendSSE(reply, 'error', { message: event.data.message });
              break;
          }
        }

        if (clientDisconnected) break;

        // Build assistant message
        const assistantContent = [];
        if (assistantText) assistantContent.push({ type: 'text', text: assistantText });
        for (const tu of toolUses) {
          assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        }
        if (assistantContent.length > 0) {
          messages.push({ role: 'assistant', content: assistantContent });
        }

        if (toolUses.length === 0 || stopReason !== 'tool_use') break;

        // Execute tools
        const toolResults = [];
        for (const tu of toolUses) {
          sendSSE(reply, 'tool_executing', { name: tu.name, id: tu.id });

          const { result, isError } = await executeTool(tu.name, tu.input, {
            accountId,
            logger: req.log,
          });

          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: resultStr,
            is_error: isError,
          });

          sendSSE(reply, 'tool_result', { name: tu.name, id: tu.id, result, is_error: isError });
        }

        messages.push({ role: 'user', content: toolResults });
      }

      // Save conversation
      if (!clientDisconnected) {
        try {
          const current = await queryOne(
            'SELECT total_input_tokens, total_output_tokens FROM ai_conversations WHERE id = $1',
            [conversationId],
          );
          await query(
            `UPDATE ai_conversations SET messages = $1, model = $2,
             total_input_tokens = $3, total_output_tokens = $4, date_updated = NOW()
             WHERE id = $5`,
            [
              JSON.stringify(messages),
              model,
              (current?.total_input_tokens || 0) + totalInputTokens,
              (current?.total_output_tokens || 0) + totalOutputTokens,
              conversationId,
            ],
          );
        } catch (err) {
          req.log.error(`Failed to save conversation: ${err.message}`);
        }

        // Record token usage
        try {
          await query(
            `INSERT INTO ai_token_usage (id, account, conversation, model, task_category, input_tokens, output_tokens, cost_usd, date_created)
             VALUES ($1, $2, $3, $4, 'execute', $5, $6, $7, NOW())`,
            [randomUUID(), accountId, conversationId, model, totalInputTokens, totalOutputTokens, calculateCost(model, totalInputTokens, totalOutputTokens)],
          );
        } catch (err) {
          req.log.error(`Failed to record token usage: ${err.message}`);
        }

        sendSSE(reply, 'done', {
          conversation_id: conversationId,
          usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens, model },
        });
      }
    } catch (err) {
      req.log.error(`POST /v1/ai/chat: ${err.message}`);
      if (!clientDisconnected) {
        sendSSE(reply, 'error', { message: 'An unexpected error occurred' });
      }
    } finally {
      if (!clientDisconnected) {
        reply.raw.end();
      }
    }
  });
}
