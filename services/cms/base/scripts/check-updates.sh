#!/bin/bash
# =============================================================================
# Check for Available Updates (Comprehensive)
# =============================================================================
# Checks ALL components for updates:
#   1. Directus base image version
#   2. NPM extensions (extensions/package.json)
#   3. Local extension dependencies (extensions/local/*/package.json)
#
# Usage: ./scripts/check-updates.sh
#
# Note: Directus version and extensions are interdependent. Always check
# extension compatibility before updating Directus.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
# Detect if running as submodule - use superproject root, otherwise base dir
PROJECT_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-superproject-working-tree 2>/dev/null)"
if [ -z "$PROJECT_ROOT" ]; then
    PROJECT_ROOT="$BASE_DIR"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Load NPM_TOKEN from .env if it exists
if [ -f "$PROJECT_ROOT/.env" ]; then
    export NPM_TOKEN=$(grep NPM_TOKEN "$PROJECT_ROOT/.env" 2>/dev/null | cut -d '=' -f2)
fi

echo ""
echo -e "${BOLD}=========================================="
echo "  Comprehensive Update Check"
echo -e "==========================================${NC}"
echo ""

# Track if updates are available
UPDATES_AVAILABLE=false

# -----------------------------------------------------------------------------
# 1. Check Directus Version
# -----------------------------------------------------------------------------
echo -e "${BLUE}[1/3] Directus Base Image${NC}"
echo -e "${BLUE}─────────────────────────${NC}"
echo ""

# Get current version from DIRECTUS_VERSION file
CURRENT_DIRECTUS=$(cat "$PROJECT_ROOT/DIRECTUS_VERSION" | tr -d '\n')

# Get latest version from npm
LATEST_DIRECTUS=$(npm view directus version 2>/dev/null || echo "unknown")

# Get recent versions for reference
RECENT_VERSIONS=$(npm view directus versions --json 2>/dev/null | grep -E '"11\.' | tail -5 | tr -d '[]",' | xargs)

echo "  Current:  $CURRENT_DIRECTUS"
echo "  Latest:   $LATEST_DIRECTUS"
echo "  Recent:   $RECENT_VERSIONS"
echo ""

if [ "$CURRENT_DIRECTUS" != "$LATEST_DIRECTUS" ] && [ "$LATEST_DIRECTUS" != "unknown" ]; then
    echo -e "  ${YELLOW}⚠ Update available: $CURRENT_DIRECTUS → $LATEST_DIRECTUS${NC}"
    echo ""
    echo -e "  ${CYAN}Important:${NC} Check extension compatibility before updating!"
    echo "  - Review changelog: https://github.com/directus/directus/releases"
    echo "  - @coignite extensions may need updates for new Directus versions"
    UPDATES_AVAILABLE=true
else
    echo -e "  ${GREEN}✓ Up to date${NC}"
fi

echo ""

# -----------------------------------------------------------------------------
# 2. Check NPM Extensions
# -----------------------------------------------------------------------------
echo -e "${BLUE}[2/3] NPM Extensions (extensions/package.json)${NC}"
echo -e "${BLUE}───────────────────────────────────────────────${NC}"
echo ""

cd "$PROJECT_ROOT/extensions"

if command -v ncu &> /dev/null; then
    # Use npm-check-updates for better output
    NCU_OUTPUT=$(ncu --packageFile package.json 2>/dev/null || true)

    if echo "$NCU_OUTPUT" | grep -q "All dependencies match"; then
        echo -e "  ${GREEN}✓ All packages up to date${NC}"
    else
        echo "$NCU_OUTPUT" | sed 's/^/  /'
        UPDATES_AVAILABLE=true
    fi
else
    # Fallback to npm outdated
    echo "  Using npm outdated (install npm-check-updates for better output)"
    echo ""
    OUTDATED=$(npm outdated 2>/dev/null || true)
    if [ -z "$OUTDATED" ]; then
        echo -e "  ${GREEN}✓ All packages up to date${NC}"
    else
        echo "$OUTDATED" | sed 's/^/  /'
        UPDATES_AVAILABLE=true
    fi
