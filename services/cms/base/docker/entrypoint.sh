#!/bin/sh
# =============================================================================
# Directus Entrypoint with Memory Diagnostics and Auto-Restart
# =============================================================================
# Features:
# - Shows memory requirements based on installed extensions
# - Warns if system RAM is insufficient
# - Optional auto-restart on high RAM/CPU usage (set MEMORY_STATS_RESTART_ON_RAM/CPU)
#
# Environment Variables for Auto-Restart:
#   MEMORY_STATS_RESTART_ON_RAM=<percent>  - Restart when RAM usage exceeds this %
#   MEMORY_STATS_RESTART_ON_CPU=<percent>  - Restart when CPU usage exceeds this %
#   MEMORY_STATS_CHECK_INTERVAL=<seconds>  - Check interval (default: 60)
#
# Example: MEMORY_STATS_RESTART_ON_RAM=85 will restart if RAM > 85%
# =============================================================================

# Colors
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Cap V8 heap — forces earlier GC, prevents OOM on small instances
# If NODE_OPTIONS is already set (e.g. by Terraform), append heap limit only if missing
if [ -z "$NODE_OPTIONS" ]; then
  export NODE_OPTIONS="--max-old-space-size=1536"
elif ! echo "$NODE_OPTIONS" | grep -q 'max-old-space-size'; then
  export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=1536"
else
  # External heap limit exists — warn if below 1536
  EXTERNAL_HEAP=$(echo "$NODE_OPTIONS" | grep -o 'max-old-space-size=[0-9]*' | cut -d= -f2)
  if [ -n "$EXTERNAL_HEAP" ] && [ "$EXTERNAL_HEAP" -lt 1536 ]; then
    echo -e "${YELLOW}⚠ NODE_OPTIONS has max-old-space-size=${EXTERNAL_HEAP}MB (below recommended 1536MB)${NC}"
  fi
fi

echo ""
echo "=========================================="
echo "  Directus Startup Assessment"
echo "=========================================="
echo ""

# Count extensions
# NPM extensions are in pnpm's .pnpm folder - count unique extension packages
NPM_EXT_COUNT=$(ls -d /directus/node_modules/.pnpm/*directus-extension*/ 2>/dev/null | wc -l | tr -d ' ')
LOCAL_EXT_COUNT=$(find /directus/extensions -maxdepth 2 -name "package.json" 2>/dev/null | wc -l | tr -d ' ')
TOTAL_EXT=$((NPM_EXT_COUNT + LOCAL_EXT_COUNT))

# Calculate required RAM based on measured values:
# - Base Directus: ~200MB peak during startup
# - Per extension: ~12MB
# - Buffer: 50% for GC, queries, concurrent requests
# Formula: (200 + extensions × 12) × 1.5
REQUIRED_RAM=$(( (200 + TOTAL_EXT * 12) * 150 / 100 ))
REQUIRED_RAM_GB=$(awk "BEGIN {printf \"%.1f\", $REQUIRED_RAM/1024}")

# Get system memory
TOTAL_RAM=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo "0")
TOTAL_RAM_GB=$(awk "BEGIN {printf \"%.1f\", $TOTAL_RAM/1024}")

# Extract heap limit from NODE_OPTIONS for display
HEAP_LIMIT=$(echo "$NODE_OPTIONS" | grep -o 'max-old-space-size=[0-9]*' | cut -d= -f2)

echo -e "${CYAN}Extensions:${NC}      $TOTAL_EXT ($NPM_EXT_COUNT npm + $LOCAL_EXT_COUNT local)"
echo -e "${CYAN}Required RAM:${NC}   ${REQUIRED_RAM}MB (~${REQUIRED_RAM_GB}GB)"
if [ "$TOTAL_RAM" -gt 0 ]; then
echo -e "${CYAN}System RAM:${NC}     ${TOTAL_RAM}MB (~${TOTAL_RAM_GB}GB)"
fi
if [ -n "$HEAP_LIMIT" ]; then
echo -e "${CYAN}V8 Heap Limit:${NC}  ${HEAP_LIMIT}MB (NODE_OPTIONS)"
fi
echo ""

# Warning if system RAM is insufficient
if [ "$TOTAL_RAM" -gt 0 ] && [ "$TOTAL_RAM" -lt "$REQUIRED_RAM" ]; then
  echo -e "${RED}⚠ WARNING: System RAM (${TOTAL_RAM}MB) is below required (${REQUIRED_RAM}MB)${NC}"
  echo -e "${RED}  Directus may crash during startup!${NC}"
  echo -e "${RED}  → Increase instance to at least ${REQUIRED_RAM_GB}GB RAM${NC}"
  echo -e "${RED}  → Or reduce number of extensions${NC}"
  echo ""
