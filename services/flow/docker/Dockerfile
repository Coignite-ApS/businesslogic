# Multi-stage build for flow-trigger and flow-worker binaries.
# Target: linux/amd64 (musl) for Alpine-based production images.
#
# Build: docker build -f docker/Dockerfile --target worker -t bl-flow-worker .
#        docker build -f docker/Dockerfile --target trigger -t bl-flow-trigger .

# --- Stage 1: Build ---
FROM rust:alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static git

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/

# Configure cargo to use git CLI for fetching (supports credential helpers)
RUN mkdir -p /root/.cargo && \
    echo '[net]' > /root/.cargo/config.toml && \
    echo 'git-fetch-with-cli = true' >> /root/.cargo/config.toml

# Use GitHub token for private dependencies if provided
RUN --mount=type=secret,id=github_token \
    if [ -f /run/secrets/github_token ]; then \
      TOKEN=$(cat /run/secrets/github_token) && \
      git config --global url."https://${TOKEN}@github.com/".insteadOf "https://github.com/"; \
    fi && \
    cargo build --release --bin flow-trigger --bin flow-worker

# --- Stage 2: Trigger service ---
FROM alpine:3.20 AS trigger

RUN apk add --no-cache ca-certificates && \
    adduser -D -u 1000 appuser

COPY --from=builder /build/target/release/flow-trigger /usr/local/bin/flow-trigger

USER appuser
EXPOSE 3100

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3100/ping || exit 1

ENTRYPOINT ["flow-trigger"]

# --- Stage 3: Worker ---
FROM alpine:3.20 AS worker

RUN apk add --no-cache ca-certificates && \
    adduser -D -u 1000 appuser

COPY --from=builder /build/target/release/flow-worker /usr/local/bin/flow-worker

USER appuser

# Workers don't expose HTTP ports (they pull from Redis)
HEALTHCHECK NONE

ENTRYPOINT ["flow-worker"]
