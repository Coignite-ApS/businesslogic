import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { AiClient } from '../services/ai-client.js';
import { AI_TOOLS, executeTool, filterToolsByPermissions } from '../services/tools.js';
import { detectCategories, getToolManifest, getToolsForCategories } from '../services/tool-categories.js';
import { DEFAULT_SYSTEM_PROMPT } from '../services/system-prompt.js';
import { sendSSE, setSSEHeaders } from '../utils/streaming.js';
import { sanitizeMessage } from '../utils/sanitize.js';
import { checkRateLimit } from '../utils/rate-limit.js';
import { calculateCost } from '../utils/cost.js';
import { checkAiQuota, getActiveAccount } from '../utils/auth.js';
import { checkBudget, recordCost, getConversationBudgetWarning, injectBudgetWarning } from '../services/budget.js';
import { compressIfNeeded } from '../services/summarize.js';

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
          external_id: { type: 'string' },
          prompt_id: { type: 'string' },
        },
        required: ['message'],
      },
    },
  }, async (req, reply) => {
    // Check AI permission for API key requests
    if (req.permissions && req.permissions.ai === false) {
      return reply.code(403).send({ error: 'API key does not have AI permission', code: 'FORBIDDEN' });
    }

    if (!config.anthropicApiKey) {
      return reply.code(503).send({ error: 'AI Assistant not configured', code: 'SERVICE_UNAVAILABLE' });
    }

    const { message: rawMessage, conversation_id, external_id, prompt_id } = req.body;
    const message = sanitizeMessage(rawMessage, config.maxMessageLength);
    if (!message?.trim()) {
      return reply.code(400).send({ error: 'Message is required', code: 'INVALID_REQUEST' });
    }

    // Resolve account
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) {
      return reply.code(403).send({ error: 'No active account', code: 'FORBIDDEN' });
    }

    // Rate limit (skip for admins)
    if (!req.isAdmin) {
      const rl = checkRateLimit(req.userId || accountId, config.rateLimitPerMinute);
      if (!rl.allowed) {
        return reply.code(429).header('Retry-After', String(rl.retryAfter)).send({
          error: `Rate limit exceeded. Try again in ${rl.retryAfter}s.`,
          code: 'RATE_LIMITED',
        });
      }
    }

    // Quota check (skip for admins)
    let quota = null;
    if (!req.isAdmin) {
      quota = await checkAiQuota(accountId);
      if (!quota.allowed) {
        return reply.code(429).send({ error: quota.reason, code: 'QUOTA_EXCEEDED' });
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
      // Stateless mode: no conversation_id and no external_id → skip DB conversation
      const isStateless = !conversation_id && !external_id;

      let conversationId = null;
      let messages = [];

      if (conversation_id) {
        // Scope by api_key_id when public request
        const scopeClause = req.isPublicRequest && req.apiKeyId
          ? 'AND api_key_id = $3'
          : '';
        const params = [conversation_id, accountId];
        if (req.isPublicRequest && req.apiKeyId) params.push(req.apiKeyId);

        const conv = await queryOne(
          `SELECT messages FROM ai_conversations WHERE id = $1 AND account = $2 ${scopeClause}`,
          params,
        );
        if (!conv) {
          sendSSE(reply, 'error', { message: 'Conversation not found', code: 'NOT_FOUND' });
          return reply.raw.end();
        }
        conversationId = conversation_id;
        messages = conv.messages || [];
      } else if (external_id) {
        // Find or create conversation by external_id
        const scopeClause = req.isPublicRequest && req.apiKeyId
          ? 'AND api_key_id = $3'
          : '';
        const params = [external_id, accountId];
        if (req.isPublicRequest && req.apiKeyId) params.push(req.apiKeyId);

        const conv = await queryOne(
          `SELECT id, messages FROM ai_conversations WHERE external_id = $1 AND account = $2 ${scopeClause}`,
          params,
        );
        if (conv) {
          conversationId = conv.id;
          messages = conv.messages || [];
        } else {
          conversationId = randomUUID();
          await query(
            `INSERT INTO ai_conversations (id, account, user_created, title, messages, status, total_input_tokens, total_output_tokens, api_key_id, external_id, source, date_created, date_updated)
             VALUES ($1, $2, $3, $4, $5, 'active', 0, 0, $6, $7, $8, NOW(), NOW())`,
            [conversationId, accountId, req.userId, message.slice(0, 100), JSON.stringify([]),
              req.apiKeyId || null, external_id, req.isPublicRequest ? 'api' : 'cms'],
          );
          sendSSE(reply, 'conversation_created', { id: conversationId });
        }
      } else if (!isStateless) {
        // Stateful without external_id — create new conversation
        conversationId = randomUUID();
        await query(
          `INSERT INTO ai_conversations (id, account, user_created, title, messages, status, total_input_tokens, total_output_tokens, api_key_id, external_id, source, date_created, date_updated)
           VALUES ($1, $2, $3, $4, $5, 'active', 0, 0, $6, $7, $8, NOW(), NOW())`,
          [conversationId, accountId, req.userId, message.slice(0, 100), JSON.stringify([]),
            req.apiKeyId || null, null, req.isPublicRequest ? 'api' : 'cms'],
        );
        sendSSE(reply, 'conversation_created', { id: conversationId });
      }

      // Budget check before LLM call (skip for admins)
      if (!req.isAdmin) {
        const budget = await checkBudget(accountId, conversationId);
        if (!budget.allowed) {
          sendSSE(reply, 'error', { message: budget.reason, code: 'BUDGET_EXCEEDED' });
          return reply.raw.end();
        }
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

      // Summarize older messages if approaching limit (instead of dropping)
      const client = new AiClient(config.anthropicApiKey);
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      {
        const compressed = await compressIfNeeded(
          messages,
          config.maxConversationMessages,
          config.anthropicApiKey,
          msg => req.log.warn(msg),
        );
        messages = compressed.messages;
        totalInputTokens += compressed.inputTokens;
        totalOutputTokens += compressed.outputTokens;
      }

      // Hard limit safety net
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

      // Progressive tool loading: detect needed categories from user message + history
      const loadedCategories = detectCategories(message, messages.slice(0, -1));
      let tools;
      if (loadedCategories.size === 0) {
        // Level 0: no tool schemas — append manifest to system prompt instead
        tools = [];
        systemPrompt += getToolManifest(req.permissions, req.isPublicRequest);
      } else {
        // Level 1: load only needed category schemas, then apply permissions
        tools = filterToolsByPermissions(
          getToolsForCategories(AI_TOOLS, loadedCategories),
          req.permissions,
          req.isPublicRequest,
        );
      }

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
          tools,
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

        // Inject budget warning into last tool result (preserves prompt cache)
        if (conversationId) {
          const currentCostUsd = calculateCost(model, totalInputTokens, totalOutputTokens);
          const budgetWarning = await getConversationBudgetWarning(conversationId, currentCostUsd);
          injectBudgetWarning(toolResults, budgetWarning);
        }

        messages.push({ role: 'user', content: toolResults });
      }

      // Save conversation (skip in stateless mode)
      if (!clientDisconnected) {
        const costUsd = calculateCost(model, totalInputTokens, totalOutputTokens);

        if (!isStateless && conversationId) {
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
        }

        // Record token usage (always, even stateless — for billing)
        try {
          await query(
            `INSERT INTO ai_token_usage (id, account, conversation, model, task_category, input_tokens, output_tokens, cost_usd, date_created)
             VALUES ($1, $2, $3, $4, 'execute', $5, $6, $7, NOW())`,
            [randomUUID(), accountId, conversationId || null, model, totalInputTokens, totalOutputTokens, costUsd],
          );
        } catch (err) {
          req.log.error(`Failed to record token usage: ${err.message}`);
        }

        // Record cost to Redis budget counters
        if (!req.isAdmin) {
          await recordCost(accountId, conversationId, costUsd);
        }

        // Note: cannot setHeader after writeHead() — usage data is in the done event payload
        const donePayload = {
          usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens, model, cost_usd: costUsd },
        };
        if (conversationId) donePayload.conversation_id = conversationId;

        sendSSE(reply, 'done', donePayload);
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

  // ─── Chat Sync (non-streaming) ───────────────────────────
  app.post('/v1/ai/chat/sync', {
    preHandler: [app.verifyAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          conversation_id: { type: 'string' },
          external_id: { type: 'string' },
          prompt_id: { type: 'string' },
          model: { type: 'string' },
        },
        required: ['message'],
      },
    },
  }, async (req, reply) => {
    if (req.permissions && req.permissions.ai === false) {
      return reply.code(403).send({ error: 'API key does not have AI permission', code: 'FORBIDDEN' });
    }

    if (!config.anthropicApiKey) {
      return reply.code(503).send({ error: 'AI Assistant not configured', code: 'SERVICE_UNAVAILABLE' });
    }

    const { message: rawMessage, conversation_id, external_id, prompt_id } = req.body;
    const message = sanitizeMessage(rawMessage, config.maxMessageLength);
    if (!message?.trim()) {
      return reply.code(400).send({ error: 'Message is required', code: 'INVALID_REQUEST' });
    }

    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) {
      return reply.code(403).send({ error: 'No active account', code: 'FORBIDDEN' });
    }

    if (!req.isAdmin) {
      const rl = checkRateLimit(req.userId || accountId, config.rateLimitPerMinute);
      if (!rl.allowed) {
        return reply.code(429).header('Retry-After', String(rl.retryAfter)).send({
          error: `Rate limit exceeded. Try again in ${rl.retryAfter}s.`,
          code: 'RATE_LIMITED',
        });
      }
    }

    let quota = null;
    if (!req.isAdmin) {
      quota = await checkAiQuota(accountId);
      if (!quota.allowed) {
        return reply.code(429).send({ error: quota.reason, code: 'QUOTA_EXCEEDED' });
      }
    }

    try {
      // Stateless mode: no conversation_id and no external_id
      const isStateless = !conversation_id && !external_id;

      let conversationId = null;
      let messages = [];

      if (conversation_id) {
        // Scope by api_key_id when public request
        const scopeClause = req.isPublicRequest && req.apiKeyId
          ? 'AND api_key_id = $3'
          : '';
        const params = [conversation_id, accountId];
        if (req.isPublicRequest && req.apiKeyId) params.push(req.apiKeyId);

        const conv = await queryOne(
          `SELECT messages FROM ai_conversations WHERE id = $1 AND account = $2 ${scopeClause}`,
          params,
        );
        if (!conv) {
          return reply.code(404).send({ error: 'Conversation not found', code: 'NOT_FOUND' });
        }
        conversationId = conversation_id;
        messages = conv.messages || [];
      } else if (external_id) {
        // Find or create conversation by external_id
        const scopeClause = req.isPublicRequest && req.apiKeyId
          ? 'AND api_key_id = $3'
          : '';
        const params = [external_id, accountId];
        if (req.isPublicRequest && req.apiKeyId) params.push(req.apiKeyId);

        const conv = await queryOne(
          `SELECT id, messages FROM ai_conversations WHERE external_id = $1 AND account = $2 ${scopeClause}`,
          params,
        );
        if (conv) {
          conversationId = conv.id;
          messages = conv.messages || [];
        } else {
          conversationId = randomUUID();
          await query(
            `INSERT INTO ai_conversations (id, account, user_created, title, messages, status, total_input_tokens, total_output_tokens, api_key_id, external_id, source, date_created, date_updated)
             VALUES ($1, $2, $3, $4, $5, 'active', 0, 0, $6, $7, $8, NOW(), NOW())`,
            [conversationId, accountId, req.userId, message.slice(0, 100), JSON.stringify([]),
              req.apiKeyId || null, external_id, req.isPublicRequest ? 'api' : 'cms'],
          );
        }
      } else if (!isStateless) {
        conversationId = randomUUID();
        await query(
          `INSERT INTO ai_conversations (id, account, user_created, title, messages, status, total_input_tokens, total_output_tokens, api_key_id, external_id, source, date_created, date_updated)
           VALUES ($1, $2, $3, $4, $5, 'active', 0, 0, $6, $7, $8, NOW(), NOW())`,
          [conversationId, accountId, req.userId, message.slice(0, 100), JSON.stringify([]),
            req.apiKeyId || null, null, req.isPublicRequest ? 'api' : 'cms'],
        );
      }

      // Budget check before LLM call (skip for admins)
      if (!req.isAdmin) {
        const budget = await checkBudget(accountId, conversationId);
        if (!budget.allowed) {
          return reply.code(429).send({ error: budget.reason, code: 'BUDGET_EXCEEDED' });
        }
      }

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

      messages.push({ role: 'user', content: message });

      // Summarize older messages if approaching limit (instead of dropping)
      const client = new AiClient(config.anthropicApiKey);
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      {
        const compressed = await compressIfNeeded(
          messages,
          config.maxConversationMessages,
          config.anthropicApiKey,
          msg => req.log.warn(msg),
        );
        messages = compressed.messages;
        totalInputTokens += compressed.inputTokens;
        totalOutputTokens += compressed.outputTokens;
      }

      // Hard limit safety net
      if (messages.length > config.maxConversationMessages) {
        messages = messages.slice(-config.maxConversationMessages);
      }

      let model = req.body.model || config.defaultModel;
      let maxOutputTokens = config.maxOutputTokens;
      try {
        const modelCfg = await queryOne(
          "SELECT model, max_output_tokens FROM ai_model_config WHERE task_category = 'execute' AND enabled = true LIMIT 1",
        );
        if (modelCfg && !req.body.model) {
          model = modelCfg.model;
          maxOutputTokens = modelCfg.max_output_tokens || maxOutputTokens;
        }
      } catch { /* use default */ }

      if (quota?.allowedModels?.length > 0 && !quota.allowedModels.includes(model)) {
        model = quota.allowedModels[0];
      }
      // Progressive tool loading: detect needed categories from user message + history
      const loadedCategories = detectCategories(message, messages.slice(0, -1));
      let tools;
      if (loadedCategories.size === 0) {
        tools = [];
        systemPrompt += getToolManifest(req.permissions, req.isPublicRequest);
      } else {
        tools = filterToolsByPermissions(
          getToolsForCategories(AI_TOOLS, loadedCategories),
          req.permissions,
          req.isPublicRequest,
        );
      }
      const toolCalls = [];
      let responseText = '';

      for (let round = 0; round < config.maxToolRounds; round++) {
        let assistantText = '';
        let toolUses = [];
        let stopReason = null;

        const stream = client.streamChat({
          model,
          systemPrompt,
          messages,
          tools,
          maxOutputTokens,
        });

        for await (const event of stream) {
          switch (event.type) {
            case 'text_delta':
              assistantText += event.data.text;
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
          }
        }

        const assistantContent = [];
        if (assistantText) assistantContent.push({ type: 'text', text: assistantText });
        for (const tu of toolUses) {
          assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        }
        if (assistantContent.length > 0) {
          messages.push({ role: 'assistant', content: assistantContent });
        }

        responseText = assistantText;

        if (toolUses.length === 0 || stopReason !== 'tool_use') break;

        const toolResults = [];
        for (const tu of toolUses) {
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
          toolCalls.push({ name: tu.name, input: tu.input, result, is_error: isError });
        }

        // Inject budget warning into last tool result (preserves prompt cache)
        if (conversationId) {
          const currentCostUsd = calculateCost(model, totalInputTokens, totalOutputTokens);
          const budgetWarning = await getConversationBudgetWarning(conversationId, currentCostUsd);
          injectBudgetWarning(toolResults, budgetWarning);
        }

        messages.push({ role: 'user', content: toolResults });
      }

      const costUsd = calculateCost(model, totalInputTokens, totalOutputTokens);

      // Save conversation (skip in stateless mode)
      if (!isStateless && conversationId) {
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
      }

      // Record token usage (always, even stateless — for billing)
      try {
        await query(
          `INSERT INTO ai_token_usage (id, account, conversation, model, task_category, input_tokens, output_tokens, cost_usd, date_created)
           VALUES ($1, $2, $3, $4, 'execute', $5, $6, $7, NOW())`,
          [randomUUID(), accountId, conversationId || null, model, totalInputTokens, totalOutputTokens, costUsd],
        );
      } catch (err) {
        req.log.error(`Failed to record token usage: ${err.message}`);
      }

      // Record cost to Redis budget counters
      if (!req.isAdmin) {
        await recordCost(accountId, conversationId, costUsd);
      }

      reply.header('X-AI-Cost', String(costUsd));
      reply.header('X-AI-Tokens-Input', String(totalInputTokens));
      reply.header('X-AI-Tokens-Output', String(totalOutputTokens));

      const responseData = {
        response: responseText,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens, model, cost_usd: costUsd },
      };
      if (conversationId) responseData.conversation_id = conversationId;

      return { data: responseData };
    } catch (err) {
      req.log.error(`POST /v1/ai/chat/sync: ${err.message}`);
      return reply.code(500).send({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' });
    }
  });
}