elif [ "$TOTAL_RAM" -gt 0 ]; then
  HEADROOM=$((TOTAL_RAM - REQUIRED_RAM))
  echo -e "${GREEN}✓ Memory OK${NC} (${HEADROOM}MB headroom)"
  echo ""
fi

echo "=========================================="
echo "  Clearing Redis Cache Lock..."
echo "=========================================="

# Clear schemaCache lock to prevent startup loop after crash
# This was previously done via: npm run reset-cache
if [ -n "$REDIS" ]; then
  REDIS_DB="${REDIS_DB_NR:-0}"

  # Find ioredis via Node's module resolution (fast), fallback to glob
  IOREDIS_PATH=$(node -e "try{console.log(require.resolve('ioredis').replace(/\/built\/.*$/,''))}catch(e){}" 2>/dev/null)
  if [ -z "$IOREDIS_PATH" ]; then
    IOREDIS_PATH=$(ls -d /directus/node_modules/.pnpm/ioredis@*/node_modules/ioredis 2>/dev/null | head -1)
  fi

  if [ -n "$IOREDIS_PATH" ]; then
    timeout 15 env NODE_PATH="$IOREDIS_PATH/.." node -e "
const Redis = require('ioredis');
const redisUrl = process.env.REDIS;
const db = parseInt(process.env.REDIS_DB_NR || '0', 10);
const options = redisUrl.startsWith('rediss://') ? { tls: { rejectUnauthorized: false }, db, connectTimeout: 5000, maxRetriesPerRequest: 0, retryStrategy: () => null } : { db, connectTimeout: 5000, maxRetriesPerRequest: 0, retryStrategy: () => null };
const redis = new Redis(redisUrl, options);
redis.on('error', err => {
  console.log('  WARNING: Redis connection failed - ' + err.message);
  console.log('  → If ETIMEDOUT: check that this App Platform instance is added to Redis trusted sources');
  redis.disconnect();
});

redis.del('directus:lock:schemaCache--preparing')
  .then(result => {
    console.log('  Lock cleared: ' + (result > 0 ? 'yes' : 'not present'));
    return redis.quit();
  })
  .catch(err => {
    console.log('  Warning: Could not clear lock - ' + err.message);
    process.exit(0); // Don't fail startup
  });
"
    REDIS_EXIT=$?
    if [ "$REDIS_EXIT" -eq 124 ]; then
      echo -e "  ${YELLOW}⚠ Redis operation timed out after 15s${NC}"
    elif [ "$REDIS_EXIT" -ne 0 ]; then
      echo "  Warning: Could not connect to Redis (exit $REDIS_EXIT)"
    fi
  else
    echo "  Warning: ioredis not found, skipping cache clear"
  fi
else
  echo "  Skipped (no REDIS configured)"
fi

echo ""
echo "=========================================="
echo "  Checking Database Connection..."
echo "=========================================="

# Quick connectivity check before bootstrap (which gives unhelpful Knex pool errors)
# Print DB config for debugging (mask password)
DB_PASS_MASKED=$(echo "${DB_PASSWORD:-}" | sed 's/./*/g')
echo "  DB_HOST:       ${DB_HOST:-<not set>}"
echo "  DB_PORT:       ${DB_PORT:-<not set> (default 5432)}"
echo "  DB_DATABASE:   ${DB_DATABASE:-<not set>}"
echo "  DB_USER:       ${DB_USER:-<not set>}"
echo "  DB_PASSWORD:   ${DB_PASS_MASKED:-<not set>}"
if [ -n "$DB_SSL__CA" ]; then
  echo "  DB_SSL__CA:    ************************"
else
  echo "  DB_SSL__CA:    <not set>"
fi
echo "  DB_SSL__REJECT_UNAUTHORIZED: ${DB_SSL__REJECT_UNAUTHORIZED:-<not set>}"
if [ -n "$DB_CONNECTION_STRING" ]; then
  echo "  DB_CONNECTION_STRING: $(echo "$DB_CONNECTION_STRING" | sed 's|://[^@]*@|://***:***@|')"
