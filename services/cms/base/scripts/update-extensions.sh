#!/bin/bash
# =============================================================================
# Update All Extensions (Comprehensive)
# =============================================================================
# Updates ALL extension dependencies:
#   1. NPM extensions (extensions/package.json)
#   2. Local extension dependencies (extensions/local/*/package.json)
#
# Usage:
#   ./scripts/update-extensions.sh              # Update everything (with prompts)
#   ./scripts/update-extensions.sh --npm-only   # Only update NPM extensions
#   ./scripts/update-extensions.sh --local-only # Only update local extensions
#   ./scripts/update-extensions.sh -i           # Interactive mode (ncu -i)
#
# Note: This updates dependencies, not the Directus version.
# Use ./scripts/update-directus.sh to update Directus.
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

# Check if npm-check-updates is installed
check_ncu() {
    if ! command -v ncu &> /dev/null; then
        echo -e "${YELLOW}npm-check-updates is not installed.${NC}"
        echo ""
        read -p "Install it now? (y/N) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            npm install -g npm-check-updates
        else
            echo "Cannot continue without npm-check-updates."
            exit 1
        fi
    fi
}

# Update NPM extensions
update_npm_extensions() {
    echo -e "${BLUE}Updating NPM Extensions (extensions/package.json)${NC}"
    echo -e "${BLUE}──────────────────────────────────────────────────${NC}"
    echo ""

    cd "$PROJECT_ROOT/extensions"

    # Show what will be updated
    echo "Checking for updates..."
    ncu --packageFile package.json

    echo ""
    read -p "Update these packages? (y/N) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo "Updating packages..."
        ncu -u --packageFile package.json

        echo ""
        echo "Running npm install..."
        npm install

        echo ""
        echo -e "${GREEN}✓ NPM extensions updated${NC}"
    else
        echo "Skipped NPM extensions update."
    fi

    echo ""
}

# Update local extension dependencies
update_local_extensions() {
    echo -e "${BLUE}Updating Local Extensions (extensions/local/*)${NC}"
    echo -e "${BLUE}────────────────────────────────────────────────${NC}"
    echo ""

    # Collect all local extension directories (base + project)
    local LOCAL_EXT_DIRS=""
    if [ "$PROJECT_ROOT" != "$BASE_DIR" ] && [ -d "$BASE_DIR/extensions/local" ]; then
        LOCAL_EXT_DIRS="$BASE_DIR/extensions/local"
    fi
    if [ -d "$PROJECT_ROOT/extensions/local" ]; then
        LOCAL_EXT_DIRS="$LOCAL_EXT_DIRS $PROJECT_ROOT/extensions/local"
    fi

    if [ -z "$LOCAL_EXT_DIRS" ]; then
        echo "No local extensions directory found."
        return
    fi

    local found_extensions=false

    for LOCAL_EXT_DIR in $LOCAL_EXT_DIRS; do
    for ext_dir in "$LOCAL_EXT_DIR"/*/; do
        if [ -f "$ext_dir/package.json" ]; then
            found_extensions=true
            ext_name=$(basename "$ext_dir")

            echo -e "${CYAN}$ext_name:${NC}"
            echo ""

            cd "$ext_dir"

            # Show current SDK version
            SDK_VERSION=$(grep -o '"@directus/extensions-sdk": *"[^"]*"' package.json 2>/dev/null | grep -o '"[0-9^~]*[^"]*"$' | tr -d '"' || echo "not found")
            if [ "$SDK_VERSION" != "not found" ]; then
                LATEST_SDK=$(npm view @directus/extensions-sdk version 2>/dev/null || echo "unknown")
                echo "  Current SDK: $SDK_VERSION"
                echo "  Latest SDK:  $LATEST_SDK"
                echo ""
            fi

            # Show available updates
            echo "  Checking for updates..."
            NCU_OUTPUT=$(ncu --packageFile package.json 2>/dev/null || true)

            if echo "$NCU_OUTPUT" | grep -q "All dependencies match"; then
                echo -e "  ${GREEN}✓ Already up to date${NC}"
            else
                echo "$NCU_OUTPUT" | sed 's/^/  /'
                echo ""
                read -p "  Update $ext_name? (y/N) " -n 1 -r
                echo ""

                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    echo ""
                    echo "  Updating..."
                    ncu -u --packageFile package.json

                    echo ""
                    echo "  Running npm install..."
                    npm install

                    # Rebuild the extension
                    echo ""
                    echo "  Rebuilding extension..."
                    npm run build 2>/dev/null || npx directus-extension build

                    echo ""
                    echo -e "  ${GREEN}✓ $ext_name updated and rebuilt${NC}"
                else
                    echo "  Skipped."
                fi
            fi

            echo ""
        fi
    done
    done

    if [ "$found_extensions" = false ]; then
        echo "No local extensions found."
    fi

    echo ""
}

# Interactive mode
interactive_mode() {
    echo -e "${BLUE}Interactive Update Mode${NC}"
    echo -e "${BLUE}───────────────────────${NC}"
    echo ""

    cd "$PROJECT_ROOT/extensions"

    echo "Select packages to update interactively:"
    echo ""
    ncu -i --packageFile package.json

    echo ""
    echo "Running npm install..."
    npm install

    echo ""
    echo -e "${GREEN}✓ Interactive update complete${NC}"
    echo ""
}

# Main script
echo ""
echo -e "${BOLD}=========================================="
echo "  Update Extensions"
echo -e "==========================================${NC}"
echo ""

check_ncu

case "${1:-}" in
    --npm-only)
        update_npm_extensions
        ;;
    --local-only)
        update_local_extensions
        ;;
    -i|--interactive)
        interactive_mode
        ;;
    *)
        # Update everything
        update_npm_extensions
        update_local_extensions
        ;;
esac

echo -e "${BOLD}=========================================="
echo "  Update Complete"
echo -e "==========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff extensions/"
echo "  2. Rebuild Docker: make dev"
echo "  3. Test the application"
echo "  4. Commit: git add extensions/ && git commit -m 'Update extensions'"
echo ""
