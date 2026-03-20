#!/bin/bash
# Health check all BusinessLogic services
set -euo pipefail

echo "=== BusinessLogic Platform Health Check ==="
echo ""

services=(
  "bl-cms|http://localhost:18055/server/ping"
  "bl-formula-api|http://localhost:13000/ping"
  "bl-flow-trigger|http://localhost:13100/ping"
  "bl-ai-api|http://localhost:13200/ping"
  "bl-gateway|http://localhost:18080/health"
  "legacy-cms|http://localhost:18056/server/ping"
  "PostgreSQL|http://localhost:15432"
  "Redis|http://localhost:16379"
)

healthy=0
unhealthy=0
skipped=0

for entry in "${services[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"

  # Special handling for non-HTTP services
  if [ "$name" = "PostgreSQL" ]; then
    if pg_isready -h localhost -p 15432 -U directus &>/dev/null; then
      echo "  ✅ $name — healthy"
      healthy=$((healthy + 1))
    else
      echo "  ⬚  $name — not running"
      skipped=$((skipped + 1))
    fi
    continue
  fi

  if [ "$name" = "Redis" ]; then
    if redis-cli -h localhost -p 16379 ping &>/dev/null; then
      echo "  ✅ $name — healthy"
      healthy=$((healthy + 1))
    else
      echo "  ⬚  $name — not running"
      skipped=$((skipped + 1))
    fi
    continue
  fi

  status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    echo "  ✅ $name — healthy"
    healthy=$((healthy + 1))
  elif [ "$status" = "000" ] || ! curl -s --connect-timeout 1 "$url" &>/dev/null; then
    echo "  ⬚  $name — not running"
    skipped=$((skipped + 1))
  else
    echo "  ❌ $name — unhealthy (HTTP $status)"
    unhealthy=$((unhealthy + 1))
  fi
done

echo ""
echo "Summary: $healthy healthy, $unhealthy unhealthy, $skipped not running"

if [ "$unhealthy" -gt 0 ]; then
  exit 1
fi
