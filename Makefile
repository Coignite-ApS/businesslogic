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

.PHONY: up down restart stop logs status health test validate-schema \
        cms cms-restart cms-logs cms-stop \
        ai-api ai-api-restart ai-api-logs ai-api-stop \
        formula-api formula-api-restart formula-api-logs formula-api-stop \
        gateway gateway-restart gateway-logs gateway-stop \
        flow flow-restart flow-logs flow-stop \
        ext ext-ai-api ext-ai-assistant ext-ai-observatory \
        ext-calculators ext-calculator-api ext-formulas ext-account ext-account-api \
        ext-admin ext-stripe ext-flows ext-flow-hooks \
        ext-knowledge ext-knowledge-api ext-layout-builder \
        ext-feature-flags ext-feature-gate ext-widget-api ext-usage-consumer \
        db snapshot snapshot-pre snapshot-post snapshot-dryrun snapshot-forensic data-baseline diff prune

# ─── Full Stack ──────────────────────────────────────────────────

up:
	@$(COMPOSE) up -d
	@echo "✓ Stack running"

down:
	@$(COMPOSE) down
	@echo "✓ Stack stopped"

restart:
	@$(COMPOSE) up -d --force-recreate
	@echo "✓ Stack restarted (containers recreated — .env picked up)"

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
	@$(COMPOSE) up -d --force-recreate bl-cms
	@echo "✓ CMS restarted (extensions rebuilt, container recreated — .env picked up)"

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

ext-usage-consumer:
	@cd $(CMS_EXT)/project-extension-usage-consumer && npx directus-extension build

# ─── Database ─────────────────────────────────────────────────────
# Naming conventions (used by db-admin skill):
#   snapshot_YYYYMMDD_HHMMSS[_slug].sql.gz  — routine baselines (rotated, keep last 5)
#   pre_<slug>_YYYYMMDD_HHMMSS.sql.gz       — taken before a db-admin task
#   post_<slug>_YYYYMMDD_HHMMSS.sql.gz      — taken after a db-admin task

# Routine PG dump. Optional: SLUG=<branch-or-task> appends slug.
snapshot:
	@TS=$$(date +%Y%m%d_%H%M%S); \
	SUFFIX=$(if $(SLUG),_$(SLUG),); \
	OUT="infrastructure/db-snapshots/snapshot_$${TS}$${SUFFIX}.sql.gz"; \
	$(COMPOSE) exec -T postgres pg_dump -U directus -d directus --clean --if-exists | gzip > "$${OUT}"; \
	echo "✓ PG dump: $${OUT}"

# Pre-task PG dump (REQUIRES SLUG). Used by db-admin BEFORE applying any change.
snapshot-pre:
	@[ -n "$(SLUG)" ] || { echo "ERROR: pass SLUG=<task-slug>  (e.g., make snapshot-pre SLUG=add-widget-collection)"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="infrastructure/db-snapshots/pre_$(SLUG)_$${TS}.sql.gz"; \
	$(COMPOSE) exec -T postgres pg_dump -U directus -d directus --clean --if-exists | gzip > "$${OUT}"; \
	echo "✓ Pre-task PG dump: $${OUT}"

# Post-task PG dump (REQUIRES SLUG). Used by db-admin AFTER applying any change.
snapshot-post:
	@[ -n "$(SLUG)" ] || { echo "ERROR: pass SLUG=<task-slug>"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="infrastructure/db-snapshots/post_$(SLUG)_$${TS}.sql.gz"; \
	$(COMPOSE) exec -T postgres pg_dump -U directus -d directus --clean --if-exists | gzip > "$${OUT}"; \
	echo "✓ Post-task PG dump: $${OUT}"

# Dryrun PG dump (REQUIRES PURPOSE). Use for exploratory snapshots NOT tied to a real applied change.
# These are aggressively pruned by `make prune` (default: keep last 2).
snapshot-dryrun:
	@[ -n "$(PURPOSE)" ] || { echo "ERROR: pass PURPOSE=<short-purpose>  (e.g., make snapshot-dryrun PURPOSE=test-import)"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="infrastructure/db-snapshots/dryrun_$(PURPOSE)_$${TS}.sql.gz"; \
	$(COMPOSE) exec -T postgres pg_dump -U directus -d directus --clean --if-exists | gzip > "$${OUT}"; \
	echo "✓ Dryrun PG dump: $${OUT}  (will be pruned aggressively)"

# Forensic PG dump (REQUIRES SLUG). Used by db-admin Phase 6.5 to capture a FAILED apply
# state BEFORE rolling back, so the failure can be investigated. Grouped with the task slug.
snapshot-forensic:
	@[ -n "$(SLUG)" ] || { echo "ERROR: pass SLUG=<task-slug>"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="infrastructure/db-snapshots/forensic_$(SLUG)_$${TS}.sql.gz"; \
	$(COMPOSE) exec -T postgres pg_dump -U directus -d directus --clean --if-exists | gzip > "$${OUT}"; \
	echo "✓ Forensic PG dump (failed state): $${OUT}"

# Capture row count + (optional) per-column fingerprint for one table.
# Used by db-admin Phase 4.5 (baseline) and Phase 6.5 (post-apply check).
data-baseline:
	@[ -n "$(TABLE)" ] || { echo "ERROR: pass TABLE=<schema.table>  [COL=<column>] [ID_COL=<pk-column-default-id>]"; exit 1; }
	@TABLE="$(TABLE)" COL="$(COL)" ID_COL="$(ID_COL)" ./scripts/db-baseline.sh

# Diff current Directus schema against latest YAML snapshot (or specified one via SNAPSHOT=).
diff:
	@$(MAKE) -C services/cms diff $(if $(SNAPSHOT),SNAPSHOT=$(SNAPSHOT),)

# Prune old artifacts. Override defaults via env: KEEP_ROUTINE, KEEP_TASK_DAYS, ARCHIVE_REPORTS_DAYS, DRY_RUN.
prune:
	@./scripts/prune-db-artifacts.sh

validate-schema:
	@./scripts/validate-schema.sh

db:
	@$(COMPOSE) exec postgres psql -U directus -d directus

# ─── Tests ────────────────────────────────────────────────────────

test:
	@./scripts/test-all.sh

test-quick:
	@./scripts/test-all.sh --quick
