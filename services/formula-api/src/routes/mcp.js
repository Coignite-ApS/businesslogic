import { createRequire } from 'node:module';
import { LRUCache } from 'lru-cache';
import { getOrRebuild, executeCalculatorCore, loadAccountLimits, refreshRedisTtl } from './calculators.js';
import { validateGatewayAuth } from '../utils/auth.js';
import { getClientIp, checkAllowlist, setCorsHeaders } from '../utils/allowlist.js';
import * as rateLimiter from '../services/rate-limiter.js';
import * as stats from '../services/stats.js';
import { routeByCalcId } from '../utils/routing.js';
import { cleanInputSchemaForTools, resolveResponseTemplate } from '../utils/integration.js';
import { listAccountMcpCalculators } from '../services/calculator-db.js';
import { getRedisClient, isRedisReady } from '../services/cache.js';
import { redisWarn } from '../utils/redis-warn.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'excel-formula-api';
const require = createRequire(import.meta.url);
const SERVER_VERSION = require('../../package.json').version;

// Account MCP calculator-list cache (in-memory LRU + Redis)
const ACCOUNT_MCP_REDIS_TTL = 300; // 5 min
const accountMcpLru = new LRUCache({ max: 500, ttl: ACCOUNT_MCP_REDIS_TTL * 1000 });

// ── Exported helpers (used by tests) ─────────────────────────────────────────

export function _getAccountMcpCacheKey(accountId) {
  return `fa:mcp:account:${accountId}`;
}

/**
 * Build MCP tools array from DB rows.
 * Filters rows where mcp.enabled is not true.
 * Attaches _calculatorId for tools/call routing.
 */
export function _buildAccountTools(rows) {
  const tools = [];
  for (const row of rows) {
    if (!row.mcp || row.mcp.enabled !== true) continue;
    const inputSchema = cleanInputSchemaForTools(
      row.input || { type: 'object', properties: {} },
    );
    tools.push({
      name: row.mcp.toolName || row.name,
      description: row.mcp.toolDescription || '',
      inputSchema,
      _calculatorId: row.id,
    });
  }
  return tools;
}

// ── Internal cache helpers ────────────────────────────────────────────────────

