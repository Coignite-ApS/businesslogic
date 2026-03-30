import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { queryOne, queryAll } from '../db.js';
import { getActiveAccount } from '../utils/auth.js';
import { EmbeddingClient } from '../services/embeddings.js';
import { hybridSearch } from '../services/search.js';
import { generateAnswer } from '../services/answer.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'bl-ai-api';
let SERVER_VERSION = '0.0.0';
try { SERVER_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version; } catch {}

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function jsonRpcError(id, code, message, data) {
  const resp = { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  if (data !== undefined) resp.error.data = data;
  return resp;
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/** Fetch calculator tools from formula-api's describe endpoint */
async function fetchCalculatorTools(accountId) {
  if (!config.formulaApiUrl) return [];
  try {
    const headers = {};
    if (config.formulaApiAdminToken) headers['X-Admin-Token'] = config.formulaApiAdminToken;
    headers['X-Account-Id'] = accountId;
    const res = await fetch(`${config.formulaApiUrl}/calculators/account/${encodeURIComponent(accountId)}/list`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    const calcs = data.data || data.calculators || data || [];
    return Array.isArray(calcs) ? calcs : [];
  } catch {
    return [];
  }
}

export async function registerRoutes(app) {
  // ─── KB MCP ─────────────────────────────────────────────
  app.post('/v1/ai/mcp/:kbId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    // Permission check
    if (req.permissions && req.permissions.ai === false) {
      return reply.send(jsonRpcError(null, INTERNAL_ERROR, 'API key does not have AI permission'));
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return reply.send(jsonRpcError(null, PARSE_ERROR, 'Parse error'));
    }
    if (Array.isArray(body)) {
      return reply.send(jsonRpcError(null, INVALID_REQUEST, 'Batch requests not supported'));
    }

    const { jsonrpc, id, method, params } = body;
    if (jsonrpc !== '2.0') {
      return reply.send(jsonRpcError(id, INVALID_REQUEST, 'Invalid JSON-RPC version'));
    }

    // Notifications (no id) — return 202
    if (id === undefined || id === null) {
      reply.code(202);
      return reply.send();
    }

    // Resolve account
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) {
      return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'No active account', { httpStatus: 403 }));
    }

    // Verify KB ownership
    const kbId = req.params.kbId;
    const kb = await queryOne(
      'SELECT id, name, description FROM knowledge_bases WHERE id = $1 AND account_id = $2',
      [kbId, accountId],
    );
    if (!kb) {
      return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Knowledge base not found', { httpStatus: 404 }));
    }

    switch (method) {
      case 'initialize':
        return reply.send(jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        }));

      case 'ping':
        return reply.send(jsonRpcResult(id, {}));

      case 'tools/list':
        return reply.send(jsonRpcResult(id, {
          tools: [
            {
              name: `kb_search_${kbId.slice(0, 8)}`,
              description: `Search "${kb.name}" knowledge base for relevant document chunks.${kb.description ? ' ' + kb.description : ''}`,
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' },
                  limit: { type: 'integer', description: 'Max results (default: 10)', default: 10 },
                },
                required: ['query'],
              },
            },
            {
              name: `kb_ask_${kbId.slice(0, 8)}`,
              description: `Ask a question and get a cited answer from "${kb.name}" knowledge base.`,
              inputSchema: {
                type: 'object',
                properties: {
                  question: { type: 'string', description: 'The question to answer' },
                  model: { type: 'string', description: 'AI model override' },
                },
                required: ['question'],
              },
            },
          ],
        }));

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments || {};

        if (!toolName) {
          return reply.send(jsonRpcError(id, INVALID_PARAMS, 'Missing tool name'));
        }

        // Handle search tool
        if (toolName.startsWith('kb_search_')) {
          if (!args.query?.trim()) {
            return reply.send(jsonRpcError(id, INVALID_PARAMS, 'query is required'));
          }
          if (!config.openaiApiKey) {
            return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Embedding service not configured'));
          }

          const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
          const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
          const { results } = await hybridSearch(embedClient, args.query.trim(), accountId, kbId, args.limit || 10, searchConfig);

          const content = [{ type: 'text', text: JSON.stringify(results) }];
          return reply.send(jsonRpcResult(id, { content }));
        }

        // Handle ask tool
        if (toolName.startsWith('kb_ask_')) {
          if (!args.question?.trim()) {
            return reply.send(jsonRpcError(id, INVALID_PARAMS, 'question is required'));
          }
          if (!config.openaiApiKey || !config.anthropicApiKey) {
            return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'AI services not configured'));
          }

          const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
          const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
          const { results: chunks } = await hybridSearch(embedClient, args.question.trim(), accountId, kbId, 10, searchConfig);

          // Check for curated answers
          let curatedContext = [];
          try {
            const curated = await queryAll(
              `SELECT question, answer FROM kb_curated_answers
               WHERE knowledge_base = $1 AND question_embedding IS NOT NULL
               ORDER BY question_embedding <=> (SELECT question_embedding FROM kb_curated_answers WHERE knowledge_base = $1 LIMIT 1)
               LIMIT 3`,
              [kbId],
            );
            curatedContext = curated;
          } catch { /* optional */ }

          const model = args.model || config.defaultModel;
          const result = await generateAnswer(config.anthropicApiKey, args.question.trim(), chunks, model, curatedContext);

          const content = [{ type: 'text', text: JSON.stringify({
            answer: result.answer,
            confidence: result.confidence,
            source_count: chunks.length,
          }) }];
          return reply.send(jsonRpcResult(id, { content }));
        }

        return reply.send(jsonRpcError(id, METHOD_NOT_FOUND, `Unknown tool: ${toolName}`));
      }

      default:
        return reply.send(jsonRpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`));
    }
  });

  // ─── Account-level unified MCP ──────────────────────────
  app.post('/v1/mcp/account/:accountId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (req.permissions && req.permissions.ai === false) {
      return reply.send(jsonRpcError(null, INTERNAL_ERROR, 'API key does not have AI permission'));
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return reply.send(jsonRpcError(null, PARSE_ERROR, 'Parse error'));
    }
    if (Array.isArray(body)) {
      return reply.send(jsonRpcError(null, INVALID_REQUEST, 'Batch requests not supported'));
    }

    const { jsonrpc, id, method, params } = body;
    if (jsonrpc !== '2.0') {
      return reply.send(jsonRpcError(id, INVALID_REQUEST, 'Invalid JSON-RPC version'));
    }

    if (id === undefined || id === null) {
      reply.code(202);
      return reply.send();
    }

    // Verify the account matches the authenticated account
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId || accountId !== req.params.accountId) {
      return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Account mismatch or not authenticated', { httpStatus: 403 }));
    }

    switch (method) {
      case 'initialize':
        return reply.send(jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: `${SERVER_NAME}-unified`, version: SERVER_VERSION },
        }));

      case 'ping':
        return reply.send(jsonRpcResult(id, {}));

      case 'tools/list': {
        const tools = [];
        const perms = req.permissions || {};

        // KB tools (if ai permission not explicitly denied)
        if (perms.ai !== false) {
          try {
            const kbs = await queryAll(
              'SELECT id, name, description FROM knowledge_bases WHERE account_id = $1 ORDER BY sort, name',
              [accountId],
            );
            for (const kb of kbs) {
              tools.push({
                name: `kb_search_${kb.id.slice(0, 8)}`,
                description: `Search "${kb.name}" knowledge base.${kb.description ? ' ' + kb.description : ''}`,
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'Search query' },
                    limit: { type: 'integer', description: 'Max results (default: 10)' },
                  },
                  required: ['query'],
                },
              });
              tools.push({
                name: `kb_ask_${kb.id.slice(0, 8)}`,
                description: `Ask "${kb.name}" knowledge base a question and get a cited answer.`,
                inputSchema: {
                  type: 'object',
                  properties: {
                    question: { type: 'string', description: 'The question to answer' },
                  },
                  required: ['question'],
                },
              });
            }
          } catch { /* KB not available */ }
        }

        // Calculator tools (if calc permission not explicitly denied)
        if (perms.calc !== false) {
          const calcs = await fetchCalculatorTools(accountId);
          for (const calc of calcs) {
            if (!calc.id || !calc.activated) continue;
            tools.push({
              name: `calc_${calc.id}`,
              description: `Execute "${calc.name || calc.id}" calculator.${calc.description ? ' ' + calc.description : ''}`,
              inputSchema: calc.inputSchema || {
                type: 'object',
                properties: { inputs: { type: 'object', description: 'Calculator input values' } },
                required: ['inputs'],
              },
            });
          }
        }

        return reply.send(jsonRpcResult(id, { tools }));
      }

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments || {};

        if (!toolName) {
          return reply.send(jsonRpcError(id, INVALID_PARAMS, 'Missing tool name'));
        }

        // KB search tool
        if (toolName.startsWith('kb_search_')) {
          if (!args.query?.trim()) {
            return reply.send(jsonRpcError(id, INVALID_PARAMS, 'query is required'));
          }
          if (!config.openaiApiKey) {
            return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Embedding service not configured'));
          }

          // Resolve full KB ID from prefix
          const prefix = toolName.replace('kb_search_', '');
          const kb = await queryOne(
            'SELECT id FROM knowledge_bases WHERE id LIKE $1 AND account_id = $2',
            [`${prefix}%`, accountId],
          );
          if (!kb) {
            return reply.send(jsonRpcError(id, INVALID_PARAMS, 'Knowledge base not found'));
          }

          const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
          const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
          const { results } = await hybridSearch(embedClient, args.query.trim(), accountId, kb.id, args.limit || 10, searchConfig);

          return reply.send(jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(results) }] }));
        }

        // KB ask tool
        if (toolName.startsWith('kb_ask_')) {
          if (!args.question?.trim()) {
            return reply.send(jsonRpcError(id, INVALID_PARAMS, 'question is required'));
          }
          if (!config.openaiApiKey || !config.anthropicApiKey) {
            return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'AI services not configured'));
          }

          const prefix = toolName.replace('kb_ask_', '');
          const kb = await queryOne(
            'SELECT id FROM knowledge_bases WHERE id LIKE $1 AND account_id = $2',
            [`${prefix}%`, accountId],
          );
          if (!kb) {
            return reply.send(jsonRpcError(id, INVALID_PARAMS, 'Knowledge base not found'));
          }

          const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
          const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
          const { results: chunks } = await hybridSearch(embedClient, args.question.trim(), accountId, kb.id, 10, searchConfig);
          const model = config.defaultModel;
          const result = await generateAnswer(config.anthropicApiKey, args.question.trim(), chunks, model, []);

          return reply.send(jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
            answer: result.answer,
            confidence: result.confidence,
            source_count: chunks.length,
          }) }] }));
        }

        // Calculator tool
        if (toolName.startsWith('calc_')) {
          const calcId = toolName.replace('calc_', '');
          if (!config.formulaApiUrl) {
            return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Formula API not configured'));
          }

          const headers = { 'Content-Type': 'application/json' };
          if (config.formulaApiAdminToken) headers['X-Admin-Token'] = config.formulaApiAdminToken;

          try {
            const res = await fetch(`${config.formulaApiUrl}/execute/calculator/${encodeURIComponent(calcId)}`, {
              method: 'POST',
              headers,
              body: JSON.stringify(args.inputs || args),
            });
            const data = await res.json();
            if (!res.ok) {
              return reply.send(jsonRpcError(id, INTERNAL_ERROR, `Execution failed: ${JSON.stringify(data)}`));
            }
            return reply.send(jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data) }] }));
          } catch (err) {
            return reply.send(jsonRpcError(id, INTERNAL_ERROR, `Calculator error: ${err.message}`));
          }
        }

        return reply.send(jsonRpcError(id, METHOD_NOT_FOUND, `Unknown tool: ${toolName}`));
      }

      default:
        return reply.send(jsonRpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`));
    }
  });
}
