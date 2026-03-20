#!/bin/bash
# =============================================================================
# Coignite Cockpit Directus - Development Quick Start
# =============================================================================
# Usage: ./dev.sh
# =============================================================================

set -e

echo "=========================================="
echo "Coignite Cockpit Directus - Dev Environment"
echo "=========================================="
echo ""

# Check for .env file
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo ""
        echo "IMPORTANT: Please edit .env and add your NPM_TOKEN"
        echo "You can find it in the existing .env file or your npm account."
        echo ""
        echo "Then run this script again: ./dev.sh"
        exit 1
    else
        echo "ERROR: .env.example not found!"
        exit 1
    fi
fi

# Check if NPM_TOKEN is set
if grep -q "your_npm_token_here" .env 2>/dev/null; then
    echo "ERROR: NPM_TOKEN is not set in .env"
    echo "Please edit .env and replace 'your_npm_token_here' with your actual token."
    exit 1
fi

# Set build args
export DIRECTUS_VERSION=$(cat DIRECTUS_VERSION)
export PROJECT_VERSION=$(date +%Y.%m.%d)

# Build local extensions for hot-reload
echo ""
./base/scripts/build-local-extensions.sh
echo ""

# Start all services
echo "Starting services..."
echo "  Directus: $DIRECTUS_VERSION"
echo "  Project:  $PROJECT_VERSION"
echo ""
docker compose up -d --build

echo ""
echo "=========================================="
echo "Services starting..."
echo "=========================================="
echo ""
echo "  Directus Admin:  http://localhost:8056"
echo "  MailDev UI:      http://localhost:1080"
echo ""
echo "  Default login:   admin@example.com / admin123"
echo ""
echo "=========================================="
echo "Useful commands:"
echo "=========================================="
echo ""
echo "  View logs:       docker compose logs -f directus"
echo "  Stop:            docker compose down"
echo "  Fresh start:     docker compose down -v && ./dev.sh"
echo ""
echo "  Create extension:"
echo "    cd extensions/local"
echo "    npx create-directus-extension@latest"
echo ""
echo "=========================================="
echo ""

# Wait a moment then show initial logs
echo "Waiting for Directus to start (showing logs)..."
echo ""
sleep 3
docker compose logs -f directus
