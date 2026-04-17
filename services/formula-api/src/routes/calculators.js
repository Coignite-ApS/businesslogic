import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import Ajv from 'ajv';
import { pool } from '../services/engine-pool.js';
import { config, resolveLocale } from '../config.js';
import { buildInputMappings, buildOutputMappings } from '../utils/mapping.js';
import { applyTransform, applyOutputTransform } from '../utils/transforms.js';
import { errorTypeMap } from '../blocked.js';
import { getRedisClient, isRedisReady } from '../services/cache.js';
import { safeTokenCompare, checkAdminToken, isGatewayRequest, validateGatewayAuth } from '../utils/auth.js';
import { redisWarn } from '../utils/redis-warn.js';
import * as stats from '../services/stats.js';
import * as rateLimiter from '../services/rate-limiter.js';
import { buildStaticProfile, mergeWithMeasured } from '../utils/profile.js';
import { routeByCalcId } from '../utils/routing.js';
import { loadAccountLimits } from '../services/account-limits.js';
import { loadRecipeFromDb, loadMcpConfigFromDb } from '../services/calculator-db.js';
import { getPool } from '../db.js';


/** @type {import('pino').Logger | null} */
let log = null;

function cleanSchemaForDescribe(schema) {
  if (!schema) return schema;
  const clean = JSON.parse(JSON.stringify(schema));
  const props = clean.properties || {};
  for (const prop of Object.values(props)) {
    delete prop.mapping;
    delete prop.transform;
    delete prop.selection_mapping_id;
    delete prop.selection_mapping_title;
    if (prop.items?.properties) {
      for (const item of Object.values(prop.items.properties)) {
        delete item.mapping_item;
        delete item.transform;
      }
    }
  }
  return clean;
}

function sanitizeDetail(msg) {
  if (!msg) return 'Unknown error';
  return msg.replace(/[Hh]yper[Ff]ormula/g, 'engine');
}

const REDIS_PREFIX = 'calc:';
const RESULT_PREFIX = 'calcr:';

// Server-side calculator store
const store = new LRUCache({
  max: config.maxCalculators,
  ttl: config.calculatorTtl * 1000,
  updateAgeOnGet: true,
  noDisposeOnSet: true,
  dispose: (val, key) => {
    pool.destroyCalculator(key, val.workerId).catch((e) => redisWarn('calculators.dispose', e));
  },
});

// Result cache — keyed by "{calcId}:{generation}:{inputHash}"
const resultCache = new LRUCache({
  max: config.maxCalculators * 100,
  ttl: config.calculatorResultTtl * 1000,
});

// Concurrent rebuild dedup
const rebuilding = new Map();

// --- Redis helpers (all silent on failure) ---

function saveToRedis(id, recipe) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  redis.setex(REDIS_PREFIX + id, config.calculatorRedisTtl, JSON.stringify(recipe)).catch((e) => redisWarn('calculators.saveToRedis', e));
}

function deleteFromRedis(id) {
  if (!isRedisReady()) return Promise.resolve(0);
  const redis = getRedisClient();
  return redis.del(REDIS_PREFIX + id).catch((e) => { redisWarn('calculators.deleteFromRedis', e); return 0; });
}

function refreshRedisTtl(id) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  redis.expire(REDIS_PREFIX + id, config.calculatorRedisTtl).catch((e) => redisWarn('calculators.refreshTtl', e));
}

