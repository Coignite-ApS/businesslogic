import { pool } from '../services/engine-pool.js';
import * as cache from '../services/cache.js';
import * as stats from '../services/stats.js';
import * as rateLimiter from '../services/rate-limiter.js';
import { loadAccountLimits } from '../services/account-limits.js';
import { config, resolveLocale } from '../config.js';
import { blockedRe, volatileRe, errorTypeMap } from '../blocked.js';
import { validateFormulaToken } from '../utils/auth.js';
import blExcel from '@coignite/businesslogic-excel';

// Check if result is HyperFormula error
const isError = (v) => v && typeof v === 'object' && v.type;

// Derive format from result type
const fmt = (v) => Array.isArray(v) ? 'array' : 'scalar';

// Single .test() per formula — O(n) scan, exits on first match
const isBlocked = (formula) => blockedRe.test(formula);
const isVolatile = (formula) => volatileRe.test(formula);
const blockedErr = (formula) => ({ error: 'Formula error', type: 'NAME', formula });

// Remap error type to standard Excel equivalent
const mapErr = (type) => errorTypeMap[type] || type;

// Build set of known function names for NAME error enrichment
let knownFunctions = null;
function getKnownFunctions() {
  if (knownFunctions) return knownFunctions;
  try {
    const docs = blExcel.getFunctionDocs();
    const fns = docs?.functions || [];
    knownFunctions = new Set(fns.map(f => f.name.toUpperCase()));
  } catch {
    knownFunctions = new Set();
  }
  return knownFunctions;
}

// Extract function names from formula that aren't in the known set
const fnTokenRe = /([A-Z_][A-Z0-9_.]*)\s*\(/gi;
function findUnresolvedFunctions(formula) {
  const known = getKnownFunctions();
  if (!known.size) return undefined;
  const unknown = new Set();
  let m;
  fnTokenRe.lastIndex = 0;
  while ((m = fnTokenRe.exec(formula)) !== null) {
    const name = m[1].toUpperCase();
    if (!known.has(name)) unknown.add(name);
  }
  return unknown.size ? [...unknown] : undefined;
}

// Enrich NAME error body with unresolvedFunctions if engine didn't provide them
function enrichNameError(body) {
  if (body.type === 'NAME' && !body.unresolvedFunctions && body.formula) {
    const uf = findUnresolvedFunctions(body.formula);
    if (uf) body.unresolvedFunctions = uf;
  }
  return body;
}

// JSON Schemas for fast validation
const dataSchema = { type: 'array', items: { type: 'array' } };

const expressionSchema = {
  type: 'object',
  required: ['name', 'expression'],
  properties: {
    name: { type: 'string' },
    expression: { type: 'string' },
    scope: { type: 'string' },
  },
};

const singleSchema = {
  body: {
    type: 'object',
    required: ['formula'],
    properties: {
      formula: { type: 'string', minLength: 1, maxLength: 10000 },
      locale: { type: 'string', maxLength: 10 },
      data: dataSchema,
      expressions: { type: 'array', items: expressionSchema },
    },
  },
};

const batchSchema = {
  body: {
    type: 'object',
    required: ['formulas'],
    properties: {
      formulas: {
        type: 'array',
        minItems: 1,
        maxItems: config.maxBatchSize,
        items: { type: 'string', minLength: 1, maxLength: 10000 },
      },
      locale: { type: 'string', maxLength: 10 },
      data: dataSchema,
      expressions: { type: 'array', items: expressionSchema },
    },
  },
};

const sheetsSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: { type: 'array', items: { type: 'array' } },
};

const sheetFormulaSchema = {
  type: 'object',
  required: ['cell', 'formula'],
  properties: {
    cell: { type: 'string', pattern: '^[A-Za-z]+[0-9]+$' },
    formula: { type: 'string', minLength: 1 },
    sheet: { type: 'string' },
  },
};

const sheetSchema = {
  body: {
    type: 'object',
    required: ['formulas'],
    properties: {
      data: dataSchema,
      sheets: sheetsSchema,
      formulas: { type: 'array', items: sheetFormulaSchema },
      locale: { type: 'string', maxLength: 10 },
      expressions: { type: 'array', items: expressionSchema },
    },
  },
};