fi
echo ""
if [ -n "$DB_HOST" ] || [ -n "$DB_CONNECTION_STRING" ]; then
  # Find pg module in pnpm structure
  PG_PATH=$(node -e "try{console.log(require.resolve('pg').replace(/\/lib\/.*$/,''))}catch(e){}" 2>/dev/null)
  if [ -z "$PG_PATH" ]; then
    PG_PATH=$(ls -d /directus/node_modules/.pnpm/pg@*/node_modules/pg 2>/dev/null | head -1)
  fi

  if [ -z "$PG_PATH" ]; then
    echo "  Warning: pg module not found, skipping connection test"
  else
  # Real Postgres connection test using pg module
  timeout 15 env NODE_PATH="$PG_PATH/.." node -e "
const { Client } = require('pg');

const ssl = process.env.DB_SSL__CA
  ? { ca: process.env.DB_SSL__CA, rejectUnauthorized: process.env.DB_SSL__REJECT_UNAUTHORIZED !== 'false' }
  : (process.env.DB_SSL__REJECT_UNAUTHORIZED
    ? { rejectUnauthorized: process.env.DB_SSL__REJECT_UNAUTHORIZED !== 'false' }
    : false);

const config = process.env.DB_CONNECTION_STRING
  ? { connectionString: process.env.DB_CONNECTION_STRING, ssl, connectionTimeoutMillis: 10000 }
  : {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl,
      connectionTimeoutMillis: 10000,
    };

console.log('  SSL config: ' + (ssl ? JSON.stringify({ ...ssl, ca: ssl.ca ? '(certificate)' : undefined }) : 'disabled'));

const client = new Client(config);
client.connect()
  .then(() => client.query('SELECT version()'))
  .then(res => {
    console.log('  ✓ Connected: ' + res.rows[0].version.split(' ').slice(0, 2).join(' '));
    return client.end();
  })
  .catch(err => {
    console.error('  ✗ Connection failed!');
    console.error('  Error: ' + err.message);
    if (err.code) console.error('  Code:  ' + err.code);
    if (err.message.includes('ECONNREFUSED')) console.error('  → Port is closed or service not running');
    if (err.message.includes('ETIMEDOUT')) console.error('  → Packets dropped — check firewall / trusted sources');
    if (err.message.includes('ENOTFOUND')) console.error('  → DNS resolution failed — check DB_HOST');
    if (err.message.includes('self signed') || err.message.includes('certificate')) console.error('  → SSL certificate issue — check DB_SSL__CA');
    if (err.message.includes('authentication')) console.error('  → Check DB_USER / DB_PASSWORD');
    if (err.message.includes('does not exist')) console.error('  → Check DB_DATABASE name');
    process.exit(1);
  });
" 2>&1
  DB_CHECK_EXIT=$?
  if [ "$DB_CHECK_EXIT" -eq 124 ]; then
    echo -e "  ${RED}✗ Connection timed out (15s) — packets likely dropped by firewall${NC}"
    echo -e "  ${RED}  → On DigitalOcean: ensure app is in database trusted sources${NC}"
  elif [ "$DB_CHECK_EXIT" -ne 0 ]; then
    echo -e "  ${RED}  → On DigitalOcean: ensure app is in database trusted sources${NC}"
  fi
  fi
else
  echo -e "  ${RED}⚠ WARNING: No DB_HOST or DB_CONNECTION_STRING set${NC}"
fi

echo ""
echo "=========================================="
echo "  Running Database Bootstrap..."
echo "=========================================="
BOOTSTRAP_TIMEOUT="${BOOTSTRAP_TIMEOUT:-60}"

# Background dot-printer for liveness visibility
(while true; do printf "."; sleep 5; done) &
DOT_PID=$!

timeout "$BOOTSTRAP_TIMEOUT" node /directus/cli.js bootstrap
BOOTSTRAP_EXIT=$?

# Stop dot-printer
kill $DOT_PID 2>/dev/null
wait $DOT_PID 2>/dev/null
echo ""

if [ "$BOOTSTRAP_EXIT" -eq 124 ]; then
  echo -e "  ${RED}ERROR: Bootstrap timed out after ${BOOTSTRAP_TIMEOUT}s!${NC}"
  echo -e "  ${RED}  → Database is likely unreachable (hung connection)${NC}"
  echo -e "  ${RED}  → On DigitalOcean: ensure app is in database trusted sources${NC}"
  exit 1
elif [ "$BOOTSTRAP_EXIT" -ne 0 ]; then
  echo -e "  ${RED}ERROR: Bootstrap failed! (exit code: $BOOTSTRAP_EXIT)${NC}"
  echo -e "  ${RED}  → If 'pool is probably full': database is unreachable (check trusted sources)${NC}"
  echo -e "  ${RED}  → If 'authentication failed': check DB_USER/DB_PASSWORD${NC}"
  echo -e "  ${RED}  → If 'does not exist': check DB_DATABASE name${NC}"
  exit 1