async function getAccountTools(accountId) {
  const cacheKey = _getAccountMcpCacheKey(accountId);

  // LRU first
  const mem = accountMcpLru.get(cacheKey);
  if (mem !== undefined) return mem;

  // Redis
  if (isRedisReady()) {
    try {
      const raw = await getRedisClient().get(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        accountMcpLru.set(cacheKey, parsed);
        return parsed;
      }
    } catch { /* fall through */ }
  }

  // DB
  const rows = await listAccountMcpCalculators(accountId);
  const tools = _buildAccountTools(rows);

  // Populate caches
  accountMcpLru.set(cacheKey, tools);
  if (isRedisReady()) {
    getRedisClient()
      .setex(cacheKey, ACCOUNT_MCP_REDIS_TTL, JSON.stringify(tools))
      .catch((e) => redisWarn('accountMcp.cache', e));
  }

  return tools;
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const SERVER_ERROR_RETRYABLE = -32000;
const SERVER_ERROR_PERMANENT = -32001;

function jsonRpcError(id, code, message, data) {
  const resp = { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  if (data !== undefined) resp.error.data = data;
  return resp;
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

// ── Route registration ────────────────────────────────────────────────────────

export async function registerRoutes(app) {
  // CORS preflight for MCP endpoint
  app.options('/mcp/calculator/:id', async (req, reply) => {
    const calc = await getOrRebuild(req.params.id).catch(() => null);
    if (!calc) return reply.code(204).send();
    const origin = req.headers['origin'] || null;
    setCorsHeaders(reply, origin, calc.allowedOrigins);
    return reply.code(204).send();
  });

  app.post('/mcp/calculator/:id', { preHandler: routeByCalcId('params') }, async (req, reply) => {
    const calcId = req.params.id;

    // Parse body — must be JSON-RPC 2.0
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return reply.send(jsonRpcError(null, PARSE_ERROR, 'Parse error'));
    }

    // Handle batch (array of requests) — not required by MCP but be safe
    if (Array.isArray(body)) {
      return reply.send(jsonRpcError(null, INVALID_REQUEST, 'Batch requests not supported'));
    }

    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== '2.0') {
      return reply.send(jsonRpcError(id, INVALID_REQUEST, 'Invalid JSON-RPC version'));
    }

    // Notifications (no id) — return 202 with no body
    if (id === undefined || id === null) {
      // notifications/initialized, etc.
      reply.code(202);
      return reply.send();
    }

    // Load calculator
    let calc;
    try {
      calc = await getOrRebuild(calcId);
    } catch {
      return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Calculator rebuild failed'));
    }
    if (!calc) {
      return reply.send(jsonRpcError(id, SERVER_ERROR_PERMANENT, 'Calculator not found or expired', { httpStatus: 410, retryable: false }));
    }

    // Guard: MCP must be enabled
    if (!calc.mcp?.enabled) {
      return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'MCP not enabled for this calculator'));
    }

    // Route methods
    switch (method) {
      case 'initialize':
        return reply.send(jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        }));

      case 'ping':
        return reply.send(jsonRpcResult(id, {}));

      case 'tools/list': {
        const tool = {
          name: calc.mcp.toolName,
          description: calc.mcp.toolDescription || '',
          inputSchema: calc.mcpInputSchema || cleanInputSchemaForTools(calc.inputSchema),
        };
        return reply.send(jsonRpcResult(id, { tools: [tool] }));
      }

      case 'tools/call': {
        const start = Date.now();
        const calcTestFlag = calc.test ?? undefined;
        const stat = (opts) => stats.record({ calculatorId: calcId, responseTimeMs: Date.now() - start, test: calcTestFlag, ...opts });

        // Allowlist
        const clientIp = getClientIp(req);
        const origin = req.headers['origin'] || null;
        if (!checkAllowlist(calc._ipBlocklist, calc.allowedOrigins, clientIp, origin)) {
          stat({ cached: false, error: true, errorMessage: 'Access denied' });
          return reply.send(jsonRpcError(id, INVALID_REQUEST, 'Access denied', { httpStatus: 403 }));
        }
        setCorsHeaders(reply, origin, calc.allowedOrigins);

        // Rate limiting
        const accountId = calc.accountId;
        if (accountId && !rateLimiter.has(accountId)) {
          const loaded = await loadAccountLimits(accountId);
          if (!loaded) {
            stat({ cached: false, error: true, errorMessage: 'Account not found' });
            return reply.send(jsonRpcError(id, INVALID_REQUEST, 'Account not found', { httpStatus: 403 }));
          }
        }
        const rl = await rateLimiter.check(accountId);
        if (!rl.allowed) {
          const msg = rl.reason === 'monthly' ? 'Monthly quota exceeded' : 'Rate limit exceeded';
          stat({ cached: false, error: true, errorMessage: msg });
          const retryAfterMs = rl.retryAfter ? rl.retryAfter * 1000 : 1000;
          return reply.send(jsonRpcError(id, SERVER_ERROR_RETRYABLE, msg, { httpStatus: 429, retryable: true, retryAfterMs }));
        }

        refreshRedisTtl(calcId);

        // Extract input from params.arguments (MCP spec)
        const inputData = params?.arguments || {};

        try {
          const { result, cached } = await executeCalculatorCore(calc, calcId, inputData);
          stat({ cached, error: false });

          // Build MCP content
          const content = [{ type: 'text', text: JSON.stringify(result) }];

          // Resolve and append response template (MCP-specific override takes precedence over global)
          const rawTemplate = calc.mcp.responseTemplate || calc.integration?.responseTemplate || '';
          if (rawTemplate && rawTemplate.trim()) {
            const resolved = resolveResponseTemplate(rawTemplate, inputData, result);
            content.push({ type: 'text', text: `\n---\nResponse template (use this to format your response):\n${resolved}` });
          }

          return reply.send(jsonRpcResult(id, { content }));
        } catch (err) {
          const errMsg = err.body?.error || (err.message?.replace(/[Hh]yper[Ff]ormula/g, 'engine'));
          stat({ cached: false, error: true, errorMessage: errMsg?.slice?.(0, 200) || 'Unknown' });

          const httpStatus = err.status || 500;
          let rpcCode = INTERNAL_ERROR;
          const data = { httpStatus };
          if (httpStatus === 400 || httpStatus === 422) {
            rpcCode = INVALID_PARAMS;
          } else if (httpStatus === 503 || httpStatus === 429) {
            rpcCode = SERVER_ERROR_RETRYABLE;
            data.retryable = true;
            if (httpStatus === 429) data.retryAfterMs = 1000;
          } else if (httpStatus === 410) {
            rpcCode = SERVER_ERROR_PERMANENT;
            data.retryable = false;
          }
          if (err.body?.details) data.details = err.body.details;
          if (err.body?.fields) data.fields = err.body.fields;
          if (err.body?.code) data.code = err.body.code;
          return reply.send(jsonRpcError(id, rpcCode, errMsg, data));
        }
      }

      default:
        return reply.send(jsonRpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`));
    }
  });

  // ── Account-level MCP endpoint ──────────────────────────────────────────────
  app.post('/mcp/account/:accountId', async (req, reply) => {
    const { accountId } = req.params;

    // HMAC auth — must come from gateway
    const auth = validateGatewayAuth(req);
    if (!auth) {
      return reply.code(401).send(jsonRpcError(null, INVALID_REQUEST, 'Unauthorized', { httpStatus: 401 }));
    }

    // Parse body — must be JSON-RPC 2.0
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.send(jsonRpcError(null, PARSE_ERROR, 'Parse error'));
    }

    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== '2.0') {
      return reply.send(jsonRpcError(id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC version'));
    }

    // Notifications (no id) — 202
    if (id === undefined || id === null) {
      reply.code(202);
      return reply.send();
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

      case 'tools/list': {
        let tools;
        try {
          tools = await getAccountTools(accountId);
        } catch (err) {
          return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Failed to load calculator list'));
        }
        // Strip internal _calculatorId before sending to client
        return reply.send(jsonRpcResult(id, {
          tools: tools.map(({ _calculatorId: _, ...t }) => t),
        }));
      }

      case 'tools/call': {
        const toolName = params?.name;
        if (!toolName) {
          return reply.send(jsonRpcError(id, INVALID_PARAMS, 'Missing params.name'));
        }

        // Load tool list (cached)
        let tools;
        try {
          tools = await getAccountTools(accountId);
        } catch {
          return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Failed to load calculator list'));
        }

        const tool = tools.find((t) => t.name === toolName);
        if (!tool) {
          return reply.send(jsonRpcError(id, METHOD_NOT_FOUND, `Tool not found: ${toolName}`, { httpStatus: 404 }));
        }

        const calcId = tool._calculatorId;
        const start = Date.now();
        const stat = (opts) => stats.record({
          calculatorId: calcId,
          account: accountId,
          responseTimeMs: Date.now() - start,
          type: 'mcp_call',
          ...opts,
        });

        // Rate limiting
        if (!rateLimiter.has(accountId)) {
          await loadAccountLimits(accountId);
        }
        const rl = await rateLimiter.check(accountId);
        if (!rl.allowed) {
          const msg = rl.reason === 'monthly' ? 'Monthly quota exceeded' : 'Rate limit exceeded';
          stat({ cached: false, error: true, errorMessage: msg });
          const retryAfterMs = rl.retryAfter ? rl.retryAfter * 1000 : 1000;
          return reply.send(jsonRpcError(id, SERVER_ERROR_RETRYABLE, msg, { httpStatus: 429, retryable: true, retryAfterMs }));
        }

        // Load and execute calculator
        let calc;
        try {
          calc = await getOrRebuild(calcId);
        } catch {
          stat({ cached: false, error: true, errorMessage: 'Calculator rebuild failed' });
          return reply.send(jsonRpcError(id, INTERNAL_ERROR, 'Calculator rebuild failed'));
        }
        if (!calc) {
          stat({ cached: false, error: true, errorMessage: 'Calculator not found' });
          return reply.send(jsonRpcError(id, SERVER_ERROR_PERMANENT, 'Calculator not found or expired', { httpStatus: 410, retryable: false }));
        }

        refreshRedisTtl(calcId);

        const inputData = params?.arguments || {};

        try {
          const { result, cached } = await executeCalculatorCore(calc, calcId, inputData);
          stat({ cached, error: false });
          rateLimiter.record(accountId);

          const content = [{ type: 'text', text: JSON.stringify(result) }];

          const rawTemplate = calc.mcp?.responseTemplate || calc.integration?.responseTemplate || '';
          if (rawTemplate && rawTemplate.trim()) {
            const resolved = resolveResponseTemplate(rawTemplate, inputData, result);
            content.push({ type: 'text', text: `\n---\nResponse template (use this to format your response):\n${resolved}` });
          }

          return reply.send(jsonRpcResult(id, { content }));
        } catch (err) {
          const errMsg = err.body?.error || (err.message?.replace(/[Hh]yper[Ff]ormula/g, 'engine'));
          stat({ cached: false, error: true, errorMessage: errMsg?.slice?.(0, 200) || 'Unknown' });

          const httpStatus = err.status || 500;
          let rpcCode = INTERNAL_ERROR;
          const data = { httpStatus };
          if (httpStatus === 400 || httpStatus === 422) {
            rpcCode = INVALID_PARAMS;
          } else if (httpStatus === 503 || httpStatus === 429) {
            rpcCode = SERVER_ERROR_RETRYABLE;
            data.retryable = true;
            if (httpStatus === 429) data.retryAfterMs = 1000;
          } else if (httpStatus === 410) {
            rpcCode = SERVER_ERROR_PERMANENT;
            data.retryable = false;
          }
          if (err.body?.details) data.details = err.body.details;
          if (err.body?.fields) data.fields = err.body.fields;
          if (err.body?.code) data.code = err.body.code;
          return reply.send(jsonRpcError(id, rpcCode, errMsg, data));
        }
      }

      default:
        return reply.send(jsonRpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`));
    }
  });
}
