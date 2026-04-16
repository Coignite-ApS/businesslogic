# =============================================================================
# BusinessLogic Platform — Root Makefile
# =============================================================================
# Quick reference:
#   make up          Start full dev stack
#   make down        Stop everything
#   make restart     Restart all services
#   make cms-restart Rebuild extensions + restart CMS
#   make ext         Build all CMS extensions
#   make ext-ai-api  Build single extension
#   make logs        Tail all logs
#   make test        Run all tests
# =============================================================================

COMPOSE := docker compose -f infrastructure/docker/docker-compose.dev.yml
CMS_EXT := services/cms/extensions/local

.PHONY: up down restart stop logs status health test \
        cms cms-restart cms-logs cms-stop \
        ai-api ai-api-restart ai-api-logs ai-api-stop \
        formula-api formula-api-restart formula-api-logs formula-api-stop \
        gateway gateway-restart gateway-logs gateway-stop \
        flow flow-restart flow-logs flow-stop \
        ext ext-ai-api ext-ai-assistant ext-ai-observatory \
        ext-calculators ext-calculator-api ext-formulas ext-account ext-account-api \
        ext-admin ext-stripe ext-flows ext-flow-hooks \
        ext-knowledge ext-knowledge-api ext-layout-builder \
        ext-feature-flags ext-feature-gate ext-widget-api \
        db snapshot

# ─── Full Stack ──────────────────────────────────────────────────

up:
	@$(COMPOSE) up -d
	@echo "✓ Stack running"

down:
	@$(COMPOSE) down
	@echo "✓ Stack stopped"

restart:
	@$(COMPOSE) restart
	@echo "✓ Stack restarted"

stop: down

logs:
	@$(COMPOSE) logs -f --tail=50

status:
	@$(COMPOSE) ps

