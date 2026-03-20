#!/bin/bash
# =============================================================================
# Project Initialization Script
# =============================================================================
# Run this once after cloning the template to customize placeholders
#
# Usage: ./init-project.sh
# =============================================================================

set -e

echo "=========================================="
echo "Directus Project Initialization"
echo "=========================================="
echo ""

# Gather project info
read -p "Project Name (e.g., Acme Dashboard): " PROJECT_NAME
read -p "Project Slug (e.g., acme-dashboard): " PROJECT_SLUG
read -p "GitHub Repo Name (e.g., acme-dashboard-directus): " REPO_NAME
read -p "Project Description (one line): " PROJECT_DESCRIPTION
read -p "Sentry DSN (or leave empty to skip): " SENTRY_DSN

echo ""
echo "Replacing placeholders..."

# Files to process
FILES=(
  "README.md"
  "CLAUDE.md"
  "Makefile"
  "docker-compose.yml"
  "config.local.yaml"
  "config.dev.yaml"
  "config.live.yaml"
  ".env.example"
  "extensions/package.json"
  ".github/workflows/build-and-deploy.yml"
)

# Replace placeholders in each file
for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  Processing $file..."

    # Use | as delimiter to avoid issues with URLs in replacements
    sed -i '' "s|{{PROJECT_NAME}}|$PROJECT_NAME|g" "$file"
    sed -i '' "s|{{PROJECT_SLUG}}|$PROJECT_SLUG|g" "$file"
    sed -i '' "s|{{REPO_NAME}}|$REPO_NAME|g" "$file"
    sed -i '' "s|{{PROJECT_DESCRIPTION}}|$PROJECT_DESCRIPTION|g" "$file"

    # Handle Sentry DSN - if empty, leave placeholder for later
    if [ -n "$SENTRY_DSN" ]; then
      sed -i '' "s|{{SENTRY_DSN}}|$SENTRY_DSN|g" "$file"
    fi
  fi
done

echo ""
echo "=========================================="
echo "Done! Project initialized."
echo "=========================================="
echo ""
echo "Summary:"
echo "  Project Name: $PROJECT_NAME"
echo "  Project Slug: $PROJECT_SLUG"
echo "  Repo Name:    $REPO_NAME"
if [ -n "$SENTRY_DSN" ]; then
  echo "  Sentry DSN:   $SENTRY_DSN"
else
  echo "  Sentry DSN:   (not set - replace {{SENTRY_DSN}} later)"
fi
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Create .env:    cp .env.example .env && edit .env"
echo "  3. Start dev:      make init && make dev"
echo ""
echo "Delete this script after initialization:"
echo "  rm init-project.sh"
echo ""
