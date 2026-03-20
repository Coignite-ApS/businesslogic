/**
 * Sentry Preload Script
 *
 * Loaded via --require before Directus starts.
 * This ensures Sentry instruments Express, HTTP, etc. before they're loaded.
 */
const _t = (msg) => console.log(`[Sentry Preload] [${new Date().toISOString()}] ${msg}`);
_t('Loading modules...');
const fs = require('fs');
const path = require('path');

// Find package via Node's module resolution (works with any node_modules layout)
function findPnpmPackage(packageName) {
  try {
    const resolved = require.resolve(packageName);
    // Return the package root dir (walk up from resolved entry point)
    const nodeModulesIdx = resolved.lastIndexOf(`node_modules/${packageName}`);
    if (nodeModulesIdx !== -1) {
      return resolved.substring(0, nodeModulesIdx + `node_modules/${packageName}`.length);
    }
    // Fallback: resolve package.json location
    const pkgJson = require.resolve(`${packageName}/package.json`);
    return path.dirname(pkgJson);
  } catch (e) {
    return null;
  }
}

let Sentry, nodeProfilingIntegration;
try {
  // Try pnpm paths first
  const sentryPath = findPnpmPackage('@sentry/node');
  const profilingPath = findPnpmPackage('@sentry/profiling-node');
  _t('Resolved paths: sentry=' + (sentryPath ? 'found' : 'not found') + ', profiling=' + (profilingPath ? 'found' : 'not found'));

  _t('Loading @sentry/node...');
  if (sentryPath && fs.existsSync(sentryPath)) {
    Sentry = require(sentryPath);
  } else {
    Sentry = require('@sentry/node');
  }
  _t('@sentry/node loaded');

  _t('Loading @sentry/profiling-node...');
  if (profilingPath && fs.existsSync(profilingPath)) {
    nodeProfilingIntegration = require(profilingPath).nodeProfilingIntegration;
  } else {
    nodeProfilingIntegration = require('@sentry/profiling-node').nodeProfilingIntegration;
  }
  _t('@sentry/profiling-node loaded');
} catch (e) {
  console.error('[Sentry Preload] Failed to load Sentry:', e.message);
  process.exit(0); // Don't block startup
}

const dsn = process.env.DE_SENTRY_DSN;

if (!dsn) {
  console.log('[Sentry Preload] Skipped - DE_SENTRY_DSN not set');
} else {
  const tracesSampleRate = parseFloat(process.env.DE_SENTRY_TRACES_SAMPLE_RATE || '0');
  const profilesSampleRate = parseFloat(process.env.DE_SENTRY_PROFILES_SAMPLE_RATE || '0');
  const environment = process.env.ENV || process.env.NODE_ENV || 'development';
  const debugLogger = process.env.DE_SENTRY_LOGGER === 'true';
  const logsLevel = process.env.DE_SENTRY_LOGS_LEVEL || '';
  const profilingEnabled = process.env.DE_SENTRY_PROFILING_ENABLED === 'true';

  const integrations = [
    ...(profilingEnabled ? [nodeProfilingIntegration()] : []),
    Sentry.httpIntegration(),
    Sentry.expressIntegration(),
    Sentry.postgresIntegration(),
    Sentry.redisIntegration(),
  ];

  // Pino integration (Sentry SDK v10+)
  if (typeof Sentry.pinoIntegration === 'function') {
    integrations.push(Sentry.pinoIntegration({
      levels: ['warn', 'error', 'fatal'],
    }));
  }

  if (logsLevel) {
    const levels = logsLevel.split(',').map(l => l.trim()).filter(Boolean);
    if (levels.length) {
      integrations.push(Sentry.captureConsoleIntegration({ levels }));
    }
  }

  _t('Calling Sentry.init()...');
  Sentry.init({
    dsn,
    environment,
    release: process.env.PROJECT_VERSION || undefined,
    debug: debugLogger,
    integrations,
    tracesSampleRate,
    profilesSampleRate: profilingEnabled ? profilesSampleRate : 0,
    ignoreErrors: ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'socket hang up'],
  });

  // Set version tags
  Sentry.setTag('directus_version', process.env.DIRECTUS_VERSION || 'unknown');
  Sentry.setTag('project_version', process.env.PROJECT_VERSION || 'unknown');
  Sentry.setTag('node_version', process.version);

  _t('Sentry.init() complete');

  // Mark as preloaded so extension doesn't re-init
  process.env.SENTRY_PRELOADED = '1';

  console.log(`[Sentry Preload] Initialized (env=${environment}, traces=${tracesSampleRate}, profiles=${profilingEnabled ? profilesSampleRate : 0})`);
  _t('Preload done, handing off to Directus...');
}
