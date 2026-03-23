// Centralized configuration - validated at startup
import os from 'node:os';
import { logger } from './logger.js';

const env = process.env;
const defaultPoolSize = os.availableParallelism?.() || os.cpus().length || 2;

// Parse human-readable byte strings: "400MB", "1GB", "512kb", or plain number
const parseBytes = (str) => {
  if (!str) return 0;
  const m = str.match(/^(\d+(?:\.\d+)?)\s*(gb|mb|kb|b)?$/i);
  if (!m) return parseInt(str, 10) || 0;
  const n = parseFloat(m[1]);
  switch (m[2]?.toLowerCase()) {
    case 'gb': return Math.round(n * 1073741824);
    case 'mb': return Math.round(n * 1048576);
    case 'kb': return Math.round(n * 1024);
    default: return Math.round(n);
  }
};

const engine = env.ENGINE || 'hyperformula';
const VALID_ENGINES = new Set(['hyperformula', 'bl-excel', 'both']);
if (!VALID_ENGINES.has(engine)) {
  logger.warn('[config] Unknown ENGINE="%s", falling back to hyperformula', engine);
}

export const config = {
  engine: VALID_ENGINES.has(engine) ? engine : 'hyperformula',
  port: parseInt(env.PORT || '3000', 10),
  host: env.HOST || '0.0.0.0',
  poolSize: parseInt(env.POOL_SIZE, 10) || defaultPoolSize,
  logLevel: env.LOG_LEVEL || 'warn',
  defaultLocale: env.DEFAULT_LOCALE || 'enUS',

  // Redis (optional)
  redisUrl: env.REDIS_URL || null,
  cacheTtl: parseInt(env.CACHE_TTL_SECONDS || '3600', 10),

  // In-memory LRU
  cacheMaxItems: parseInt(env.CACHE_MAX_MEMORY_ITEMS || '50000', 10),

  // Batch limits
  maxBatchSize: 1000,

  // Backpressure
  requestTimeout: parseInt(env.REQUEST_TIMEOUT_MS || '10000', 10),
  maxEventLoopDelay: parseInt(env.MAX_EVENT_LOOP_DELAY_MS || '500', 10),
  maxQueueDepth: parseInt(env.MAX_QUEUE_DEPTH || '0', 10),
  maxHeapUsedBytes: parseBytes(env.MAX_HEAP_USED_BYTES),

  // Payload size limit (JSON body + multipart uploads)
  maxPayloadSize: parseBytes(env.MAX_PAYLOAD_SIZE) || 20 * 1048576, // 20MB

  // Calculators
  calculatorTtl: parseInt(env.CALCULATOR_TTL_SECONDS || '1800', 10),
  calculatorRedisTtl: parseInt(env.CALCULATOR_REDIS_TTL_SECONDS || '2592000', 10),
  calculatorResultTtl: parseInt(env.CALCULATOR_RESULT_TTL_SECONDS || '3600', 10),
  accountLimitsRedisTtl: parseInt(env.ACCOUNT_LIMITS_REDIS_TTL_SECONDS || '86400', 10),
  maxCalculatorsPerWorker: parseInt(env.MAX_CALCULATORS_PER_WORKER || '10', 10),
  maxCalculators: parseInt(env.MAX_CALCULATORS || '100', 10),

  // Instance identity (for cluster health reporting + routing)
  instanceId: env.INSTANCE_ID || `${os.hostname()}-${Math.random().toString(36).slice(2, 8)}`,
  internalUrl: env.INTERNAL_URL || null,
  healthPushInterval: parseInt(env.HEALTH_PUSH_INTERVAL_MS || '15000', 10),
  hashRingRefreshInterval: parseInt(env.HASH_RING_REFRESH_MS || '5000', 10),

  // Request logging (opt-in structured per-request logging)
  requestLogging: env.REQUEST_LOGGING === 'true' || env.REQUEST_LOGGING === '1',

  // Admin token (protects management endpoints: calculators CRUD, list, parse)
  adminToken: env.ADMIN_TOKEN || null,

  // Admin API (base URL, no trailing slash — used by stats telemetry + recipe persistence)
  adminApiUrl: env.ADMIN_API_URL || null,
  adminApiKey: env.ADMIN_API_KEY || null,
  statsFlushInterval: parseInt(env.STATS_FLUSH_INTERVAL_MS || '10000', 10),
  statsMaxBatch: parseInt(env.STATS_MAX_BATCH || '1000', 10),
};