fi

echo ""

# -----------------------------------------------------------------------------
# 3. Check Local Extension Dependencies
# -----------------------------------------------------------------------------
echo -e "${BLUE}[3/3] Local Extensions (extensions/local/*)${NC}"
echo -e "${BLUE}─────────────────────────────────────────────${NC}"
echo ""

# Collect all local extension directories (base + project)
LOCAL_EXT_DIRS=""
if [ "$PROJECT_ROOT" != "$BASE_DIR" ] && [ -d "$BASE_DIR/extensions/local" ]; then
    LOCAL_EXT_DIRS="$BASE_DIR/extensions/local"
fi
if [ -d "$PROJECT_ROOT/extensions/local" ]; then
    LOCAL_EXT_DIRS="$LOCAL_EXT_DIRS $PROJECT_ROOT/extensions/local"
fi
LOCAL_UPDATES=false

for LOCAL_EXT_DIR in $LOCAL_EXT_DIRS; do
    for ext_dir in "$LOCAL_EXT_DIR"/*/; do
        if [ -f "$ext_dir/package.json" ]; then
            ext_name=$(basename "$ext_dir")
            echo -e "  ${CYAN}$ext_name:${NC}"

            cd "$ext_dir"

            # Check @directus/extensions-sdk version specifically
            SDK_VERSION=$(grep -o '"@directus/extensions-sdk": *"[^"]*"' package.json 2>/dev/null | grep -o '"[0-9^~]*[^"]*"$' | tr -d '"' || echo "not found")

            if [ "$SDK_VERSION" != "not found" ]; then
                LATEST_SDK=$(npm view @directus/extensions-sdk version 2>/dev/null || echo "unknown")
                echo "    SDK: $SDK_VERSION (latest: $LATEST_SDK)"

                # Check if SDK version is compatible with Directus version
                if [ "$SDK_VERSION" != "$LATEST_SDK" ] && [ "$LATEST_SDK" != "unknown" ]; then
                    echo -e "    ${YELLOW}⚠ SDK may need update${NC}"
                    LOCAL_UPDATES=true
                    UPDATES_AVAILABLE=true
                fi
            fi

            # Check for other outdated packages
            if command -v ncu &> /dev/null; then
                OTHER_UPDATES=$(ncu --packageFile package.json 2>/dev/null | grep -v "All dependencies" | grep -v "^$" | head -5 || true)
                if [ -n "$OTHER_UPDATES" ]; then
                    echo "$OTHER_UPDATES" | sed 's/^/    /'
                    LOCAL_UPDATES=true
                    UPDATES_AVAILABLE=true
                fi
            fi

            echo ""
        fi
    done
done

if [ -z "$LOCAL_EXT_DIRS" ]; then
    echo "  No local extensions found"
    echo ""
elif [ "$LOCAL_UPDATES" = false ]; then
    echo -e "  ${GREEN}✓ All local extensions up to date${NC}"
    echo ""
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo -e "${BOLD}=========================================="
echo "  Summary"
echo -e "==========================================${NC}"
echo ""

if [ "$UPDATES_AVAILABLE" = true ]; then
    echo -e "  ${YELLOW}Updates are available!${NC}"
    echo ""
    echo "  Recommended update order:"
    echo "    1. Update @coignite extensions first (contact maintainers if needed)"
    echo "    2. Update local extension dependencies"
    echo "    3. Update Directus version last (after extensions are compatible)"
    echo ""
    # Determine script path prefix for commands
    if [ "$PROJECT_ROOT" != "$BASE_DIR" ]; then
        CMD_PREFIX="./base/scripts"
    else
        CMD_PREFIX="./scripts"
    fi
    echo "  Commands:"
    echo "    $CMD_PREFIX/update-extensions.sh          # Update all extensions"
    echo "    $CMD_PREFIX/update-directus.sh VERSION    # Update Directus"
    echo ""
else
    echo -e "  ${GREEN}✓ Everything is up to date!${NC}"
    echo ""
fi