async function loadFromRedis(id) {
  if (!isRedisReady()) return null;
  try {
    const redis = getRedisClient();
    const raw = await redis.get(REDIS_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// --- Result cache helpers ---

function resultKey(calcId, generation, values) {
  const hash = createHash('sha256').update(JSON.stringify(values)).digest('base64url');
  return `${calcId}:${generation}:${hash}`;
}

function getCachedResult(calcId, generation, values) {
  const k = resultKey(calcId, generation, values);
  const mem = resultCache.get(k);
  if (mem !== undefined) return mem;
  return undefined;
}

function setCachedResult(calcId, generation, values, result) {
  const k = resultKey(calcId, generation, values);
  resultCache.set(k, result);

  // Fire-and-forget Redis
  if (isRedisReady()) {
    const redis = getRedisClient();
    redis.setex(RESULT_PREFIX + k, config.calculatorResultTtl, JSON.stringify(result)).catch((e) => redisWarn('calculators.cacheResult', e));
  }
}

async function getCachedResultWithRedis(calcId, generation, values) {
  const k = resultKey(calcId, generation, values);

  const mem = resultCache.get(k);
  if (mem !== undefined) return mem;

  if (!isRedisReady()) return undefined;
  try {
    const redis = getRedisClient();
    const raw = await redis.get(RESULT_PREFIX + k);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      resultCache.set(k, parsed); // backfill LRU
      return parsed;
    }
  } catch { /* ignore */ }
  return undefined;
}

// --- Database helper (replaces Admin API reads) ---

async function loadFromDb(id) {
  if (!getPool()) return null;
  try {
    return await loadRecipeFromDb(id);
  } catch (err) {
    // Log but don't throw — cache miss is handled upstream
    (log || console).error({ err }, '[calculators] loadFromDb failed');
    return null;
  }
}

async function fetchMcpConfig(id) {
  if (!getPool()) return null;
  try {
    return await loadMcpConfigFromDb(id);
  } catch (err) {
    (log || console).error({ err }, '[calculators] fetchMcpConfig failed');
    return null;
  }
}

// Enrich a live calculator entry + Redis recipe with admin MCP config (fire-and-forget safe)
async function enrichMcpConfig(id, entry, recipe) {
  const adminMcp = await fetchMcpConfig(id);
  if (!adminMcp) return;
  entry.mcp = {
    enabled: adminMcp.enabled ?? entry.mcp?.enabled ?? false,
    toolName: adminMcp.toolName ?? entry.mcp?.toolName ?? null,
    toolDescription: adminMcp.toolDescription ?? entry.mcp?.toolDescription ?? null,
    responseTemplate: adminMcp.responseTemplate ?? entry.mcp?.responseTemplate ?? null,
  };
  if (adminMcp.inputSchema) entry.mcpInputSchema = adminMcp.inputSchema;
  if (recipe) {
    recipe.mcp = entry.mcp;
    if (entry.mcpInputSchema) recipe.mcpInputSchema = entry.mcpInputSchema;
    saveToRedis(id, recipe);
  }
}

// --- Build + rebuild ---

function buildCalculator(sheets, formulas, inputSchema, outputSchema, locale) {
  const defaultSheet = Object.keys(sheets)[0];

  const inputMappings = buildInputMappings(inputSchema, defaultSheet);
  const { scalars: outputScalars, ranges: outputRanges } = buildOutputMappings(outputSchema, defaultSheet);
  const inputKeys = inputMappings.map((m) => m.key);

  const cleanForAjv = (schema) => {
    const clean = JSON.parse(JSON.stringify(schema));
    delete clean.order;
    const props = clean.properties || {};
    for (const prop of Object.values(props)) {
      delete prop.mapping;
      delete prop.transform;
      delete prop.oneOf;
      delete prop.order;
      delete prop.selection_mapping_id;
      delete prop.selection_mapping_title;
      if (typeof prop.required === 'boolean') delete prop.required;
      if (prop.items?.properties) {
        for (const itemProp of Object.values(prop.items.properties)) {
          delete itemProp.mapping_item;
          delete itemProp.transform;
          delete itemProp.order;
        }
      }
    }
    return clean;
  };

  const localAjv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: true });
  const inputValidator = localAjv.compile(cleanForAjv(inputSchema));
  const outputValidator = localAjv.compile(cleanForAjv(outputSchema));

  const workerInputMappings = inputMappings.map(({ sheet, row, col, def }) => ({ sheet, row, col, def }));
  const workerOutputScalars = outputScalars.map(({ key, sheet, row, col }) => ({ key, sheet, row, col }));
  const workerOutputRanges = outputRanges.map(({ key, sheet, startRow, startCol, endRow, endCol, columns }) => ({
    key, sheet, startRow, startCol, endRow, endCol, columns,
  }));

  return {
    inputValidator,
    outputValidator,
    inputKeys,
    inputMappings: workerInputMappings,
    outputScalars: workerOutputScalars,
    outputRanges: workerOutputRanges,
  };
}

async function rebuildFromRecipe(id, recipe) {
  const { sheets, formulas, inputSchema, outputSchema, locale, name, version, description, test, token, mcp, integration, expressions } = recipe;
  const built = buildCalculator(sheets, formulas, inputSchema, outputSchema, locale);
  const loc = resolveLocale(locale);

  const { workerIndex: workerId, profile: measuredProfile } = await pool.createCalculator(
    id, sheets, formulas, loc,
    built.inputMappings, built.outputScalars, built.outputRanges, expressions,
  );

  const staticProfile = buildStaticProfile(sheets, formulas, expressions);
  const profile = mergeWithMeasured(staticProfile, measuredProfile);

  const expiresAt = new Date(Date.now() + config.calculatorTtl * 1000).toISOString();

  const entry = {
    workerId,
    inputSchema,
    outputSchema,
    inputValidator: built.inputValidator,
    outputValidator: built.outputValidator,
    inputKeys: built.inputKeys,
    sheets,
    formulas,
    expressions: expressions || null,
    profile,
    locale,
    generation: recipe.generation || 0,
    expiresAt,
    name: name ?? null,
    version: version ?? null,
    description: description ?? null,
    test: test ?? null,
    token: token ?? null,
    accountId: recipe.accountId ?? null,
    mcp: mcp ?? null,
    mcpInputSchema: recipe.mcpInputSchema ?? null,
    integration: integration ?? null,
  };

  await enrichMcpConfig(id, entry, recipe);

  store.set(id, entry);

  if (entry.accountId) await loadAccountLimits(entry.accountId, true);

  return entry;
}

async function getOrRebuild(id) {
  const calc = store.get(id);
  if (calc) return calc;

  if (rebuilding.has(id)) return rebuilding.get(id);

  const p = (async () => {
    let recipe = await loadFromRedis(id);
    if (!recipe) {
      recipe = await loadFromDb(id);
      if (recipe) saveToRedis(id, recipe);
    }
    if (!recipe) return null;
    return rebuildFromRecipe(id, recipe);
  })().finally(() => rebuilding.delete(id));

  rebuilding.set(id, p);
  return p;
}