fi
echo "  Bootstrap complete."
echo ""
echo "=========================================="
echo "  Starting Directus..."
echo "=========================================="
echo ""

# Start background process for memory monitoring and optional auto-restart
(
  # Wait for Directus to start (check health endpoint)
  for i in $(seq 1 60); do
    sleep 2
    if wget -q --spider http://localhost:8055/server/health 2>/dev/null; then
      sleep 3  # Let it stabilize

      # Get memory stats
      RSS_KB=$(cat /proc/1/status 2>/dev/null | grep VmRSS | awk '{print $2}')
      HWM_KB=$(cat /proc/1/status 2>/dev/null | grep VmHWM | awk '{print $2}')

      if [ -n "$RSS_KB" ] && [ -n "$HWM_KB" ]; then
        RSS_MB=$((RSS_KB / 1024))
        HWM_MB=$((HWM_KB / 1024))

        echo ""
        echo "=========================================="
        echo -e "  ${CYAN}Memory Usage (after startup)${NC}"
        echo "=========================================="
        echo "  Startup peak:   ${HWM_MB}MB"
        echo "  Current:        ${RSS_MB}MB"
        echo "=========================================="
        echo ""
      fi
      break
    fi
  done

  # =========================================================================
  # Resource Monitor with Optional Auto-Restart
  # =========================================================================
  # Only runs if MEMORY_STATS_RESTART_ON_RAM or MEMORY_STATS_RESTART_ON_CPU is set

  RAM_THRESHOLD="${MEMORY_STATS_RESTART_ON_RAM:-}"
  CPU_THRESHOLD="${MEMORY_STATS_RESTART_ON_CPU:-}"
  CHECK_INTERVAL="${MEMORY_STATS_CHECK_INTERVAL:-60}"

  if [ -n "$RAM_THRESHOLD" ] || [ -n "$CPU_THRESHOLD" ]; then
    echo "=========================================="
    echo -e "  ${CYAN}Resource Monitor Active${NC}"
    echo "=========================================="
    [ -n "$RAM_THRESHOLD" ] && echo "  RAM threshold:  ${RAM_THRESHOLD}%"
    [ -n "$CPU_THRESHOLD" ] && echo "  CPU threshold:  ${CPU_THRESHOLD}%"
    echo "  Check interval: ${CHECK_INTERVAL}s"
    echo "=========================================="
    echo ""

    # Track CPU for delta calculation
    PREV_IDLE=0
    PREV_TOTAL=0
    CONSECUTIVE_HIGH=0
    REQUIRED_CONSECUTIVE=3  # Require 3 consecutive high readings before restart

    while true; do
      sleep "$CHECK_INTERVAL"

      SHOULD_RESTART=false
      RESTART_REASON=""

      # Check RAM usage
      if [ -n "$RAM_THRESHOLD" ]; then
        MEM_TOTAL=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo "0")
        MEM_AVAIL=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || echo "0")

        if [ "$MEM_TOTAL" -gt 0 ]; then
          MEM_USED=$((MEM_TOTAL - MEM_AVAIL))
          RAM_PERCENT=$((MEM_USED * 100 / MEM_TOTAL))

          if [ "$RAM_PERCENT" -ge "$RAM_THRESHOLD" ]; then
            RESTART_REASON="RAM usage ${RAM_PERCENT}% >= ${RAM_THRESHOLD}%"
            SHOULD_RESTART=true
          fi
        fi
      fi

      # Check CPU usage (requires 2 readings to calculate delta)
      if [ -n "$CPU_THRESHOLD" ]; then
        CPU_LINE=$(head -1 /proc/stat 2>/dev/null | awk '{print $2,$3,$4,$5,$6,$7,$8}')

        if [ -n "$CPU_LINE" ]; then
          set -- $CPU_LINE
          IDLE=$4
          TOTAL=$(($1 + $2 + $3 + $4 + $5 + $6 + $7))

          if [ "$PREV_TOTAL" -gt 0 ]; then
            IDLE_DELTA=$((IDLE - PREV_IDLE))
            TOTAL_DELTA=$((TOTAL - PREV_TOTAL))

            if [ "$TOTAL_DELTA" -gt 0 ]; then
              CPU_PERCENT=$(( (TOTAL_DELTA - IDLE_DELTA) * 100 / TOTAL_DELTA ))

              if [ "$CPU_PERCENT" -ge "$CPU_THRESHOLD" ]; then
                if [ -z "$RESTART_REASON" ]; then
                  RESTART_REASON="CPU usage ${CPU_PERCENT}% >= ${CPU_THRESHOLD}%"
                else
                  RESTART_REASON="${RESTART_REASON}, CPU ${CPU_PERCENT}%"
                fi
                SHOULD_RESTART=true
              fi
            fi
          fi

          PREV_IDLE=$IDLE
          PREV_TOTAL=$TOTAL
        fi
      fi

      # Handle restart with consecutive check (avoid transient spikes)
      if [ "$SHOULD_RESTART" = true ]; then
        CONSECUTIVE_HIGH=$((CONSECUTIVE_HIGH + 1))
        echo -e "${YELLOW}[Resource Monitor] Warning: ${RESTART_REASON} (${CONSECUTIVE_HIGH}/${REQUIRED_CONSECUTIVE})${NC}"

        if [ "$CONSECUTIVE_HIGH" -ge "$REQUIRED_CONSECUTIVE" ]; then
          echo -e "${RED}[Resource Monitor] Threshold exceeded ${REQUIRED_CONSECUTIVE} times - triggering restart${NC}"
          echo "[Resource Monitor] Reason: ${RESTART_REASON}"

          # Graceful shutdown - send SIGTERM to main process
          # The container orchestrator will restart it
          kill -TERM 1
          exit 0
        fi
      else
        # Reset counter on good reading
        if [ "$CONSECUTIVE_HIGH" -gt 0 ]; then
          echo -e "${GREEN}[Resource Monitor] Resources normalized${NC}"
        fi
        CONSECUTIVE_HIGH=0
      fi
    done
  fi
) &

