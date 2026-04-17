# =============================================================================
# Businesslogic CMS Directus - Makefile
# =============================================================================
# Common tasks for development and maintenance.
#
# Usage:
#   make init    # Initialize submodule and prepare environment
#   make dev     # Start local development environment
#   make build   # Build Docker image
#   make update  # Update base submodule to latest
# =============================================================================

.PHONY: init update dev build stop clean check-updates reset-cache db-sync snapshot snapshot-pre snapshot-post snapshot-dryrun snapshot-forensic diff apply \
       ext-build-all ext-build ext-calculators-build ext-calculators-watch \
       ext-calculator-api-build ext-calculator-api-watch \
       ext-formulas-build ext-formulas-watch \
       ext-account-build ext-account-watch \
       ext-admin-build ext-admin-watch \
       ext-stripe-build ext-stripe-watch \
       ext-ai-api-build ext-ai-api-watch \
       ext-ai-assistant-build ext-ai-assistant-watch \
       build-no-cache logs

# Initialize submodule and environment
init:
	@echo "Initializing submodules..."
	@git submodule update --init --recursive
	@if [ ! -f .npm_token ]; then \
		echo "Creating .npm_token from .env..."; \
		grep NPM_TOKEN .env 2>/dev/null | cut -d= -f2 > .npm_token || echo "WARNING: Set NPM_TOKEN in .env or .npm_token"; \
	fi
	@$(MAKE) ext-build-all
	@echo "Ready! Run 'make dev' to start."

# Update base submodule to latest
update:
	@echo "Updating base submodule..."
	@git submodule update --remote base
	@echo "Base updated. Review changes and commit:"
	@echo "  git add base"
	@echo "  git commit -m 'Update base submodule'"

# Start local development environment
dev:
	@./base/dev.sh

# Build Docker image
build:
	@docker compose build

# Stop all services
stop:
	@docker compose down

# Clean up (removes volumes too)
clean:
	@docker compose down -v
	@echo "All containers and volumes removed."

# --- Maintenance scripts (from base) ---

check-updates:
	@./base/scripts/check-updates.sh

reset-cache:
	@./base/scripts/reset-cache.sh

db-sync:
	@./base/scripts/db-sync.sh

# --- Build shortcuts ---

build-no-cache:
	@docker compose build --no-cache

logs:
	@docker compose logs -f directus

# --- Schema snapshots ---
# Naming conventions (used by db-admin skill):
#   snapshot_YYYYMMDD_HHMMSS[_slug].yaml  — routine baselines (rotated, keep last 5)
#   pre_<slug>_YYYYMMDD_HHMMSS.yaml       — taken before a db-admin task
#   post_<slug>_YYYYMMDD_HHMMSS.yaml      — taken after a db-admin task
#   snapshot.yaml                          — canonical schema, committed to git, NEVER pruned

# Routine schema snapshot. Optional: SLUG=<branch-or-task> appends slug.
snapshot:
	@TS=$$(date +%Y%m%d_%H%M%S); \
	SUFFIX=$(if $(SLUG),_$(SLUG),); \
	OUT="snapshot_$${TS}$${SUFFIX}.yaml"; \
	docker compose exec directus node /directus/cli.js schema snapshot "/directus/snapshots/$${OUT}"; \
	echo "Saved: snapshots/$${OUT}"