async function getMetadata(id) {
  const calc = store.get(id);
  if (calc) {
    const resp = {
      calculatorId: id,
      ttl: config.calculatorTtl,
      expiresAt: calc.expiresAt,
      name: calc.name ?? null,
      version: calc.version ?? null,
      hasToken: !!calc.token,
      accountId: calc.accountId ?? null,

      input: calc.inputSchema,
      output: calc.outputSchema,
    };
    if (calc.locale != null) resp.locale = calc.locale;
    if (calc.description != null) resp.description = calc.description;
    if (calc.test != null) resp.test = calc.test;
    if (calc.mcp) resp.mcp = calc.mcp;
    if (calc.integration) resp.integration = calc.integration;
    if (calc.profile) resp.profile = calc.profile;
    return resp;
  }

  let recipe = await loadFromRedis(id);
  if (!recipe) {
    recipe = await loadFromDb(id);
    if (recipe) saveToRedis(id, recipe); // backfill Redis
  }
  if (!recipe) return null;

  const { inputSchema, outputSchema, name, version, description, test, locale, token, accountId } = recipe;

  const resp = {
    calculatorId: id,
    ttl: config.calculatorRedisTtl,
    name: name ?? null,
    version: version ?? null,
    hasToken: !!token,
    accountId: accountId ?? null,

    input: inputSchema,
    output: outputSchema,
  };
  if (locale != null) resp.locale = locale;
  if (description != null) resp.description = description;
  if (test != null) resp.test = test;
  if (recipe.mcp) resp.mcp = recipe.mcp;
  if (recipe.integration) resp.integration = recipe.integration;
  if (recipe.profile) resp.profile = recipe.profile;
  return resp;
}

// Check if a value is a serialized engine error (from serialize() in engine-worker)
const isErrorValue = (v) => v !== null && typeof v === 'object' && 'type' in v && 'message' in v;

// Sanitize error object for external consumption — remap engine error types, strip engine name
const sanitizeError = (e) => ({
  type: errorTypeMap[e.type] || e.type,
  message: sanitizeDetail(e.message || ''),
  ...(e.value !== undefined && { value: e.value }),
  ...(e.unresolvedFunctions && { unresolvedFunctions: e.unresolvedFunctions }),
});

// Validate calculator output: detect engine errors in result fields.
// Returns array of { field, error } for each field that contains an error.
function validateOutput(result, outputSchema) {
  const props = outputSchema?.properties;
  if (!props) return [];
  const errors = [];

  for (const [key, prop] of Object.entries(props)) {
    const val = result[key];
    if (val == null) continue;

    if (prop.type === 'array' && Array.isArray(val) && prop.items?.properties) {
      const itemProps = prop.items.properties;
      for (let i = 0; i < val.length; i++) {
        const row = val[i];
        if (!row || typeof row !== 'object') continue;
        for (const [field] of Object.entries(itemProps)) {
          if (isErrorValue(row[field])) {
            errors.push({ field: `${key}[${i}].${field}`, error: sanitizeError(row[field]) });
          }
        }
      }
    } else if (isErrorValue(val)) {
      errors.push({ field: key, error: sanitizeError(val) });
    }
  }

  return errors;
}

function applyOutputTransforms(result, outputSchema) {
  const props = outputSchema?.properties;
  if (!props) return;
  for (const [key, prop] of Object.entries(props)) {
    if (result[key] == null) continue;
    if (prop.transform && prop.type !== 'array') {
      result[key] = applyOutputTransform(prop.transform, result[key]);
    } else if (prop.type === 'array' && Array.isArray(result[key]) && prop.items?.properties) {
      const itemProps = prop.items.properties;
      for (const row of result[key]) {
        if (!row || typeof row !== 'object') continue;
        for (const [field, itemProp] of Object.entries(itemProps)) {
          if (itemProp.transform && row[field] != null) {
            row[field] = applyOutputTransform(itemProp.transform, row[field]);
          }
        }
      }
    }
  }
}

export function getCalculatorStats() {
  let totalDataBytes = 0;
  for (const [, calc] of store.entries()) {
    totalDataBytes += JSON.stringify(calc.sheets).length;
    totalDataBytes += JSON.stringify(calc.formulas).length;
    if (calc.expressions) totalDataBytes += JSON.stringify(calc.expressions).length;
  }
  return {
    size: store.size,
    max: config.maxCalculators,
    resultCacheSize: resultCache.size,
    dataBytes: totalDataBytes,
  };
}

// --- Exported helpers for MCP route ---

export { getOrRebuild, loadAccountLimits, refreshRedisTtl, getCachedResultWithRedis, setCachedResult, store };

/**
 * Core calculator execution logic — shared between /execute/calculator/:id and MCP tools/call.
 * Returns { result, cached } on success or throws a typed error with { status, error, details? }.
 */
