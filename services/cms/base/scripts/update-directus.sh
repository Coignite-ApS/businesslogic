#!/bin/bash
# =============================================================================
# Update Directus Version
# =============================================================================
# Updates the Directus base image version in Dockerfile
#
# Usage:
#   ./scripts/update-directus.sh           # Shows current and latest version
#   ./scripts/update-directus.sh 11.4.0    # Update to specific version
#   ./scripts/update-directus.sh latest    # Update to latest version
#
# IMPORTANT: Directus version and extensions are interdependent!
# - @coignite extensions may need updates for new Directus versions
# - Local extensions use @directus/extensions-sdk which should match
# - Always test after updating
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
# Detect if running as submodule - use superproject root, otherwise base dir
PROJECT_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-superproject-working-tree 2>/dev/null)"
if [ -z "$PROJECT_ROOT" ]; then
    PROJECT_ROOT="$BASE_DIR"
fi
DIRECTUS_VERSION_FILE="$PROJECT_ROOT/DIRECTUS_VERSION"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "=========================================="
echo "  Update Directus Version"
echo "=========================================="
echo ""

# Get current version from DIRECTUS_VERSION file
CURRENT_VERSION=$(cat "$DIRECTUS_VERSION_FILE" | tr -d '\n')

# Get latest version from npm
LATEST_VERSION=$(npm view directus version 2>/dev/null || echo "unknown")

echo "  Current version: $CURRENT_VERSION"
echo "  Latest version:  $LATEST_VERSION"
echo ""

# Handle arguments
if [ -z "$1" ]; then
    # No argument - just show info
    if [ "$CURRENT_VERSION" != "$LATEST_VERSION" ] && [ "$LATEST_VERSION" != "unknown" ]; then
        echo -e "${YELLOW}Update available!${NC}"
        echo ""
        echo "To update, run:"
        echo "  ./scripts/update-directus.sh $LATEST_VERSION"
        echo ""
        echo "Or to update to latest:"
        echo "  ./scripts/update-directus.sh latest"
    else
        echo -e "${GREEN}✓ Directus is up to date${NC}"
    fi
    exit 0
fi

# Determine target version
if [ "$1" == "latest" ]; then
    if [ "$LATEST_VERSION" == "unknown" ]; then
        echo -e "${RED}Error: Could not determine latest version${NC}"
        exit 1
    fi
    TARGET_VERSION="$LATEST_VERSION"
else
    TARGET_VERSION="$1"
fi

# Validate version format (basic check)
if ! [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Error: Invalid version format '$TARGET_VERSION'${NC}"
    echo "Expected format: X.Y.Z (e.g., 11.4.0)"
    exit 1
fi

# Confirm update
echo "This will update DIRECTUS_VERSION file:"
echo "  $CURRENT_VERSION → $TARGET_VERSION"
echo ""
echo -e "${YELLOW}⚠ Warning: Extension Compatibility${NC}"
echo "  - @coignite extensions may need updates for this Directus version"
echo "  - Local extensions' @directus/extensions-sdk should match"
echo "  - Run ./scripts/check-updates.sh first to see all dependencies"
echo ""
read -p "Continue with update? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Update cancelled."
    exit 0
fi

# Update DIRECTUS_VERSION file
echo ""
echo "Updating DIRECTUS_VERSION file..."

echo "$TARGET_VERSION" > "$DIRECTUS_VERSION_FILE"

echo ""
echo -e "${GREEN}✓ DIRECTUS_VERSION updated to $TARGET_VERSION${NC}"
echo ""
echo "Next steps:"
echo "  1. Review Directus changelog: https://github.com/directus/directus/releases"
echo "  2. Rebuild Docker: docker compose up -d --build"
echo "  3. Test the application"
echo "  4. Commit changes: git add DIRECTUS_VERSION && git commit -m 'Update Directus to $TARGET_VERSION'"
echo ""

# Show recent releases for reference
echo "Recent Directus releases:"
npm view directus versions --json 2>/dev/null | tail -10 | tr -d '[],"' | sed 's/^/  /'
echo ""