# Pre-task schema snapshot (REQUIRES SLUG).
snapshot-pre:
	@[ -n "$(SLUG)" ] || { echo "ERROR: pass SLUG=<task-slug>  (e.g., make snapshot-pre SLUG=add-widget-collection)"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="pre_$(SLUG)_$${TS}.yaml"; \
	docker compose exec directus node /directus/cli.js schema snapshot "/directus/snapshots/$${OUT}"; \
	echo "Saved: snapshots/$${OUT}"

# Post-task schema snapshot (REQUIRES SLUG).
snapshot-post:
	@[ -n "$(SLUG)" ] || { echo "ERROR: pass SLUG=<task-slug>"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="post_$(SLUG)_$${TS}.yaml"; \
	docker compose exec directus node /directus/cli.js schema snapshot "/directus/snapshots/$${OUT}"; \
	echo "Saved: snapshots/$${OUT}"

# Dryrun schema snapshot (REQUIRES PURPOSE). Use for exploratory snapshots NOT tied to a real applied change.
# These are aggressively pruned by `make prune` (default: keep last 2).
snapshot-dryrun:
	@[ -n "$(PURPOSE)" ] || { echo "ERROR: pass PURPOSE=<short-purpose>  (e.g., make snapshot-dryrun PURPOSE=test-rename)"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="dryrun_$(PURPOSE)_$${TS}.yaml"; \
	docker compose exec directus node /directus/cli.js schema snapshot "/directus/snapshots/$${OUT}"; \
	echo "Saved: snapshots/$${OUT}  (will be pruned aggressively)"

# Forensic schema snapshot (REQUIRES SLUG). Used by db-admin Phase 6.5 to capture a FAILED
# apply state BEFORE rolling back, so the failure can be investigated.
snapshot-forensic:
	@[ -n "$(SLUG)" ] || { echo "ERROR: pass SLUG=<task-slug>"; exit 1; }
	@TS=$$(date +%Y%m%d_%H%M%S); \
	OUT="forensic_$(SLUG)_$${TS}.yaml"; \
	docker compose exec directus node /directus/cli.js schema snapshot "/directus/snapshots/$${OUT}"; \
	echo "Saved: snapshots/$${OUT}  (failed state — preserved for investigation)"

# Diff current schema against latest snapshot (or SNAPSHOT=<file.yaml>).
diff:
	@./snapshots/diff-schema.sh $(SNAPSHOT)

# Apply latest schema snapshot to the database (or SNAPSHOT=<file.yaml>).
apply:
	@./snapshots/apply-schema.sh $(SNAPSHOT)

# --- Extension development ---

# Build all local extensions (required for local dev with volume mounts)
ext-build-all:
	@echo "Building base extensions..."
	@for dir in base/extensions/local/*/; do \
		echo "  Building $$(basename $$dir)..."; \
		cd "$$dir" && npm install --silent && npx directus-extension build && cd - > /dev/null; \
	done
	@echo "Building project extensions..."
	@for dir in extensions/local/*/; do \
		if [ -d "$$dir" ]; then \
			echo "  Building $$(basename $$dir)..."; \
			cd "$$dir" && npm install --silent && npx directus-extension build && cd - > /dev/null; \
		fi \
	done
	@echo "Done!"

# Generic: make ext-build EXT=calculators
ext-build:
	@cd extensions/local/project-extension-$(EXT) && npm run build

ext-calculators-build:
	@cd extensions/local/project-extension-calculators && npm run build

ext-calculators-watch:
	@cd extensions/local/project-extension-calculators && npm run dev

ext-calculator-api-build:
	@cd extensions/local/project-extension-calculator-api && npm run build

ext-calculator-api-watch:
	@cd extensions/local/project-extension-calculator-api && npm run dev

ext-formulas-build:
	@cd extensions/local/project-extension-formulas && npm run build

ext-formulas-watch:
	@cd extensions/local/project-extension-formulas && npm run dev

ext-account-build:
	@cd extensions/local/project-extension-account && npm run build

ext-account-watch:
	@cd extensions/local/project-extension-account && npm run dev

ext-admin-build:
	@cd extensions/local/project-extension-admin && npm run build

ext-admin-watch:
	@cd extensions/local/project-extension-admin && npm run dev

ext-stripe-build:
	@cd extensions/local/project-extension-stripe && npm run build

ext-stripe-watch:
	@cd extensions/local/project-extension-stripe && npm run dev

ext-ai-api-build:
	@cd extensions/local/project-extension-ai-api && npm run build

ext-ai-api-watch:
	@cd extensions/local/project-extension-ai-api && npm run dev

ext-ai-assistant-build:
	@cd extensions/local/project-extension-ai-assistant && npm run build

ext-ai-assistant-watch:
	@cd extensions/local/project-extension-ai-assistant && npm run dev