export async function executeCalculatorCore(calc, calcId, inputData) {
  const props = calc.inputSchema.properties || {};

  // Validate input
  if (!calc.inputValidator(inputData)) {
    const err = new Error('Input validation failed');
    err.status = 400;
    err.body = { error: 'Input validation failed', details: calc.inputValidator.errors };
    throw err;
  }

  // Apply input transforms
  for (const [key, prop] of Object.entries(props)) {
    if (prop.transform && inputData[key] != null) {
      try {
        inputData[key] = applyTransform(prop.transform, inputData[key]);
      } catch (e) {
        const err = new Error(e.message);
        err.status = 400;
        err.body = { error: 'Transform failed', detail: e.message };
        throw err;
      }
    }
  }

  // Build positional values
  const values = calc.inputKeys.map((key) => inputData[key] ?? null);
  const gen = calc.generation || 0;

  // Check result cache
  const cached = await getCachedResultWithRedis(calcId, gen, values);
  if (cached !== undefined) {
    rateLimiter.record(calc.accountId);
    return { result: cached, cached: true };
  }

  try {
    const result = await pool.calculate(calcId, calc.workerId, values);
    applyOutputTransforms(result, calc.outputSchema);

    // Validate output — detect engine errors in result fields
    const outputErrors = validateOutput(result, calc.outputSchema);
    if (outputErrors.length) {
      const err = new Error('Calculation produced errors');
      err.status = 422;
      err.body = { error: 'Calculation produced errors', code: 'OUTPUT_ERROR', fields: outputErrors };
      throw err;
    }

    setCachedResult(calcId, gen, values, result);
    rateLimiter.record(calc.accountId);
    return { result, cached: false };
  } catch (calcErr) {
    if (calcErr.status) throw calcErr; // re-throw typed errors (e.g. OUTPUT_ERROR)
    if (calcErr.message === 'Calculator not found') {
      store.delete(calcId);
      try {
        const rebuilt = await getOrRebuild(calcId);
        if (rebuilt) {
          const retryValues = calc.inputKeys.map((key) => inputData[key] ?? null);
          const result = await pool.calculate(calcId, rebuilt.workerId, retryValues);
          applyOutputTransforms(result, rebuilt.outputSchema);

          const retryErrors = validateOutput(result, rebuilt.outputSchema);
          if (retryErrors.length) {
            const err = new Error('Calculation produced errors');
            err.status = 422;
            err.body = { error: 'Calculation produced errors', code: 'OUTPUT_ERROR', fields: retryErrors };
            throw err;
          }

          setCachedResult(calcId, rebuilt.generation || 0, retryValues, result);
          rateLimiter.record(calc.accountId);
          return { result, cached: false };
        }
      } catch (inner) { if (inner.status) throw inner; /* fall through */ }
      const err = new Error('Calculator expired (worker restarted)');
      err.status = 410;
      err.body = { error: 'Calculator expired (worker restarted)' };
      throw err;
    }
    const err = new Error(calcErr.message);
    err.status = 500;
    err.body = { error: 'Calculation failed', detail: sanitizeDetail(calcErr.message) };
    throw err;
  }
}

