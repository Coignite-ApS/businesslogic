import os from 'node:os';
import { readFileSync } from 'node:fs';

const env = process.env;

// Read version from package.json
let version = '0.0.0';
try { version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch {}

export const config = {
  // Core
  port: parseInt(env.PORT || '3200', 10),
  host: env.HOST || '0.0.0.0',
  logLevel: env.LOG_LEVEL || 'warn',
  version,

  // Database
  databaseUrl: env.DATABASE_URL || '',

  // Redis
  redisUrl: env.REDIS_URL || '',

  // AI providers
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  openaiApiKey: env.OPENAI_API_KEY || '',

  // Models
  defaultModel: env.AI_DEFAULT_MODEL || 'claude-sonnet-4-6',
  allowedModels: env.AI_ALLOWED_MODELS || 'claude-sonnet-4-6,claude-haiku-4-5-20251001,claude-opus-4-6',
  maxToolRounds: parseInt(env.AI_MAX_TOOL_ROUNDS || '5', 10),
  maxOutputTokens: parseInt(env.AI_MAX_OUTPUT_TOKENS || '4096', 10),

  // Chat pool
  chatPoolSize: parseInt(env.CHAT_POOL_SIZE || '4', 10),
  chatTimeoutMs: parseInt(env.CHAT_TIMEOUT_MS || '120000', 10),

  // Embedding pool
  embedPoolSize: parseInt(env.EMBED_POOL_SIZE || '2', 10),
  embeddingModel: env.KB_EMBEDDING_MODEL || 'text-embedding-3-small',

  // Knowledge base
  kbChunkSize: parseInt(env.KB_CHUNK_SIZE || '512', 10),
  kbChunkOverlap: parseFloat(env.KB_CHUNK_OVERLAP || '0.1'),
  kbChunkMinSize: parseInt(env.KB_CHUNK_MIN_SIZE || '128', 10),
  kbChunkMaxSize: parseInt(env.KB_CHUNK_MAX_SIZE || '768', 10),
  kbMinSimilarity: parseFloat(env.KB_MIN_SIMILARITY || '0.2'),
  kbRrfK: parseInt(env.KB_RRF_K || '60', 10),
  kbContextualRetrieval: env.KB_CONTEXTUAL_RETRIEVAL !== 'false',
  kbAnswerCacheTtl: parseInt(env.KB_ANSWER_CACHE_TTL || '3600', 10),

  // Reranker
  rerankerEnabled: env.KB_RERANKER_ENABLED === 'true',
  rerankerProvider: env.KB_RERANKER_PROVIDER || 'cohere',
  rerankerApiKey: env.KB_RERANKER_API_KEY || '',
  rerankerModel: env.KB_RERANKER_MODEL || '',
  rerankerTopK: parseInt(env.KB_RERANKER_TOP_K || '10', 10),

  // BullMQ ingestion
  ingestConcurrency: parseInt(env.INGEST_CONCURRENCY || '2', 10),
  ingestRetries: parseInt(env.INGEST_RETRIES || '3', 10),

  // Budget
  dailyBudgetUsd: parseFloat(env.DAILY_BUDGET_USD || '100'),
  monthlyBudgetUsd: parseFloat(env.MONTHLY_BUDGET_USD || '1000'),
  globalDailyBudgetUsd: parseFloat(env.GLOBAL_DAILY_BUDGET_USD || '500'),
  conversationBudgetUsd: parseFloat(env.CONVERSATION_BUDGET_USD || '1'),

  // Cache
  cacheMaxItems: parseInt(env.CACHE_MAX_ITEMS || '10000', 10),
  cacheTtlSeconds: parseInt(env.CACHE_TTL_SECONDS || '300', 10),

  // Auth
  adminToken: env.AI_API_ADMIN_TOKEN || env.ADMIN_TOKEN || '',

  // External services
  formulaApiUrl: (env.FORMULA_API_URL || '').replace(/\/+$/, ''),
  formulaApiAdminToken: env.FORMULA_API_ADMIN_TOKEN || '',

  // Token encryption (for calculator API keys)
  tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY || '',

  // Conversations
  maxConversationMessages: parseInt(env.AI_MAX_CONVERSATION_MESSAGES || '50', 10),
  maxConversations: parseInt(env.AI_MAX_CONVERSATIONS || '50', 10),
  maxMessageLength: parseInt(env.AI_MAX_MESSAGE_LENGTH || '10000', 10),

  // Rate limiting
  rateLimitPerMinute: parseInt(env.AI_RATE_LIMIT_PER_MINUTE || '20', 10),

  // Backpressure
  requestTimeout: parseInt(env.REQUEST_TIMEOUT_MS || '130000', 10),
  maxEventLoopDelay: parseInt(env.MAX_EVENT_LOOP_DELAY_MS || '1000', 10),
  maxPayloadSize: parseInt(env.MAX_PAYLOAD_SIZE || '52428800', 10), // 50MB

  // Request logging
  requestLogging: env.REQUEST_LOGGING === 'true' || env.REQUEST_LOGGING === '1',

  // Instance identity
  instanceId: env.INSTANCE_ID || `${os.hostname()}-${Math.random().toString(36).slice(2, 8)}`,
};
