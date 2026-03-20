#!/bin/sh
# =============================================================================
# Reset Redis Cache
# =============================================================================
# Resets the Directus schema cache lock in Redis.
# Use this when Directus gets stuck with "schemaCache--preparing" lock.
#
# Usage:
#   ./scripts/reset-cache.sh           # Auto-detect environment
#   ./scripts/reset-cache.sh local     # Force local mode (docker)
#   ./scripts/reset-cache.sh prod      # Force production mode (uses $REDIS)
#
# On production server (App Platform), REDIS env var is already set,
# so just run: ./scripts/reset-cache.sh
# =============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "=========================================="
echo "  Reset Redis Schema Cache"
echo "=========================================="
echo ""

# Determine mode
MODE="${1:-auto}"

if [ "$MODE" = "auto" ]; then
    # Auto-detect: if REDIS is set, we're in production
    if [ -n "$REDIS" ]; then
        MODE="prod"
        echo -e "${BLUE}Auto-detected: Production environment${NC}"
    elif docker compose ps redis 2>/dev/null | grep -q "running"; then
        MODE="local"
        echo -e "${BLUE}Auto-detected: Local development${NC}"
    else
        echo -e "${RED}Could not auto-detect environment.${NC}"
        echo ""
        echo "Please specify:"
        echo "  ./scripts/reset-cache.sh local   # For local Docker development"
        echo "  ./scripts/reset-cache.sh prod    # For production (requires REDIS env var)"
        exit 1
    fi
fi

echo ""

case "$MODE" in
    local)
        echo -e "${BLUE}Resetting local Redis cache...${NC}"
        echo ""

        # Check if redis container is running
        if ! docker compose ps redis 2>/dev/null | grep -q "running"; then
            echo -e "${RED}Error: Redis container is not running${NC}"
            echo "Start the development environment first: ./dev.sh"
            exit 1
        fi

        # Clear the schema cache lock
        echo "Clearing schema cache lock..."
        docker compose exec redis redis-cli DEL "directus:lock:schemaCache--preparing"

        # Also clear the schema cache itself
        echo "Clearing schema cache..."
        docker compose exec redis redis-cli KEYS "directus:schema*" | xargs -r docker compose exec redis redis-cli DEL 2>/dev/null || true

        echo ""
        echo -e "${GREEN}✓ Local Redis cache cleared${NC}"
        echo ""
        echo "Restarting Directus..."
        docker compose restart directus

        echo ""
        echo -e "${GREEN}✓ Done! Directus is restarting.${NC}"
        ;;

    prod|production)
        echo -e "${BLUE}Resetting production Redis cache...${NC}"
        echo ""

        if [ -z "$REDIS" ]; then
            echo -e "${RED}Error: REDIS environment variable is not set${NC}"
            echo ""
            echo "This script must be run in an environment with REDIS configured."
            echo "On App Platform, this variable should be set automatically."
            exit 1
        fi

        # Show truncated Redis URL (POSIX compatible)
        REDIS_SHORT=$(echo "$REDIS" | cut -c1-30)
        echo "  Redis URL: ${REDIS_SHORT}..."
        echo ""

        # Clear the schema cache lock and cache using Node.js with ioredis
        # Find ioredis in pnpm's node_modules structure
        IOREDIS_PATH=$(find /directus/node_modules/.pnpm -path "*/ioredis/built/Redis.js" -type f 2>/dev/null | head -1 | sed 's|/built/Redis.js||')

        if [ -z "$IOREDIS_PATH" ]; then
            echo -e "${RED}Error: Could not find ioredis module${NC}"
            exit 1
        fi

        echo "Clearing schema cache lock and cache..."
        NODE_PATH="$IOREDIS_PATH/.." node -e "
const Redis = require('ioredis');

const redisUrl = process.env.REDIS;
const options = redisUrl.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {};
const redis = new Redis(redisUrl, options);

async function clearCache() {
    try {
        // Clear the schema cache lock
        const lockResult = await redis.del('directus:lock:schemaCache--preparing');
        console.log('  Lock key deleted:', lockResult > 0 ? 'yes' : 'no (not found)');

        // Find and clear all schema cache keys
        const keys = await redis.keys('directus:schema*');
        if (keys.length > 0) {
            const cacheResult = await redis.del(...keys);
            console.log('  Schema cache keys deleted:', cacheResult);
        } else {
            console.log('  Schema cache keys deleted: 0 (none found)');
        }

        // Also clear the main cache namespace
        const cacheKeys = await redis.keys('directus:cache:*');
        if (cacheKeys.length > 0) {
            const mainCacheResult = await redis.del(...cacheKeys);
            console.log('  Main cache keys deleted:', mainCacheResult);
        }

        await redis.quit();
        console.log('');
        console.log('✓ Redis cache cleared successfully');
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

clearCache();
"

        echo ""
        echo -e "${GREEN}✓ Production Redis cache cleared${NC}"
        echo ""
        echo -e "${YELLOW}Note: You may need to restart the Directus service for changes to take effect.${NC}"
        ;;

    *)
        echo -e "${RED}Unknown mode: $MODE${NC}"
        echo ""
        echo "Usage:"
        echo "  ./scripts/reset-cache.sh           # Auto-detect environment"
        echo "  ./scripts/reset-cache.sh local     # Force local mode"
        echo "  ./scripts/reset-cache.sh prod      # Force production mode"
        exit 1
        ;;
esac

echo ""