// Formula token auth + rate limit preHandler
const formulaAuth = async (req, reply) => {
  const token = req.headers['x-auth-token'];
  if (!token) {
    req.log.warn({ ip: req.ip }, '[auth] missing formula token');
    return reply.code(401).send({ error: 'Missing X-Auth-Token header' });
  }
  const result = await validateFormulaToken(token);
  if (!result) {
    req.log.warn({ ip: req.ip }, '[auth] invalid formula token');
    return reply.code(403).send({ error: 'Invalid auth token' });
  }
  req.formulaAccount = result; // { accountId, label }

  // Rate limiting (same pattern as calculator routes)
  const accountId = result.accountId;
  if (accountId && !rateLimiter.has(accountId)) {
    await loadAccountLimits(accountId);
  }
  const rl = await rateLimiter.check(accountId);
  if (!rl.allowed) {
    const msg = rl.reason === 'monthly' ? 'Monthly quota exceeded' : 'Rate limit exceeded';
    if (rl.retryAfter) reply.header('Retry-After', String(rl.retryAfter));
    return reply.code(429).send({ error: msg });
  }
};

export async function registerRoutes(app) {
  // Single formula evaluation
  app.post('/execute', { schema: singleSchema, preHandler: formulaAuth }, async (req, reply) => {
    const start = Date.now();
    const account = req.formulaAccount?.accountId;
    const stat = (opts) => {
      stats.record({ calculatorId: null, responseTimeMs: Date.now() - start, type: 'formula', account, ...opts });
      if (!opts.error) rateLimiter.record(account);
    };

    const { formula, locale, data, expressions } = req.body;
    const loc = resolveLocale(locale);

    // Block fingerprint functions
    if (isBlocked(formula)) {
      stat({ cached: false, error: true, errorMessage: 'Blocked formula' });
      return reply.code(422).send(blockedErr(formula));
    }

    // With-data path: skip cache, use temp engine
    if (data) {
      const result = await pool.evalSingleWithData(formula, data, loc, expressions);
      if (isError(result)) {
        stat({ cached: false, error: true, errorMessage: `Formula error: ${mapErr(result.type)}` });
        const body = { error: 'Formula error', type: mapErr(result.type), formula };
        return reply.code(422).send(enrichNameError(body));
      }
      stat({ cached: false, error: false });
      return { result, formula, format: fmt(result), cached: false };
    }

    const skipCache = isVolatile(formula);

    // Cache lookup (skip for volatile functions like RAND, NOW)
    if (!skipCache) {
      const { value, cached } = await cache.get(formula, loc);
      if (cached) {
        stat({ cached: true, error: false });
        return { result: value, formula, format: fmt(value), cached: true };
      }
    }

    // Evaluate
    const result = await pool.evalSingle(formula, loc);

    if (isError(result)) {
      stat({ cached: false, error: true, errorMessage: `Formula error: ${mapErr(result.type)}` });
      const body = { error: 'Formula error', type: mapErr(result.type), formula };
      return reply.code(422).send(enrichNameError(body));
    }

    // Cache store (fire-and-forget, skip volatile)
    if (!skipCache) cache.set(formula, loc, result);

    stat({ cached: false, error: false });
    return { result, formula, format: fmt(result), cached: false };
  });

  // Batch formula evaluation
  app.post('/execute/batch', { schema: batchSchema, preHandler: formulaAuth }, async (req, reply) => {
    const start = Date.now();
    const account = req.formulaAccount?.accountId;
    const stat = (opts) => {
      stats.record({ calculatorId: null, responseTimeMs: Date.now() - start, type: 'formula', account, ...opts });
      if (!opts.error) rateLimiter.record(account);
    };

    const { formulas, locale, data, expressions } = req.body;
    const loc = resolveLocale(locale);
    const len = formulas.length;

    // Pre-check blocked functions
    const blockedMap = new Set();
    for (let i = 0; i < len; i++) {
      if (isBlocked(formulas[i])) blockedMap.add(i);
    }

    // With-data path: skip all cache logic
    if (data) {
      const evalFormulas = [];
      const evalIndices = [];
      for (let i = 0; i < len; i++) {
        if (!blockedMap.has(i)) {
          evalFormulas.push(formulas[i]);
          evalIndices.push(i);
        }
      }

      let evaluated = [];
      if (evalFormulas.length > 0) {
        evaluated = await pool.evalBatchWithData(evalFormulas, data, loc, expressions);
      }

      const results = new Array(len);
      let evalIdx = 0;
      const hasErrors = blockedMap.size > 0;
      for (let i = 0; i < len; i++) {
        const f = formulas[i];
        if (blockedMap.has(i)) {
          results[i] = enrichNameError({ formula: f, error: 'Formula error', type: 'NAME' });
        } else {
          const r = evaluated[evalIdx++];
          if (isError(r)) {
            results[i] = enrichNameError({ formula: f, error: 'Formula error', type: mapErr(r.type) });
          } else {
            results[i] = { formula: f, result: r, format: fmt(r), cached: false };
          }
        }
      }
      stat({ cached: false, error: hasErrors });
      return { results };
    }

    // No-data path: existing cache logic
    const volatileMap = new Set();
    for (let i = 0; i < len; i++) {
      if (!blockedMap.has(i) && isVolatile(formulas[i])) volatileMap.add(i);
    }

    // Batch cache lookup (skip blocked and volatile)
    const skipCache = (i) => blockedMap.has(i) || volatileMap.has(i);
    const evalFormulas = formulas.filter((_, i) => !skipCache(i));
    const evalIndices = [];
    for (let i = 0; i < len; i++) if (!skipCache(i)) evalIndices.push(i);

    const cached = evalFormulas.length > 0 ? await cache.mget(evalFormulas, loc) : new Map();

    // Find cache misses — volatile formulas always go to worker
    const misses = [];
    const missOrigIndices = [];
    for (let j = 0; j < evalFormulas.length; j++) {
      if (!cached.has(j)) {
        misses.push(evalFormulas[j]);
        missOrigIndices.push(evalIndices[j]);
      }
    }
    // Append volatile formulas (always evaluated, never cached)
    for (const i of volatileMap) {
      misses.push(formulas[i]);
      missOrigIndices.push(i);
    }

    // Evaluate misses in batch
    let evaluated = [];
    if (misses.length > 0) {
      evaluated = await pool.evalBatch(misses, loc);

      // Cache new results (skip errors and volatile)
      const toCache = [];
      for (let j = 0; j < misses.length; j++) {
        if (!isError(evaluated[j]) && !volatileMap.has(missOrigIndices[j])) {
          toCache.push({ formula: misses[j], value: evaluated[j] });
        }
      }
      if (toCache.length > 0) cache.mset(toCache, loc);
    }

    // Build result lookup for misses by original index
    const missResults = new Map();
    for (let j = 0; j < missOrigIndices.length; j++) {
      missResults.set(missOrigIndices[j], evaluated[j]);
    }

    // Build response
    const results = new Array(len);
    let cacheIdx = 0;

    for (let i = 0; i < len; i++) {
      const f = formulas[i];
      if (blockedMap.has(i)) {
        results[i] = enrichNameError({ formula: f, error: 'Formula error', type: 'NAME' });
      } else if (volatileMap.has(i)) {
        const r = missResults.get(i);
        if (isError(r)) {
          results[i] = enrichNameError({ formula: f, error: 'Formula error', type: mapErr(r.type) });
        } else {
          results[i] = { formula: f, result: r, format: fmt(r), cached: false };
        }
      } else if (cached.has(cacheIdx)) {
        const v = cached.get(cacheIdx).value;
        results[i] = { formula: f, result: v, format: fmt(v), cached: true };
        cacheIdx++;
      } else {
        const r = missResults.get(i);
        if (isError(r)) {
          results[i] = enrichNameError({ formula: f, error: 'Formula error', type: mapErr(r.type) });
        } else {
          results[i] = { formula: f, result: r, format: fmt(r), cached: false };
        }
        cacheIdx++;
      }
    }

    stat({ cached: false, error: blockedMap.size > 0 });
    return { results };
  });

  // Sheet evaluation (no caching - cell data makes each unique)
  app.post('/execute/sheet', { schema: sheetSchema, preHandler: formulaAuth }, async (req, reply) => {
    const start = Date.now();
    const account = req.formulaAccount?.accountId;
    const stat = (opts) => {
      stats.record({ calculatorId: null, responseTimeMs: Date.now() - start, type: 'formula', account, ...opts });
      if (!opts.error) rateLimiter.record(account);
    };

    const { data, sheets, formulas, locale, expressions } = req.body;
    const loc = resolveLocale(locale);

    // data and sheets are mutually exclusive; one is required
    if (data && sheets) {
      return reply.code(400).send({ error: 'Provide either "data" or "sheets", not both' });
    }
    if (!data && !sheets) {
      return reply.code(400).send({ error: 'Either "data" or "sheets" is required' });
    }

    // Block fingerprint functions in sheet formulas
    for (const { formula } of formulas) {
      if (isBlocked(formula)) {
        stat({ cached: false, error: true, errorMessage: 'Blocked formula' });
        return reply.code(422).send(blockedErr(formula));
      }
    }

    try {
      if (sheets) {
        const results = await pool.evalMultiSheet(sheets, formulas, loc, expressions);
        stat({ cached: false, error: false });
        return { results };
      }
      const results = await pool.evalSheet(data, formulas, loc, expressions);
      stat({ cached: false, error: false });
      return { results };
    } catch (err) {
      stat({ cached: false, error: true, errorMessage: err.message });
      return reply.code(422).send({
        error: 'Sheet evaluation error',
        detail: err.message?.replace(/[Hh]yper[Ff]ormula/g, 'engine'),
      });
    }
  });
}
