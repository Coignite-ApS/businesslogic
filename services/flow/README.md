# BusinessLogic Flow Engine

Ultra-fast workflow orchestration engine built in Rust for [businesslogic.online](https://businesslogic.online).

## Quick Start

```sh
# Start local PostgreSQL + Redis
docker compose -f docker/docker-compose.dev.yml up -d

# Run database migrations
psql postgres://flow:flow@localhost:5432/flow -f migrations/001_init.sql

# Build
cargo build

# Run tests
cargo test --workspace

# Start trigger service
cargo run --bin flow-trigger

# Start worker (in another terminal)
cargo run --bin flow-worker
```

## Architecture

The engine uses a DAG-based execution model with Redis Streams for job distribution:

1. **Trigger service** receives webhooks/cron/DB events and enqueues execution messages
2. **Workers** consume messages from priority streams and execute flows
3. **Nodes** are executed in topological order with parallel branch support

Three node tiers: Core (compiled Rust), WASM (Wasmtime sandbox), External (HTTP/gRPC).

## Project Structure

```
crates/
  flow-common/     Shared types and message formats
  flow-engine/     DAG executor, node registry, plugin host
  flow-trigger/    HTTP trigger service (Axum)
  flow-worker/     Redis Streams consumer
docker/            Container setup (dev + prod)
migrations/        PostgreSQL schema
```

## License

GPL-3.0
