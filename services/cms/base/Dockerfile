# syntax=docker/dockerfile:1
# =============================================================================
# Directus Dockerfile (lives in base/, used by all projects)
# =============================================================================
# This Dockerfile lives in the base submodule but is built with PROJECT ROOT
# as the context. All paths are relative to the project root.
#
# Usage in project's docker-compose.yml:
#   build:
#     context: .                    # Project root
#     dockerfile: base/Dockerfile   # This file
#
# Build with: docker compose build (from project root)
# =============================================================================

ARG DIRECTUS_VERSION
ARG PROJECT_VERSION
FROM directus/directus:${DIRECTUS_VERSION}

# -----------------------------------------------------------------------------
# Install build tools (needed for some native extensions)
# -----------------------------------------------------------------------------
USER root
RUN apk add --no-cache wget python3 make g++
RUN corepack enable
USER node

WORKDIR /directus

# -----------------------------------------------------------------------------
# 1. Install npm extensions (project-specific @coignite + public packages)
# -----------------------------------------------------------------------------
# Paths relative to project root (the context)
COPY --chown=node:node extensions/package.json /tmp/extensions-package.json
COPY --chown=node:node extensions/.npmrc /directus/.npmrc

RUN --mount=type=secret,id=npm_token,uid=1000 \
    set -e && \
    echo "========================================" && \
    echo "Installing NPM extensions..." && \
    echo "========================================" && \
    export NPM_TOKEN=$(cat /run/secrets/npm_token) && \
    if [ -z "$NPM_TOKEN" ]; then \
      echo "ERROR: NPM_TOKEN secret is empty or not provided" && exit 1; \
    fi && \
    DEPS=$(node -e " \
      const pkg = require('/tmp/extensions-package.json'); \
      const deps = Object.entries(pkg.dependencies || {}).map(([name, version]) => name + '@' + version.replace(/^\^/, '')).join(' '); \
      console.log(deps); \
    ") && \
    if [ -z "$DEPS" ]; then \
      echo "WARNING: No extensions found in package.json"; \
    else \
      echo "Installing: $(echo $DEPS | tr ' ' '\n' | wc -l) extensions" && \
      pnpm install --child-concurrency=2 $DEPS && \
      echo "OK NPM extensions installed successfully"; \
    fi && \
    rm -f /directus/.npmrc

# -----------------------------------------------------------------------------
# 2. Build script (from base/ submodule)
# -----------------------------------------------------------------------------
COPY --chown=node:node base/docker/build-extensions.sh /directus/docker/
RUN chmod +x /directus/docker/build-extensions.sh

# -----------------------------------------------------------------------------
# 3. Build base extensions (sentry, memory-stats from base/)
# -----------------------------------------------------------------------------
COPY --chown=node:node base/extensions/local /tmp/base-extensions/
RUN /directus/docker/build-extensions.sh /tmp/base-extensions && \
    rm -rf /tmp/base-extensions

# -----------------------------------------------------------------------------
# 4. Build project-specific local extensions
# -----------------------------------------------------------------------------
COPY --chown=node:node extensions/local* /tmp/project-extensions/
COPY --chown=node:node extensions/shared* /directus/shared/
RUN /directus/docker/build-extensions.sh /tmp/project-extensions && \
    rm -rf /tmp/project-extensions /directus/shared

# -----------------------------------------------------------------------------
# 5. Copy runtime scripts (from base/)
# -----------------------------------------------------------------------------
COPY --chown=node:node base/docker/entrypoint.sh /directus/docker/
COPY --chown=node:node base/docker/sentry-preload.cjs /directus/docker/
RUN chmod +x /directus/docker/entrypoint.sh

# -----------------------------------------------------------------------------
# 6. Copy project-specific configuration and templates
# -----------------------------------------------------------------------------
COPY --chown=node:node config.dev.yaml config.live.yaml /directus/
COPY --chown=node:node email-templates /directus/email-templates
COPY --chown=node:node snapshots /directus/snapshots

# Write PROJECT_VERSION for Sentry tagging
ARG PROJECT_VERSION
RUN echo "${PROJECT_VERSION}" > /directus/PROJECT_VERSION

# -----------------------------------------------------------------------------
# 7. Health check and expose
# -----------------------------------------------------------------------------
HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=30 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8055/server/health || exit 1

EXPOSE 8055

ENTRYPOINT ["/directus/docker/entrypoint.sh"]
CMD ["start"]