export async function registerRoutes(app) {
  log = app.log;
  const routeById = routeByCalcId('params');
  const routeByBody = routeByCalcId('body');

  // Calculator health check (non-test only)
  app.get('/calculator/:id/health', { preHandler: routeById }, async (req, reply) => {
    let calc;
    try {
      calc = await getOrRebuild(req.params.id);
    } catch {
      return reply.code(503).send({ status: 'error', error: 'Calculator rebuild failed' });
    }
    if (!calc) return reply.code(404).send({ status: 'error', error: 'Calculator not found' });
    if (calc.test) return reply.code(404).send({ status: 'error', error: 'Health check not available for test calculators' });

    return {
      status: 'ok',
      calculatorId: req.params.id,
      name: calc.name ?? null,
      version: calc.version ?? null,
      expiresAt: calc.expiresAt,
    };
  });

  // List active calculators (LRU + Redis)
  app.get('/calculators', async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);
    const seen = new Set();
    const items = [];

    // LRU entries (source: "memory")
    for (const [id, calc] of store.entries()) {
      seen.add(id);
      const item = {
        calculatorId: id,
        name: calc.name ?? null,
        version: calc.version ?? null,
        hasToken: !!calc.token,
        accountId: calc.accountId ?? null,
        expiresAt: calc.expiresAt,
        source: 'memory',
      };
      if (calc.locale != null) item.locale = calc.locale;
      if (calc.description != null) item.description = calc.description;
      if (calc.test != null) item.test = calc.test;
      if (calc.mcp) item.mcp = calc.mcp;
      if (calc.integration) item.integration = calc.integration;
      items.push(item);
    }

    // Redis entries not in LRU
    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        const keys = [];
        const stream = redis.scanStream({ match: REDIS_PREFIX + '*', count: 100 });
        for await (const batch of stream) {
          keys.push(...batch);
          if (keys.length >= 10000) break;
        }

        const missing = keys.filter((k) => !seen.has(k.slice(REDIS_PREFIX.length)));
        if (missing.length) {
          const values = await redis.mget(missing);
          for (let i = 0; i < missing.length; i++) {
            if (!values[i]) continue;
            try {
              const r = JSON.parse(values[i]);
              const item = {
                calculatorId: missing[i].slice(REDIS_PREFIX.length),
                name: r.name ?? null,
                version: r.version ?? null,
                hasToken: !!r.token,
                accountId: r.accountId ?? null,

                source: 'redis',
              };
              if (r.locale != null) item.locale = r.locale;
              if (r.description != null) item.description = r.description;
              if (r.test != null) item.test = r.test;
              if (r.mcp) item.mcp = r.mcp;
              if (r.integration) item.integration = r.integration;
              items.push(item);
            } catch { /* skip unparseable */ }
          }
        }
      } catch { /* Redis scan failed, return LRU-only */ }
    }

    return { calculators: items };
  });

  // Create calculator
  app.post('/calculator', { preHandler: routeByBody }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    const { sheets, formulas, input, output, locale, name, version, description, test, calculatorId, token, accountId, mcp, integration, expressions } = req.body || {};

    if (!token || typeof token !== 'string') {
      return reply.code(400).send({ error: 'token required (non-empty string)' });
    }

    if (!calculatorId || typeof calculatorId !== 'string' || !calculatorId.trim()) {
      return reply.code(400).send({ error: 'calculatorId required (non-empty string)' });
    }

    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      return reply.code(400).send({ error: 'accountId required (non-empty string)' });
    }

    if (!sheets || typeof sheets !== 'object' || !Object.keys(sheets).length) {
      return reply.code(400).send({ error: 'sheets required (non-empty object)' });
    }
    if (!Array.isArray(formulas)) {
      return reply.code(400).send({ error: 'formulas required (array)' });
    }
    if (!input || !input.properties || !Object.keys(input.properties).length) {
      return reply.code(400).send({ error: 'input schema required with properties' });
    }
    if (!output || !output.properties || !Object.keys(output.properties).length) {
      return reply.code(400).send({ error: 'output schema required with properties' });
    }

    // Validate MCP config
    let mcpConfig = null;
    if (mcp != null) {
      if (typeof mcp !== 'object' || Array.isArray(mcp)) {
        return reply.code(400).send({ error: 'mcp must be an object' });
      }
      if (mcp.enabled && (!mcp.toolName || typeof mcp.toolName !== 'string')) {
        return reply.code(400).send({ error: 'mcp.toolName required when mcp.enabled is true' });
      }
      mcpConfig = {
        enabled: !!mcp.enabled,
        toolName: mcp.toolName || null,
        toolDescription: mcp.toolDescription || null,
        responseTemplate: mcp.responseTemplate || null,
      };
    }

    // Validate integration config
    let integrationConfig = null;
    if (integration != null) {
      if (typeof integration !== 'object' || Array.isArray(integration)) {
        return reply.code(400).send({ error: 'integration must be an object' });
      }
      integrationConfig = {
        skill: !!integration.skill,
        plugin: !!integration.plugin,
      };
    }

    let built;
    try {
      built = buildCalculator(sheets, formulas, input, output, locale);
    } catch (err) {
      return reply.code(400).send({ error: 'Schema error', detail: sanitizeDetail(err.message) });
    }

    const loc = resolveLocale(locale);

    try {
      const { workerIndex: workerId, profile: measuredProfile, unresolvedFunctions } = await pool.createCalculator(
        calculatorId, sheets, formulas, loc,
        built.inputMappings, built.outputScalars, built.outputRanges, expressions,
      );

      const staticProfile = buildStaticProfile(sheets, formulas, expressions);
      const profile = mergeWithMeasured(staticProfile, measuredProfile);

      const expiresAt = new Date(Date.now() + config.calculatorTtl * 1000).toISOString();

      store.set(calculatorId, {
        workerId,
        inputSchema: input,
        outputSchema: output,
        inputValidator: built.inputValidator,
        outputValidator: built.outputValidator,
        inputKeys: built.inputKeys,
        sheets,
        formulas,
        expressions: expressions || null,
        profile,
        locale,
        generation: 0,
        expiresAt,
        name: name ?? null,
        version: version ?? null,
        description: description ?? null,
        test: test ?? null,
        token,
        accountId: accountId ?? null,
        mcp: mcpConfig,
        integration: integrationConfig,
      });

      const recipe = {
        sheets, formulas,
        expressions: expressions || null,
        inputSchema: input,
        outputSchema: output,
        locale,
        generation: 0,
        name: name ?? null,
        version: version ?? null,
        description: description ?? null,
        test: test ?? null,
        token,
        accountId: accountId ?? null,
        mcp: mcpConfig,
        integration: integrationConfig,
        profile,
      };
      saveToRedis(calculatorId, recipe);

      if (accountId) await loadAccountLimits(accountId, true);

      const resp = {
        calculatorId,
        ttl: config.calculatorTtl,
        expiresAt,
        name: name ?? null,
        version: version ?? null,
        hasToken: true,
        accountId,
        input,
        output,
        profile,
      };
      if (locale != null) resp.locale = locale;
      if (description != null) resp.description = description;
      if (test != null) resp.test = test;
      if (mcpConfig) resp.mcp = mcpConfig;
      if (integrationConfig) resp.integration = integrationConfig;
      if (unresolvedFunctions?.length) resp.unresolvedFunctions = unresolvedFunctions;
      return reply.code(201).send(resp);
    } catch (err) {
      return reply.code(422).send({ error: 'Calculator creation failed', detail: sanitizeDetail(err.message) });
    }
  });

  // Get calculator metadata
  app.get('/calculator/:id', { preHandler: routeById }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    const meta = await getMetadata(req.params.id);
    if (!meta) return reply.code(404).send({ error: 'Calculator not found' });
    return meta;
  });

  // Describe calculator (self-describing endpoint for UI generation)
  app.get('/calculator/:id/describe', { preHandler: routeById }, async (req, reply) => {
    let calc;
    try {
      calc = await getOrRebuild(req.params.id);
    } catch {
      return reply.code(410).send({ error: 'Calculator rebuild failed' });
    }
    if (!calc) return reply.code(404).send({ error: 'Calculator not found' });

    // Auth: admin token (internal) or gateway HMAC
    if (!checkAdminToken(req)) {
      // Admin token valid — trusted internal caller, skip further auth
    } else if (isGatewayRequest(req)) {
      const gw = validateGatewayAuth(req);
      if (!gw) return reply.code(403).send({ error: 'Invalid gateway signature' });
      if (calc.accountId && gw.accountId !== calc.accountId) {
        return reply.code(403).send({ error: 'Account does not own this calculator' });
      }
    }

    const resp = {
      name: calc.name ?? null,
      version: calc.version ?? null,
      expected_input: cleanSchemaForDescribe(calc.inputSchema),
      expected_output: cleanSchemaForDescribe(calc.outputSchema),
    };
    if (calc.description != null) resp.description = calc.description;
    return resp;
  });

  // MCP connection config (admin-only)
  app.get('/calculator/:id/mcp', { preHandler: routeById }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    let calc;
    try {
      calc = await getOrRebuild(req.params.id);
    } catch {
      return reply.code(410).send({ error: 'Calculator rebuild failed' });
    }
    if (!calc) return reply.code(404).send({ error: 'Calculator not found' });

    if (!calc.mcp?.enabled) {
      return reply.code(404).send({ error: 'MCP not enabled for this calculator' });
    }

    const host = req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${proto}://${host}`;
    const endpoint = `/mcp/calculator/${req.params.id}`;

    return {
      enabled: true,
      endpoint,
      toolName: calc.mcp.toolName,
      toolDescription: calc.mcp.toolDescription,
      responseTemplate: calc.mcp.responseTemplate ?? null,
      claudeDesktop: {
        mcpServers: {
          [calc.mcp.toolName]: {
            url: `${baseUrl}${endpoint}`,
          },
        },
      },
    };
  });

  // Patch calculator
  app.patch('/calculator/:id', { preHandler: routeById }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    let calc;
    try {
      calc = await getOrRebuild(req.params.id);
    } catch {
      return reply.code(410).send({ error: 'Calculator rebuild failed' });
    }
    if (!calc) return reply.code(404).send({ error: 'Calculator not found' });

    const body = req.body || {};
    const { input, output, sheets, formulas, locale, name, version, description, test, token, mcp: mcpPatch, integration: integrationPatch, expressions } = body;

    // Validate MCP config if provided
    let newMcp = calc.mcp ?? null;
    if (mcpPatch !== undefined) {
      if (mcpPatch === null) {
        newMcp = null;
      } else {
        if (typeof mcpPatch !== 'object' || Array.isArray(mcpPatch)) {
          return reply.code(400).send({ error: 'mcp must be an object or null' });
        }
        // Merge with existing
        const base = calc.mcp || {};
        newMcp = {
          enabled: mcpPatch.enabled !== undefined ? !!mcpPatch.enabled : (base.enabled || false),
          toolName: mcpPatch.toolName !== undefined ? mcpPatch.toolName : (base.toolName || null),
          toolDescription: mcpPatch.toolDescription !== undefined ? mcpPatch.toolDescription : (base.toolDescription || null),
          responseTemplate: mcpPatch.responseTemplate !== undefined ? mcpPatch.responseTemplate : (base.responseTemplate || null),
        };
        if (newMcp.enabled && (!newMcp.toolName || typeof newMcp.toolName !== 'string')) {
          return reply.code(400).send({ error: 'mcp.toolName required when mcp.enabled is true' });
        }
      }
    }

    // Validate integration config if provided
    let newIntegration = calc.integration ?? null;
    if (integrationPatch !== undefined) {
      if (integrationPatch === null) {
        newIntegration = null;
      } else {
        if (typeof integrationPatch !== 'object' || Array.isArray(integrationPatch)) {
          return reply.code(400).send({ error: 'integration must be an object or null' });
        }
        const base = calc.integration || {};
        newIntegration = {
          skill: integrationPatch.skill !== undefined ? !!integrationPatch.skill : (base.skill || false),
          plugin: integrationPatch.plugin !== undefined ? !!integrationPatch.plugin : (base.plugin || false),
        };
      }
    }

    const newSheets = sheets || calc.sheets;
    const newFormulas = formulas || calc.formulas;
    const newInput = input || calc.inputSchema;
    const newOutput = output || calc.outputSchema;
    const newLocale = locale !== undefined ? locale : calc.locale;
    const newName = name !== undefined ? name : calc.name;
    const newVersion = version !== undefined ? version : calc.version;
    const newDesc = description !== undefined ? description : calc.description;
    const newTest = test !== undefined ? test : calc.test;
    const newToken = token !== undefined ? token : calc.token;
    const newExpressions = expressions !== undefined ? (expressions || null) : (calc.expressions ?? null);
    const dataChanged = sheets || formulas || expressions !== undefined || (locale !== undefined && locale !== calc.locale);

    let built;
    try {
      built = buildCalculator(newSheets, newFormulas, newInput, newOutput, newLocale);
    } catch (err) {
      return reply.code(400).send({ error: 'Schema error', detail: sanitizeDetail(err.message) });
    }

    const loc = resolveLocale(newLocale);
    // Bump generation on data change to invalidate result cache
    const newGeneration = dataChanged ? (calc.generation || 0) + 1 : (calc.generation || 0);

    if (dataChanged) {
      try {
        await pool.destroyCalculator(req.params.id, calc.workerId);
      } catch { /* may already be gone */ }

      try {
        const { workerIndex: workerId, profile: measuredProfile, unresolvedFunctions: newUnresolved } = await pool.createCalculator(
          req.params.id, newSheets, newFormulas, loc,
          built.inputMappings, built.outputScalars, built.outputRanges, newExpressions,
        );

        const staticProfile = buildStaticProfile(newSheets, newFormulas, newExpressions);
        const newProfile = mergeWithMeasured(staticProfile, measuredProfile);

        const expiresAt = new Date(Date.now() + config.calculatorTtl * 1000).toISOString();
        store.set(req.params.id, {
          workerId,
          inputSchema: newInput,
          outputSchema: newOutput,
          inputValidator: built.inputValidator,
          outputValidator: built.outputValidator,
          inputKeys: built.inputKeys,
          sheets: newSheets,
          formulas: newFormulas,
          expressions: newExpressions,
          profile: newProfile,
          locale: newLocale,
          generation: newGeneration,
          expiresAt,
          name: newName ?? null,
          version: newVersion ?? null,
          description: newDesc ?? null,
          test: newTest ?? null,
          token: newToken,
          accountId: calc.accountId ?? null,
          mcp: newMcp,
          integration: newIntegration,
        });

        const recipe = {
          sheets: newSheets, formulas: newFormulas,
          expressions: newExpressions,
          inputSchema: newInput, outputSchema: newOutput,
          locale: newLocale,
          generation: newGeneration,
          name: newName ?? null,
          version: newVersion ?? null,
          description: newDesc ?? null,
          test: newTest ?? null,
          token: newToken,
          accountId: calc.accountId ?? null,
          mcp: newMcp,
          integration: newIntegration,
          profile: newProfile,
        };
        saveToRedis(req.params.id, recipe);

        const resp = {
          calculatorId: req.params.id,
          ttl: config.calculatorTtl,
          expiresAt,
          name: newName ?? null,
          version: newVersion ?? null,
          hasToken: !!newToken,
          accountId: calc.accountId ?? null,
          input: newInput,
          output: newOutput,
          profile: newProfile,
        };
        if (newLocale != null) resp.locale = newLocale;
        if (newDesc != null) resp.description = newDesc;
        if (newTest != null) resp.test = newTest;
        if (newMcp) resp.mcp = newMcp;
        if (newIntegration) resp.integration = newIntegration;
        if (newUnresolved?.length) resp.unresolvedFunctions = newUnresolved;
        return resp;
      } catch (err) {
        return reply.code(422).send({ error: 'Calculator rebuild failed', detail: sanitizeDetail(err.message) });
      }
    }

    // Schema-only change — no worker rebuild (new object to avoid mid-flight mutation)
    const expiresAt = new Date(Date.now() + config.calculatorTtl * 1000).toISOString();
    const updated = {
      ...calc,
      inputSchema: newInput,
      outputSchema: newOutput,
      inputValidator: built.inputValidator,
      outputValidator: built.outputValidator,
      inputKeys: built.inputKeys,
      generation: newGeneration,
      expiresAt,
      name: newName ?? null,
      version: newVersion ?? null,
      description: newDesc ?? null,
      test: newTest ?? null,
      token: newToken,
      accountId: calc.accountId ?? null,
      mcp: newMcp,
      integration: newIntegration,
    };
    store.set(req.params.id, updated);

    const recipe = {
      sheets: calc.sheets, formulas: calc.formulas,
      expressions: newExpressions,
      inputSchema: newInput, outputSchema: newOutput,
      locale: calc.locale,
      generation: newGeneration,
      name: newName ?? null,
      version: newVersion ?? null,
      description: newDesc ?? null,
      test: newTest ?? null,
      token: newToken,
      accountId: calc.accountId ?? null,
      mcp: newMcp,
      integration: newIntegration,
      profile: calc.profile ?? null,
    };
    saveToRedis(req.params.id, recipe);

    const resp = {
      calculatorId: req.params.id,
      ttl: config.calculatorTtl,
      expiresAt,
      name: newName ?? null,
      version: newVersion ?? null,
      hasToken: !!newToken,
      accountId: calc.accountId ?? null,
      input: newInput,
      output: newOutput,
    };
    if (calc.profile) resp.profile = calc.profile;
    if (newLocale != null) resp.locale = newLocale;
    if (newDesc != null) resp.description = newDesc;
    if (newTest != null) resp.test = newTest;
    if (newMcp) resp.mcp = newMcp;
    if (newIntegration) resp.integration = newIntegration;
    return resp;
  });

  // Delete calculator
  app.delete('/calculator/:id', { preHandler: routeById }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    const calc = store.get(req.params.id);
    const redisDeleted = await deleteFromRedis(req.params.id);

    if (!calc && !redisDeleted) {
      return reply.code(404).send({ error: 'Calculator not found' });
    }

    if (calc) store.delete(req.params.id);

    return reply.code(204).send();
  });

  // Refresh MCP config from Admin API (admin-only, hash-ring routed)
  app.post('/cache/refresh-mcp/:id', { preHandler: routeById }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    const id = req.params.id;
    const adminMcp = await fetchMcpConfig(id);
    if (!adminMcp) return reply.code(404).send({ error: 'MCP config not found' });

    const calc = store.get(id);
    if (calc) {
      calc.mcp = {
        enabled: adminMcp.enabled ?? calc.mcp?.enabled ?? false,
        toolName: adminMcp.toolName ?? calc.mcp?.toolName ?? null,
        toolDescription: adminMcp.toolDescription ?? calc.mcp?.toolDescription ?? null,
        responseTemplate: adminMcp.responseTemplate ?? calc.mcp?.responseTemplate ?? null,
      };
      if (adminMcp.inputSchema) calc.mcpInputSchema = adminMcp.inputSchema;
    }

    // Patch Redis recipe too
    const recipe = await loadFromRedis(id);
    if (recipe) {
      recipe.mcp = calc?.mcp ?? {
        enabled: adminMcp.enabled ?? false,
        toolName: adminMcp.toolName ?? null,
        toolDescription: adminMcp.toolDescription ?? null,
        responseTemplate: adminMcp.responseTemplate ?? null,
      };
      if (adminMcp.inputSchema) recipe.mcpInputSchema = adminMcp.inputSchema;
      saveToRedis(id, recipe);
    }

    return { refreshed: true, inMemory: !!calc, redis: !!recipe, mcp: calc?.mcp ?? recipe?.mcp ?? null };
  });

  // Execute calculator
  app.post('/execute/calculator/:id', { preHandler: routeById }, async (req, reply) => {
    const start = Date.now();
    const calcId = req.params.id;
    let calcTestFlag;
    const stat = (opts) => stats.record({ calculatorId: calcId, responseTimeMs: Date.now() - start, test: calcTestFlag, type: 'calculator', account: calc?.accountId ?? undefined, ...opts });

    let calc;
    try {
      calc = await getOrRebuild(calcId);
    } catch {
      stat({ cached: false, error: true, errorMessage: 'Calculator rebuild failed' });
      return reply.code(410).send({ error: 'Calculator rebuild failed' });
    }
    if (!calc) {
      stat({ cached: false, error: true, errorMessage: 'Calculator not found or expired' });
      return reply.code(410).send({ error: 'Calculator not found or expired' });
    }

    calcTestFlag = calc.test ?? undefined;

    // Auth: gateway path or legacy token path
    let authAccountId;
    if (isGatewayRequest(req)) {
      const gw = validateGatewayAuth(req);
      if (!gw) {
        stat({ cached: false, error: true, errorMessage: 'Invalid gateway signature' });
        return reply.code(403).send({ error: 'Invalid gateway signature' });
      }
      // Verify ownership: gateway account must own this calculator
      if (calc.accountId && gw.accountId !== calc.accountId) {
        stat({ cached: false, error: true, errorMessage: 'Account mismatch' });
        return reply.code(403).send({ error: 'Account does not own this calculator' });
      }
      authAccountId = gw.accountId;
    }

    // Rate limiting
    const accountId = authAccountId || calc.accountId;
    if (accountId && !rateLimiter.has(accountId)) {
      const loaded = await loadAccountLimits(accountId);
      if (!loaded) {
        stat({ cached: false, error: true, errorMessage: 'Account not found' });
        return reply.code(403).send({ error: 'Account not found' });
      }
    }
    const rl = await rateLimiter.check(accountId);
    if (!rl.allowed) {
      const msg = rl.reason === 'monthly' ? 'Monthly quota exceeded' : 'Rate limit exceeded';
      stat({ cached: false, error: true, errorMessage: msg });
      if (rl.retryAfter) reply.header('Retry-After', String(rl.retryAfter));
      return reply.code(429).send({ error: msg });
    }

    refreshRedisTtl(calcId);

    const inputData = req.body || {};

    try {
      const { result, cached } = await executeCalculatorCore(calc, calcId, inputData);
      reply.header('X-Cache', cached ? 'HIT' : 'MISS');
      stat({ cached, error: false });
      return result;
    } catch (err) {
      stat({ cached: false, error: true, errorMessage: err.body?.error || err.message?.slice(0, 200) });
      return reply.code(err.status || 500).send(err.body || { error: 'Calculation failed', detail: sanitizeDetail(err.message) });
    }
  });
}