# Execute Directus with Sentry preload
# Using --require for CJS preload to instrument Express/HTTP before Directus loads them

# Read Sentry config from YAML file if not already in env
if [ -z "$DE_SENTRY_DSN" ] && [ -n "$CONFIG_PATH" ] && [ -f "$CONFIG_PATH" ]; then
  SENTRY_DSN_FROM_CONFIG=$(grep "DE_SENTRY_DSN:" "$CONFIG_PATH" 2>/dev/null | head -1 | sed "s/.*DE_SENTRY_DSN:[[:space:]]*['\"]*//" | sed "s/['\"].*//")
  if [ -n "$SENTRY_DSN_FROM_CONFIG" ]; then
    export DE_SENTRY_DSN="$SENTRY_DSN_FROM_CONFIG"
    export DE_SENTRY_TRACES_SAMPLE_RATE=$(grep "DE_SENTRY_TRACES_SAMPLE_RATE:" "$CONFIG_PATH" 2>/dev/null | head -1 | awk '{print $2}')
    export DE_SENTRY_PROFILES_SAMPLE_RATE=$(grep "DE_SENTRY_PROFILES_SAMPLE_RATE:" "$CONFIG_PATH" 2>/dev/null | head -1 | awk '{print $2}')
    export DE_SENTRY_PROFILING_ENABLED=$(grep "DE_SENTRY_PROFILING_ENABLED:" "$CONFIG_PATH" 2>/dev/null | head -1 | awk '{print $2}' | tr -d "'\"")
    export DE_SENTRY_LOGGER=$(grep "DE_SENTRY_LOGGER:" "$CONFIG_PATH" 2>/dev/null | head -1 | awk '{print $2}' | tr -d "'\"")
    export DE_SENTRY_LOGS_LEVEL=$(grep "DE_SENTRY_LOGS_LEVEL:" "$CONFIG_PATH" 2>/dev/null | head -1 | awk '{print $2}' | tr -d "'\"")
    # Also export ENV for Sentry environment tag
    ENV_FROM_CONFIG=$(grep "^ENV:" "$CONFIG_PATH" 2>/dev/null | head -1 | sed "s/.*ENV:[[:space:]]*['\"]*//" | sed "s/['\"].*//")
    [ -n "$ENV_FROM_CONFIG" ] && export ENV="$ENV_FROM_CONFIG"
  fi
fi

# Export versions for Sentry tagging
export DIRECTUS_VERSION=$(node -p "require('directus/package.json').version" 2>/dev/null || echo "unknown")
export PROJECT_VERSION=$(cat /directus/PROJECT_VERSION 2>/dev/null || echo "unknown")

if [ -n "$DE_SENTRY_DSN" ] && [ -f "/directus/docker/sentry-preload.cjs" ]; then
  echo "  Sentry preload enabled (DSN from ${CONFIG_PATH:-env})"
  exec node --require /directus/docker/sentry-preload.cjs /directus/cli.js "$@"
else
  exec node /directus/cli.js "$@"
fi
