#!/bin/sh
# =============================================================================
# Update Base Submodule
# =============================================================================
# Pulls latest changes from base submodule, handling SSH/HTTPS automatically.
# Use this after pushing changes to base repo.
#
# Usage:
#   ./base/scripts/update-base.sh              # Update to latest main
#   ./base/scripts/update-base.sh <branch>     # Update to specific branch
#   ./base/scripts/update-base.sh <commit>     # Update to specific commit
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$BASE_DIR")"

printf "\n"
printf "==========================================\n"
printf "  Update Base Submodule\n"
printf "==========================================\n"
printf "\n"

cd "$PROJECT_ROOT" || exit 1

REF="${1:-main}"

# Check if submodule is initialized
if [ ! -d "base/.git" ] && [ ! -f "base/.git" ]; then
    printf "${YELLOW}Submodule not initialized. Initializing...${NC}\n"
    git submodule update --init base
fi

cd base

# Get current remote URL
REMOTE_URL=$(git remote get-url origin 2>/dev/null)

# Test if we can fetch with current URL
printf "${BLUE}Testing connection...${NC}\n"
if ! git fetch origin 2>/dev/null; then
    printf "${YELLOW}SSH failed, switching to HTTPS...${NC}\n"

    # Convert SSH to HTTPS
    HTTPS_URL=$(echo "$REMOTE_URL" | sed 's|git@github.com:|https://github.com/|')
    git remote set-url origin "$HTTPS_URL"

    # Try again
    if ! git fetch origin; then
        printf "${RED}Error: Could not fetch from remote${NC}\n"
        exit 1
    fi

    printf "${GREEN}✓ Using HTTPS${NC}\n"
fi

printf "\n"
printf "${BLUE}Updating to: $REF${NC}\n"

# Checkout the ref
if git show-ref --verify --quiet "refs/remotes/origin/$REF" 2>/dev/null; then
    # It's a branch
    git checkout "origin/$REF" --detach
elif git rev-parse --verify "$REF^{commit}" >/dev/null 2>&1; then
    # It's a commit
    git checkout "$REF" --detach
else
    printf "${RED}Error: Unknown ref '$REF'${NC}\n"
    exit 1
fi

NEW_COMMIT=$(git rev-parse --short HEAD)
printf "\n"
printf "${GREEN}✓ Base updated to: $NEW_COMMIT${NC}\n"

# Show what changed
printf "\n"
printf "${BLUE}Recent commits:${NC}\n"
git log --oneline -5

cd "$PROJECT_ROOT"

# Stage the submodule update
git add base

printf "\n"
printf "${GREEN}✓ Submodule staged. Commit with:${NC}\n"
printf "  git commit -m \"Update base submodule\"\n"
printf "\n"
