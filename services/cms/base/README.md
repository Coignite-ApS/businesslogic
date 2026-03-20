# Coignite Directus Base

Shared infrastructure for Directus projects. Use as a git submodule.

## Quick Start

```bash
# Add to your project
git submodule add git@github.com:Coignite-ApS/coignite-directus-base.git base
git submodule update --init --recursive
```

## Structure

```
base/
├── scripts/                    # Maintenance scripts
│   ├── check-updates.sh        # Check for Directus/extension updates
│   ├── update-directus.sh      # Update Directus version
│   ├── update-extensions.sh    # Update npm extensions
│   ├── reset-cache.sh          # Clear Redis schema cache
│   └── db-sync.sh              # Sync database from remote
├── docker/                     # Runtime scripts
│   ├── entrypoint.sh           # Container entrypoint (memory check, Sentry)
│   ├── sentry-preload.cjs      # Sentry initialization
│   └── build-extensions.sh     # Build local extensions
├── extensions/local/           # Generic extensions
│   ├── base-extension-sentry/
│   └── base-extension-memory-stats/
├── docs/                       # Documentation templates
├── Dockerfile                  # Base Dockerfile template
├── docker-compose.base.yml     # Supporting services (postgres, redis, maildev)
├── dev.sh                      # Development helper
└── .env.example
```

## Usage in Projects

### 1. docker-compose.yml

```yaml
include:
  - path: base/docker-compose.base.yml

services:
  directus:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        DIRECTUS_VERSION: ${DIRECTUS_VERSION}
        PROJECT_VERSION: ${PROJECT_VERSION}
      secrets:
        - npm_token
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "8056:8055"
    volumes:
      - ./config.local.yaml:/directus/config.local.yaml:ro
      # Base extensions for dev
      - ./base/extensions/local/base-extension-sentry:/directus/extensions/base-extension-sentry
      - ./base/extensions/local/base-extension-memory-stats:/directus/extensions/base-extension-memory-stats
      # Project extensions for dev
      - ./extensions/local/project-extension-example:/directus/extensions/project-extension-example
    environment:
      CONFIG_PATH: '/directus/config.local.yaml'
      KEY: '${KEY:-local-dev-key-minimum-32-characters}'
      SECRET: '${SECRET:-local-dev-secret-minimum-32-chars}'
      PUBLIC_URL: 'http://localhost:8056'

volumes:
  directus_uploads:

secrets:
  npm_token:
    file: .npm_token
```

### 2. Project Dockerfile

```dockerfile
ARG DIRECTUS_VERSION
ARG PROJECT_VERSION
FROM directus/directus:${DIRECTUS_VERSION}

# Build tools
USER root
RUN apk add --no-cache wget python3 make g++
RUN corepack enable
USER node
WORKDIR /directus

# NPM extensions (project-specific)
COPY --chown=node:node extensions/package.json /tmp/extensions-package.json
COPY --chown=node:node extensions/.npmrc /directus/.npmrc
RUN --mount=type=secret,id=npm_token,uid=1000 \
    export NPM_TOKEN=$(cat /run/secrets/npm_token) && \
    DEPS=$(node -e "const p=require('/tmp/extensions-package.json');console.log(Object.entries(p.dependencies||{}).map(([n,v])=>n+'@'+v.replace(/^\^/,'')).join(' '))") && \
    [ -n "$DEPS" ] && pnpm install $DEPS; \
    rm -f /directus/.npmrc

# Build script from base
COPY --chown=node:node base/docker/build-extensions.sh /directus/docker/
RUN chmod +x /directus/docker/build-extensions.sh

# Base extensions
COPY --chown=node:node base/extensions/local /tmp/base-extensions/
RUN /directus/docker/build-extensions.sh /tmp/base-extensions

# Project extensions
COPY --chown=node:node extensions/local /tmp/project-extensions/
RUN /directus/docker/build-extensions.sh /tmp/project-extensions

# Runtime scripts from base
COPY --chown=node:node base/docker/entrypoint.sh /directus/docker/
COPY --chown=node:node base/docker/sentry-preload.cjs /directus/docker/
RUN chmod +x /directus/docker/entrypoint.sh

# Project configs
COPY --chown=node:node config.dev.yaml config.live.yaml /directus/
COPY --chown=node:node email-templates /directus/email-templates
COPY --chown=node:node snapshots /directus/snapshots

# Version for Sentry
ARG PROJECT_VERSION
RUN echo "${PROJECT_VERSION}" > /directus/PROJECT_VERSION

HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=30 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8055/server/health || exit 1

EXPOSE 8055
ENTRYPOINT ["/directus/docker/entrypoint.sh"]
CMD ["start"]
```

### 3. Makefile

```makefile
.PHONY: init update dev build

init:
	git submodule update --init --recursive

update:
	git submodule update --remote base
	@echo "Base updated. Review changes and commit."

dev:
	./base/dev.sh

build:
	docker compose build
```

## Updating Base

```bash
# In your project
make update
# or
git submodule update --remote base
git add base
git commit -m "Update base to latest"
```

## Included Extensions

### Sentry (`base-extension-sentry`)
Error tracking and performance monitoring with:
- OpenTelemetry integrations (HTTP, Express, PostgreSQL, Redis)
- Memory monitoring with breadcrumbs
- Custom health endpoint `/sentry/health`

### Memory Stats (`base-extension-memory-stats`)
Real-time memory and CPU monitoring:
- Endpoint: `/memory-stats`
- Optional auto-restart on threshold breach
- Configure via `MEMORY_STATS_RESTART_ON_RAM`, `MEMORY_STATS_RESTART_ON_CPU`

## Extension Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Base (submodule) | `base-extension-*` | `base-extension-sentry` |
| Project-specific | `project-extension-*` | `project-extension-character-count` |

This convention distinguishes shared infrastructure extensions from project-specific ones.
