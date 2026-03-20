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

.PHONY: init update dev build stop clean check-updates reset-cache db-sync snapshot \
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

snapshot:
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S); \
	docker compose exec directus node /directus/cli.js schema snapshot "/directus/snapshots/snapshot_$${TIMESTAMP}.yaml"; \
	echo "Saved: snapshots/snapshot_$${TIMESTAMP}.yaml"

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