// Locale mapping: short code -> engine locale
export const LOCALES = {
  en: 'enUS', da: 'daDK', de: 'deDE', es: 'esES',
  fi: 'fiFI', fr: 'frFR', hu: 'huHU', it: 'itIT',
  nb: 'nbNO', nl: 'nlNL', pl: 'plPL', pt: 'ptPT',
  sv: 'svSE', tr: 'trTR', cs: 'csCZ', ru: 'ruRU',
  // bl-excel only
  el: 'elGR', et: 'etEE', id: 'idID', ja: 'jaJP',
  ko: 'koKR', ms: 'msMY', 'pt-br': 'ptBR', sl: 'slSI', uk: 'ukUA',
};

// IETF BCP 47 tag (lowercase) → engine locale code
export const IETF_TO_ENGINE = {
  'en-us': 'enUS', 'da-dk': 'daDK', 'de-de': 'deDE', 'de-at': 'deDE', 'de-ch': 'deDE',
  'es-es': 'esES', 'es-mx': 'esES', 'es-ar': 'esES',
  'fi-fi': 'fiFI', 'fr-fr': 'frFR', 'fr-be': 'frFR', 'fr-ch': 'frFR', 'fr-ca': 'frFR',
  'hu-hu': 'huHU', 'it-it': 'itIT', 'it-ch': 'itIT',
  'nb-no': 'nbNO', 'nn-no': 'nbNO', 'nl-nl': 'nlNL', 'nl-be': 'nlNL',
  'pl-pl': 'plPL', 'pt-pt': 'ptPT', 'pt-br': 'ptBR',
  'sv-se': 'svSE', 'tr-tr': 'trTR', 'cs-cz': 'csCZ', 'ru-ru': 'ruRU',
  'el-gr': 'elGR', 'et-ee': 'etEE', 'id-id': 'idID',
  'ja-jp': 'jaJP', 'ko-kr': 'koKR', 'ms-my': 'msMY',
  'sl-si': 'slSI', 'uk-ua': 'ukUA',
};

// Engine locale code → canonical IETF tag
export const ENGINE_TO_IETF = {
  enUS: 'en-US', daDK: 'da-DK', deDE: 'de-DE', esES: 'es-ES',
  fiFI: 'fi-FI', frFR: 'fr-FR', huHU: 'hu-HU', itIT: 'it-IT',
  nbNO: 'nb-NO', nlNL: 'nl-NL', plPL: 'pl-PL', ptPT: 'pt-PT',
  svSE: 'sv-SE', trTR: 'tr-TR', csCZ: 'cs-CZ', ruRU: 'ru-RU',
  elGR: 'el-GR', etEE: 'et-EE', idID: 'id-ID', jaJP: 'ja-JP',
  koKR: 'ko-KR', msMY: 'ms-MY', ptBR: 'pt-BR', slSI: 'sl-SI', ukUA: 'uk-UA',
};

// Locales supported only by bl-excel (not HyperFormula)
export const BL_ONLY_LOCALES = new Set([
  'elGR', 'etEE', 'idID', 'jaJP', 'koKR', 'msMY', 'ptBR', 'slSI', 'ukUA',
]);

export const resolveLocale = (locale) =>
  LOCALES[locale] || locale || config.defaultLocale;

// Normalize IETF BCP 47 tag → engine locale code, with enUS fallback
export const resolveIetfLocale = (tag) => {
  if (!tag) return null;
  const code = IETF_TO_ENGINE[tag.toLowerCase()];
  if (!code) return null;
  if (code === config.defaultLocale) return null; // omit default
  // Guard: if HyperFormula engine and locale is bl-only, fall back
  if (config.engine === 'hyperformula' && BL_ONLY_LOCALES.has(code)) return null;
  return code;
};

// Engine locale code → IETF tag for xlsx embedding
export const engineToIetf = (code) => ENGINE_TO_IETF[code] || null;