health:
	@./scripts/health-check.sh 2>/dev/null || ( \
		echo "=== Service Health ==="; \
		for svc in bl-cms:18055 bl-ai-api:3200 bl-formula-api:3000 bl-gateway:8080 bl-flow-trigger:3100; do \
			name=$${svc%%:*}; port=$${svc##*:}; \
			if curl -sf http://localhost:$$port/server/health > /dev/null 2>&1 || \
			   curl -sf http://localhost:$$port/health > /dev/null 2>&1; then \
				echo "  ✓ $$name ($$port)"; \
			else \
				echo "  ✗ $$name ($$port)"; \
			fi \
		done \
	)

# ─── Individual Services ─────────────────────────────────────────

# CMS (Directus + extensions)
cms:
	@$(COMPOSE) up -d bl-cms

cms-restart: ext
	@$(COMPOSE) restart bl-cms
	@echo "✓ CMS restarted (extensions rebuilt)"

cms-logs:
	@$(COMPOSE) logs -f --tail=50 bl-cms

cms-stop:
	@$(COMPOSE) stop bl-cms

# AI API
ai-api:
	@$(COMPOSE) up -d bl-ai-api

ai-api-restart:
	@$(COMPOSE) restart bl-ai-api
	@echo "✓ AI API restarted"

ai-api-logs:
	@$(COMPOSE) logs -f --tail=50 bl-ai-api

ai-api-stop:
	@$(COMPOSE) stop bl-ai-api

# Formula API
formula-api:
	@$(COMPOSE) up -d bl-formula-api

formula-api-restart:
	@$(COMPOSE) restart bl-formula-api
	@echo "✓ Formula API restarted"

formula-api-logs:
	@$(COMPOSE) logs -f --tail=50 bl-formula-api

formula-api-stop:
	@$(COMPOSE) stop bl-formula-api

# Gateway
gateway:
	@$(COMPOSE) up -d bl-gateway

gateway-restart:
	@$(COMPOSE) restart bl-gateway
	@echo "✓ Gateway restarted"

gateway-logs:
	@$(COMPOSE) logs -f --tail=50 bl-gateway

gateway-stop:
	@$(COMPOSE) stop bl-gateway

# Flow Engine
flow:
	@$(COMPOSE) up -d bl-flow-trigger bl-flow-worker

flow-restart:
	@$(COMPOSE) restart bl-flow-trigger bl-flow-worker
	@echo "✓ Flow engine restarted"

flow-logs:
	@$(COMPOSE) logs -f --tail=50 bl-flow-trigger bl-flow-worker

flow-stop:
	@$(COMPOSE) stop bl-flow-trigger bl-flow-worker

# ─── CMS Extensions ──────────────────────────────────────────────

# Build ALL extensions
ext:
	@echo "Building all CMS extensions..."
	@failed=0; \
	for dir in $(CMS_EXT)/*/; do \
		name=$$(basename "$$dir"); \
		if [ -f "$$dir/package.json" ]; then \
			printf "  %-45s" "$$name"; \
			if (cd "$$dir" && npx directus-extension build) > /dev/null 2>&1; then \
				echo "✓"; \
			else \
				echo "✗"; \
				failed=$$((failed + 1)); \
			fi \
		fi \
	done; \
	if [ $$failed -gt 0 ]; then \
		echo "⚠ $$failed extension(s) failed to build"; \
		exit 1; \
	fi
	@echo "✓ All extensions built"

# Single extension targets — make ext-<name>
ext-ai-api:
	@cd $(CMS_EXT)/project-extension-ai-api && npx directus-extension build

ext-ai-assistant:
	@cd $(CMS_EXT)/project-extension-ai-assistant && npx directus-extension build

ext-ai-observatory:
	@cd $(CMS_EXT)/project-extension-ai-observatory && npx directus-extension build

ext-calculators:
	@cd $(CMS_EXT)/project-extension-calculators && npx directus-extension build

ext-calculator-api:
	@cd $(CMS_EXT)/project-extension-calculator-api && npx directus-extension build

ext-formulas:
	@cd $(CMS_EXT)/project-extension-formulas && npx directus-extension build

ext-account:
	@cd $(CMS_EXT)/project-extension-account && npx directus-extension build

ext-account-api:
	@cd $(CMS_EXT)/project-extension-account-api && npx directus-extension build

ext-admin:
	@cd $(CMS_EXT)/project-extension-admin && npx directus-extension build

ext-stripe:
	@cd $(CMS_EXT)/project-extension-stripe && npx directus-extension build

ext-flows:
	@cd $(CMS_EXT)/project-extension-flows && npx directus-extension build

ext-flow-hooks:
	@cd $(CMS_EXT)/project-extension-flow-hooks && npx directus-extension build

ext-knowledge:
	@cd $(CMS_EXT)/project-extension-knowledge && npx directus-extension build

ext-knowledge-api:
	@cd $(CMS_EXT)/project-extension-knowledge-api && npx directus-extension build

ext-layout-builder:
	@cd $(CMS_EXT)/project-extension-layout-builder && npx directus-extension build

ext-feature-flags:
	@cd $(CMS_EXT)/project-extension-feature-flags && npx directus-extension build

ext-feature-gate:
	@cd $(CMS_EXT)/project-extension-feature-gate && npx directus-extension build

ext-widget-api:
	@cd $(CMS_EXT)/project-extension-widget-api && npx directus-extension build

# ─── Database ─────────────────────────────────────────────────────

snapshot:
	@$(COMPOSE) exec -T postgres pg_dump -U directus -d directus --clean --if-exists | gzip > \
		infrastructure/db-snapshots/snapshot_$$(date +%Y%m%d_%H%M%S).sql.gz
	@echo "✓ Snapshot saved"

db:
	@$(COMPOSE) exec postgres psql -U directus -d directus

# ─── Tests ────────────────────────────────────────────────────────

test:
	@./scripts/test-all.sh

test-quick:
	@./scripts/test-all.sh --quick
