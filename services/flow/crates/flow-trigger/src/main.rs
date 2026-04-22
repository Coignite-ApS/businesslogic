//! Trigger service for BusinessLogic flows.
//!
//! Handles webhook invocations (with HMAC-SHA256 verification), cron scheduling,
//! DB event triggers, rate limiting, admin auth, flow validation API, node types API,
//! and execution status API. Enqueues ExecuteMessages to Redis Streams for workers.

mod rate_limit;

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, Sse},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use cron::Schedule;
use flow_common::flow::{FlowGraph, Priority};
use flow_common::message::ExecuteMessage;
use flow_common::node::RequiredRole;
use flow_engine::nodes::NodeRegistry;
use flow_engine::validation::validate_flow_permissions;
use hmac::{Hmac, Mac};
use rate_limit::RateLimitError;
#[allow(unused_imports)]
use redis::AsyncCommands;
use sha2::Sha256;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio_stream::StreamExt;
use opentelemetry::trace::TracerProvider as _;
use tracing::{error, info, warn};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// JSON error response helper.
fn json_error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": message.into() })))
}

/// Maximum webhook body size (configurable via WEBHOOK_BODY_LIMIT_BYTES, default 1MB).
const DEFAULT_BODY_LIMIT: usize = 1_048_576;

/// Application state shared across handlers.
#[derive(Clone)]
struct AppState {
    redis_pool: deadpool_redis::Pool,
    postgres_pool: sqlx::postgres::PgPool,
    started_at: chrono::DateTime<Utc>,
    requests_total: Arc<AtomicU64>,
    admin_token: Option<String>,
    node_registry: Arc<NodeRegistry>,
    rps_limit: u64,
    monthly_limit: u64,
}

/// Health check response.
#[derive(serde::Serialize)]
struct HealthResponse {
    status: String,
    uptime_secs: i64,
    redis_connected: bool,
    postgres_connected: bool,
    requests_total: u64,
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let env_filter = tracing_subscriber::EnvFilter::from_default_env()
        .add_directive(tracing::Level::INFO.into());
    let fmt_layer = tracing_subscriber::fmt::layer().with_writer(std::io::stdout);

    // Add OTel layer if OTEL_EXPORTER_OTLP_ENDPOINT is set
    let _otel_guard: Option<opentelemetry_sdk::trace::TracerProvider>;
    if std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").is_ok()
        || std::env::var("OTEL_ENABLED").ok().as_deref() == Some("true")
    {
        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_http()
            .build()?;
        let provider = opentelemetry_sdk::trace::TracerProvider::builder()
            .with_batch_exporter(exporter, opentelemetry_sdk::runtime::Tokio)
            .with_resource(opentelemetry_sdk::Resource::new(vec![
                opentelemetry::KeyValue::new("service.name", "bl-flow-trigger"),
            ]))
            .build();
        let tracer = provider.tracer("flow-trigger");
        let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .with(otel_layer)
            .init();
        info!("[otel] tracing enabled");
        _otel_guard = Some(provider);
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .init();
        _otel_guard = None;
    }

    info!("Starting BusinessLogic Flow Trigger Service");

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost".to_string());
    let postgres_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/flow".to_string());
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3100".to_string())
        .parse::<u16>()?;
    let db_pool_size: u32 = std::env::var("DATABASE_POOL_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    let body_limit: usize = std::env::var("WEBHOOK_BODY_LIMIT_BYTES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_BODY_LIMIT);
    let admin_token = std::env::var("ADMIN_TOKEN").ok();
    let rps_limit: u64 = std::env::var("RATE_LIMIT_RPS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50);
    let monthly_limit: u64 = std::env::var("RATE_LIMIT_MONTHLY")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(100_000);

    // Validate critical secrets
    let skip_validation = std::env::var("SKIP_SECRET_VALIDATION")
        .ok()
        .map(|v| v == "true")
        .unwrap_or(false);

    let mut missing_secrets = Vec::new();
    if admin_token.is_none() {
        missing_secrets.push("ADMIN_TOKEN");
    }

    if !missing_secrets.is_empty() {
        if skip_validation {
            warn!(
                "SKIP_SECRET_VALIDATION=true — missing secrets ignored: {}",
                missing_secrets.join(", ")
            );
        } else {
            error!(
                "FATAL: missing required secrets: {}. Set them or use SKIP_SECRET_VALIDATION=true for local dev",
                missing_secrets.join(", ")
            );
            std::process::exit(1);
        }
    }

    // Initialize Redis connection pool
    let cfg = deadpool_redis::Config::from_url(&redis_url);
    let redis_pool = cfg.create_pool(Some(deadpool_redis::Runtime::Tokio1))?;

    // Test Redis connection
    match redis_pool.get().await {
        Ok(mut conn) => match redis::cmd("PING")
            .query_async::<String>(&mut *conn)
            .await
        {
            Ok(pong) => info!("Redis connected: {}", pong),
            Err(e) => error!("Redis PING failed: {}", e),
        },
        Err(e) => error!("Failed to get Redis connection: {}", e),
    }

    // Initialize PostgreSQL connection pool (M2: configurable pool size)
    let postgres_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(db_pool_size)
        .connect(&postgres_url)
        .await?;

    info!("PostgreSQL connected (pool_size={})", db_pool_size);

    // Build node registry (with pools for metadata; trigger doesn't execute nodes)
    let node_registry = Arc::new(NodeRegistry::with_pools(None, None));

    let state = AppState {
        redis_pool: redis_pool.clone(),
        postgres_pool,
        started_at: Utc::now(),
        requests_total: Arc::new(AtomicU64::new(0)),
        admin_token,
        node_registry,
        rps_limit,
        monthly_limit,
    };

    // Create consumer groups — H5: fail hard on non-BUSYGROUP errors
    ensure_consumer_groups(&redis_pool).await?;

    // Start background tasks
    let state_clone = state.clone();
    tokio::spawn(cron_scheduler_task(state_clone));

    let state_clone = state.clone();
    tokio::spawn(database_listener_task(state_clone));

    let state_clone = state.clone();
    tokio::spawn(health_push_task(state_clone));

    // Build router (C5: body size limit on webhook endpoints)
    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/ping", get(handle_ping))
        .route("/webhook/{flow_id}", post(handle_webhook))
        .route("/trigger/{flow_id}", post(handle_trigger))
        // Execution status API
        .route("/executions/{execution_id}", get(handle_get_execution))
        .route(
            "/flows/{flow_id}/executions",
            get(handle_list_executions),
        )
        .route(
            "/executions/{execution_id}/stream",
            get(handle_execution_stream),
        )
        // Admin-auth management endpoints
        .route("/flows/validate", post(handle_validate_flow))
        .route("/node-types", get(handle_node_types))
        // Internal API: local embedding (for bl-ai-api local-embeddings client)
        .route("/internal/embed", post(handle_internal_embed))
        .layer(DefaultBodyLimit::max(body_limit))
        .with_state(state);

    info!("Webhook body limit: {} bytes", body_limit);

    // Start server
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("Listening on {}", addr);

    let server = axum::serve(listener, app);

    let shutdown_signal = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    };

    server.with_graceful_shutdown(shutdown_signal).await?;

    info!("Trigger service shut down gracefully");
    Ok(())
}

// ─── Admin Auth ─────────────────────────────────────────────────────────────

/// Verify X-Admin-Token header. Returns Err(401) if invalid/missing.
fn verify_admin_token(
    headers: &HeaderMap,
    expected: &Option<String>,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let Some(expected_token) = expected else {
        // No token configured — allow (dev mode)
        return Ok(());
    };

    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            json_error(StatusCode::UNAUTHORIZED, "missing X-Admin-Token header")
        })?;

    // Constant-time comparison
    if !constant_time_eq(provided.as_bytes(), expected_token.as_bytes()) {
        return Err(json_error(StatusCode::UNAUTHORIZED, "invalid admin token"));
    }

    Ok(())
}

/// Constant-time byte comparison.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

// ─── Consumer Groups ─────────────────────────────────────────────────────────

/// Ensure Redis consumer groups exist.
/// H5: Only ignores BUSYGROUP (already exists). Other errors are fatal at startup.
async fn ensure_consumer_groups(pool: &deadpool_redis::Pool) -> Result<(), anyhow::Error> {
    let streams = [
        "flow:execute:critical",
        "flow:execute:normal",
        "flow:execute:batch",
    ];

    let mut conn = pool.get().await?;
    for stream in &streams {
        let result: Result<String, _> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(*stream)
            .arg("workers")
            .arg("0")
            .arg("MKSTREAM")
            .query_async(&mut *conn)
            .await;

        match result {
            Ok(_) => info!("Created consumer group for {}", stream),
            Err(e) => {
                if e.to_string().contains("BUSYGROUP") {
                    // Already exists — expected
                } else {
                    return Err(anyhow::anyhow!(
                        "Failed to create consumer group for {}: {}",
                        stream,
                        e
                    ));
                }
            }
        }
    }
    Ok(())
}

// ─── Health ──────────────────────────────────────────────────────────────────

/// GET /health
async fn handle_health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let redis_connected = match state.redis_pool.get().await {
        Ok(mut conn) => redis::cmd("PING")
            .query_async::<String>(&mut *conn)
            .await
            .is_ok(),
        Err(_) => false,
    };

    let postgres_connected = sqlx::query("SELECT 1")
        .fetch_optional(&state.postgres_pool)
        .await
        .map(|r| r.is_some())
        .unwrap_or(false);

    let uptime_secs = (Utc::now() - state.started_at).num_seconds();

    let response = HealthResponse {
        status: "ok".to_string(),
        uptime_secs,
        redis_connected,
        postgres_connected,
        requests_total: state.requests_total.load(Ordering::Relaxed),
    };

    (StatusCode::OK, Json(response))
}

/// GET /ping
async fn handle_ping() -> &'static str {
    "pong"
}

// ─── Flow Validation (DB) ───────────────────────────────────────────────────

/// Look up flow account_id, priority, and optional webhook secret.
async fn validate_flow(
    pool: &sqlx::postgres::PgPool,
    flow_id: &Uuid,
) -> Result<FlowValidation, (StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query_as::<_, FlowValidation>(
        "SELECT account_id,
                COALESCE(settings->'priority', '\"normal\"'::jsonb) as priority,
                trigger_config->>'secret' as webhook_secret
         FROM bl_flows WHERE id = $1 AND status = 'active'",
    )
    .bind(flow_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("DB error validating flow: {}", e);
        json_error(StatusCode::INTERNAL_SERVER_ERROR, "database error")
    })?
    .ok_or_else(|| {
        json_error(StatusCode::NOT_FOUND, format!("flow not found or not active: {}", flow_id))
    })?;

    Ok(row)
}

#[derive(sqlx::FromRow)]
struct FlowValidation {
    account_id: Uuid,
    priority: serde_json::Value,
    webhook_secret: Option<String>,
}

// ─── Webhook HMAC-SHA256 Verification ───────────────────────────────────────

/// Verify HMAC-SHA256 webhook signature.
/// Format: X-Signature: sha256=<hex>, X-Timestamp: <unix epoch seconds>
fn verify_webhook_signature(
    headers: &HeaderMap,
    body: &str,
    secret: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let sig_header = headers
        .get("x-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            json_error(StatusCode::UNAUTHORIZED, "missing X-Signature header")
        })?;

    let timestamp = headers
        .get("x-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            json_error(StatusCode::UNAUTHORIZED, "missing X-Timestamp header")
        })?;

    // Reject if timestamp is >5 min old
    let ts: i64 = timestamp.parse().map_err(|_| {
        json_error(StatusCode::BAD_REQUEST, "invalid X-Timestamp")
    })?;
    let now = Utc::now().timestamp();
    if (now - ts).unsigned_abs() > 300 {
        return Err(json_error(StatusCode::UNAUTHORIZED, "timestamp expired (>5min)"));
    }

    // Expect "sha256=<hex>"
    let hex_sig = sig_header.strip_prefix("sha256=").ok_or_else(|| {
        json_error(StatusCode::BAD_REQUEST, "X-Signature must start with sha256=")
    })?;

    let expected_sig = hex::decode(hex_sig).map_err(|_| {
        json_error(StatusCode::BAD_REQUEST, "invalid hex in X-Signature")
    })?;

    // Compute HMAC-SHA256(timestamp + "." + body, secret)
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "hmac error"))?;
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body.as_bytes());

    mac.verify_slice(&expected_sig).map_err(|_| {
        json_error(StatusCode::UNAUTHORIZED, "invalid signature")
    })
}

// ─── Webhook / Trigger Handlers ──────────────────────────────────────────────

/// POST /webhook/{flow_id}
async fn handle_webhook(
    Path(flow_id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let flow_id = Uuid::parse_str(&flow_id)
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, format!("Invalid flow ID: {}", e)))?;

    // Validate flow exists and is active, get account_id + webhook secret
    let flow_info = validate_flow(&state.postgres_pool, &flow_id).await?;

    // HMAC signature verification
    if let Some(ref secret) = flow_info.webhook_secret {
        verify_webhook_signature(&headers, &body, secret)?;
    } else {
        warn!("Webhook flow {} has no secret configured", flow_id);
    }

    let priority: Priority =
        serde_json::from_value(flow_info.priority).unwrap_or(Priority::Normal);

    // Rate limiting
    check_rate_limit_or_reject(
        &state.redis_pool,
        &flow_info.account_id,
        state.rps_limit,
        state.monthly_limit,
    )
    .await?;

    // Parse trigger data
    let trigger_data: serde_json::Value = serde_json::from_str(&body)
        .unwrap_or_else(|_| serde_json::json!({"raw": body}));

    let execution_id = Uuid::new_v4();
    let message = ExecuteMessage {
        execution_id,
        flow_id,
        account_id: flow_info.account_id,
        trigger_data,
        priority,
        created_at: Utc::now(),
    };

    enqueue_execution(&state.redis_pool, &message)
        .await
        .map_err(|e| {
            error!("Failed to enqueue execution: {}", e);
            json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to enqueue: {}", e))
        })?;

    state.requests_total.fetch_add(1, Ordering::Relaxed);

    info!(
        "Webhook enqueued: flow_id={}, execution_id={}",
        flow_id, execution_id
    );

    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "execution_id": execution_id,
            "status": "enqueued"
        })),
    ))
}

/// POST /trigger/{flow_id}
async fn handle_trigger(
    Path(flow_id): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let flow_id = Uuid::parse_str(&flow_id)
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, format!("Invalid flow ID: {}", e)))?;

    // Validate flow exists and is active, get account_id
    let flow_info = validate_flow(&state.postgres_pool, &flow_id).await?;

    let priority: Priority =
        serde_json::from_value(flow_info.priority).unwrap_or(Priority::Normal);

    // Rate limiting
    check_rate_limit_or_reject(
        &state.redis_pool,
        &flow_info.account_id,
        state.rps_limit,
        state.monthly_limit,
    )
    .await?;

    let execution_id = Uuid::new_v4();
    let message = ExecuteMessage {
        execution_id,
        flow_id,
        account_id: flow_info.account_id,
        trigger_data: payload,
        priority,
        created_at: Utc::now(),
    };

    enqueue_execution(&state.redis_pool, &message)
        .await
        .map_err(|e| {
            error!("Failed to enqueue execution: {}", e);
            json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to enqueue: {}", e))
        })?;

    state.requests_total.fetch_add(1, Ordering::Relaxed);

    info!(
        "Manual trigger enqueued: flow_id={}, execution_id={}",
        flow_id, execution_id
    );

    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "execution_id": execution_id,
            "status": "enqueued"
        })),
    ))
}

/// Map RateLimitError to HTTP response.
async fn check_rate_limit_or_reject(
    pool: &deadpool_redis::Pool,
    account_id: &Uuid,
    rps_limit: u64,
    monthly_limit: u64,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    match rate_limit::check_rate_limit(pool, account_id, rps_limit, monthly_limit).await {
        Ok(()) => Ok(()),
        Err(RateLimitError::Redis(msg)) => {
            // Fail open on Redis errors — don't block requests
            warn!("Rate limit Redis error (failing open): {}", msg);
            Ok(())
        }
        Err(e) => Err(json_error(StatusCode::TOO_MANY_REQUESTS, e.to_string())),
    }
}

// ─── Flow Validation Endpoint (D5) ─────────────────────────────────────────

#[derive(serde::Deserialize)]
struct ValidateFlowRequest {
    graph: FlowGraph,
    #[serde(default = "default_caller_role")]
    caller_role: RequiredRole,
}

fn default_caller_role() -> RequiredRole {
    RequiredRole::Admin
}

/// POST /flows/validate (admin-auth)
async fn handle_validate_flow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ValidateFlowRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    verify_admin_token(&headers, &state.admin_token)?;

    let mut warnings = Vec::<String>::new();
    let mut errors = Vec::<String>::new();

    // DAG cycle detection
    match flow_engine::dag::ExecutionDag::build(&payload.graph) {
        Ok(_) => {}
        Err(e) => errors.push(format!("DAG error: {}", e)),
    }

    // Node permission validation
    match validate_flow_permissions(&payload.graph, &state.node_registry, &payload.caller_role) {
        Ok(()) => {}
        Err(perm_errors) => errors.extend(perm_errors),
    }

    // Build node_permissions map
    let mut node_permissions = serde_json::Map::new();
    for node in &payload.graph.nodes {
        if let Some(meta) = state.node_registry.get_metadata(&node.node_type) {
            let role_str = serde_json::to_string(&meta.required_role)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            node_permissions.insert(node.node_type.clone(), serde_json::json!(role_str));
        } else {
            warnings.push(format!("unknown node type: {}", node.node_type));
        }
    }

    Ok(Json(serde_json::json!({
        "valid": errors.is_empty(),
        "errors": errors,
        "warnings": warnings,
        "node_permissions": node_permissions,
    })))
}

// ─── Node Types API (D6) ────────────────────────────────────────────────────

/// GET /node-types (admin-auth)
async fn handle_node_types(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    verify_admin_token(&headers, &state.admin_token)?;

    let node_types: Vec<serde_json::Value> = state
        .node_registry
        .all_metadata()
        .iter()
        .map(|meta| {
            serde_json::json!({
                "id": meta.id,
                "name": meta.name,
                "description": meta.description,
                "category": meta.category,
                "tier": meta.tier,
                "required_role": meta.required_role,
                "config_schema": meta.config_schema,
                "inputs": meta.inputs.iter().map(|p| serde_json::json!({
                    "name": p.name,
                    "data_type": p.data_type,
                    "required": p.required,
                })).collect::<Vec<_>>(),
                "outputs": meta.outputs.iter().map(|p| serde_json::json!({
                    "name": p.name,
                    "data_type": p.data_type,
                    "required": p.required,
                })).collect::<Vec<_>>(),
                "estimated_cost_usd": meta.estimated_cost_usd,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(node_types)))
}

// ─── Internal Embedding API ──────────────────────────────────────────────────

/// POST /internal/embed (admin-auth)
/// Direct access to the fastembed embedding model for bl-ai-api.
async fn handle_internal_embed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    verify_admin_token(&headers, &state.admin_token)?;

    let texts = body
        .get("texts")
        .and_then(|v| v.as_array())
        .ok_or_else(|| json_error(StatusCode::BAD_REQUEST, "Missing 'texts' array"))?;

    let text_strings: Vec<String> = texts
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();

    if text_strings.is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "No valid text strings in 'texts'"));
    }

    // Use the embedding node handler directly
    let input = flow_common::node::NodeInput::new(
        serde_json::json!({"input": text_strings}),
        serde_json::json!({}),
        serde_json::json!({}),
    );

    let result = state
        .node_registry
        .execute("core:embedding", input)
        .await
        .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Embed failed: {}", e)))?;

    Ok(Json(result.data))
}

// ─── Execution Status API ────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct ExecutionQuery {
    include: Option<String>,
    account_id: Option<Uuid>,
}

/// GET /executions/{execution_id}
async fn handle_get_execution(
    Path(execution_id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ExecutionQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let execution_id = Uuid::parse_str(&execution_id)
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, format!("Invalid execution ID: {}", e)))?;

    let include_context = query.include.as_deref() == Some("context");

    let row = sqlx::query_as::<_, ExecutionRow>(
        "SELECT id, flow_id, account_id, status, trigger_data, context, result, error,
                duration_ms, nodes_executed, cost_usd, worker_id, started_at
         FROM bl_flow_executions WHERE id = $1",
    )
    .bind(execution_id)
    .fetch_optional(&state.postgres_pool)
    .await
    .map_err(|e| {
        error!("DB error fetching execution: {}", e);
        json_error(StatusCode::INTERNAL_SERVER_ERROR, "database error")
    })?
    .ok_or_else(|| {
        json_error(StatusCode::NOT_FOUND, format!("execution not found: {}", execution_id))
    })?;

    // Account scoping: if account_id provided, verify match
    if let Some(account_id) = query.account_id {
        if row.account_id != account_id {
            return Err(json_error(StatusCode::NOT_FOUND, format!("execution not found: {}", execution_id)));
        }
    }

    let mut response = serde_json::json!({
        "id": row.id,
        "flow_id": row.flow_id,
        "account_id": row.account_id,
        "status": row.status,
        "error": row.error,
        "duration_ms": row.duration_ms,
        "nodes_executed": row.nodes_executed,
        "cost_usd": row.cost_usd,
        "worker_id": row.worker_id,
        "started_at": row.started_at,
    });

    if include_context {
        response["context"] = row.context;
        response["trigger_data"] = row.trigger_data;
        response["result"] = row.result;
    }

    Ok(Json(response))
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct ExecutionRow {
    id: Uuid,
    flow_id: Uuid,
    account_id: Uuid,
    status: String,
    trigger_data: serde_json::Value,
    context: serde_json::Value,
    result: serde_json::Value,
    error: Option<String>,
    duration_ms: i64,
    nodes_executed: i32,
    cost_usd: f64,
    worker_id: Option<Uuid>,
    started_at: chrono::DateTime<Utc>,
}

#[derive(serde::Deserialize)]
struct ListExecutionsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    status: Option<String>,
    account_id: Option<Uuid>,
}

/// GET /flows/{flow_id}/executions
async fn handle_list_executions(
    Path(flow_id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ListExecutionsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let flow_id = Uuid::parse_str(&flow_id)
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, format!("Invalid flow ID: {}", e)))?;

    let limit = query.limit.unwrap_or(20).min(100);
    let offset = query.offset.unwrap_or(0);

    // Build query with optional account_id + status filters
    let rows = match (&query.account_id, &query.status) {
        (Some(account_id), Some(status)) => {
            sqlx::query_as::<_, ExecutionSummaryRow>(
                "SELECT id, status, error, duration_ms, nodes_executed, cost_usd, started_at
                 FROM bl_flow_executions
                 WHERE flow_id = $1 AND account_id = $2 AND status = $3
                 ORDER BY started_at DESC
                 LIMIT $4 OFFSET $5",
            )
            .bind(flow_id)
            .bind(account_id)
            .bind(status)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.postgres_pool)
            .await
        }
        (Some(account_id), None) => {
            sqlx::query_as::<_, ExecutionSummaryRow>(
                "SELECT id, status, error, duration_ms, nodes_executed, cost_usd, started_at
                 FROM bl_flow_executions
                 WHERE flow_id = $1 AND account_id = $2
                 ORDER BY started_at DESC
                 LIMIT $3 OFFSET $4",
            )
            .bind(flow_id)
            .bind(account_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.postgres_pool)
            .await
        }
        (None, Some(status)) => {
            sqlx::query_as::<_, ExecutionSummaryRow>(
                "SELECT id, status, error, duration_ms, nodes_executed, cost_usd, started_at
                 FROM bl_flow_executions
                 WHERE flow_id = $1 AND status = $2
                 ORDER BY started_at DESC
                 LIMIT $3 OFFSET $4",
            )
            .bind(flow_id)
            .bind(status)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.postgres_pool)
            .await
        }
        (None, None) => {
            sqlx::query_as::<_, ExecutionSummaryRow>(
                "SELECT id, status, error, duration_ms, nodes_executed, cost_usd, started_at
                 FROM bl_flow_executions
                 WHERE flow_id = $1
                 ORDER BY started_at DESC
                 LIMIT $2 OFFSET $3",
            )
            .bind(flow_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.postgres_pool)
            .await
        }
    };

    let rows = rows.map_err(|e| {
        error!("DB error listing executions: {}", e);
        json_error(StatusCode::INTERNAL_SERVER_ERROR, "database error")
    })?;

    let executions: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "status": r.status,
                "error": r.error,
                "duration_ms": r.duration_ms,
                "nodes_executed": r.nodes_executed,
                "cost_usd": r.cost_usd,
                "started_at": r.started_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "flow_id": flow_id,
        "executions": executions,
        "limit": limit,
        "offset": offset,
    })))
}

#[derive(sqlx::FromRow)]
struct ExecutionSummaryRow {
    id: Uuid,
    status: String,
    error: Option<String>,
    duration_ms: i64,
    nodes_executed: i32,
    cost_usd: f64,
    started_at: chrono::DateTime<Utc>,
}

/// GET /executions/{execution_id}/stream — SSE endpoint
async fn handle_execution_stream(
    Path(execution_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>>, (StatusCode, Json<serde_json::Value>)>
{
    let execution_id = Uuid::parse_str(&execution_id)
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, format!("Invalid execution ID: {}", e)))?;

    // Look up flow_id for this execution
    let flow_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT flow_id FROM bl_flow_executions WHERE id = $1",
    )
    .bind(execution_id)
    .fetch_optional(&state.postgres_pool)
    .await
    .map_err(|e| {
        error!("DB error looking up execution: {}", e);
        json_error(StatusCode::INTERNAL_SERVER_ERROR, "database error")
    })?;

    let flow_id = flow_id.ok_or_else(|| {
        json_error(StatusCode::NOT_FOUND, format!("execution not found: {}", execution_id))
    })?;

    // Subscribe to Redis PubSub for this flow's events
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost".to_string());
    let client = redis::Client::open(redis_url).map_err(|e| {
        error!("Redis client error: {}", e);
        json_error(StatusCode::INTERNAL_SERVER_ERROR, "redis error")
    })?;

    let mut pubsub = client.get_async_pubsub().await.map_err(|e| {
        error!("Redis PubSub error: {}", e);
        json_error(StatusCode::INTERNAL_SERVER_ERROR, "redis pubsub error")
    })?;

    let channel = format!("flow:events:{}", flow_id);
    pubsub.subscribe(&channel).await.map_err(|e| {
        error!("Redis subscribe error: {}", e);
        json_error(StatusCode::INTERNAL_SERVER_ERROR, "redis subscribe error")
    })?;

    let stream = pubsub.into_on_message();

    // Filter events for this execution_id, auto-close on terminal events
    let exec_id_str = execution_id.to_string();
    let sse_stream = stream
        .filter_map(move |msg| {
            let payload: String = msg.get_payload().unwrap_or_default();
            // Filter: only events for this execution
            if payload.contains(&exec_id_str) {
                Some(Ok(Event::default().data(payload.clone())))
            } else {
                None
            }
        })
        .take_while(|event| {
            // Auto-close on completed/failed events
            if let Ok(e) = event {
                let data = format!("{:?}", e);
                !data.contains("\"completed\"") && !data.contains("\"failed\"")
            } else {
                true
            }
        });

    // 5 min timeout
    let timeout_stream = tokio_stream::StreamExt::timeout(sse_stream, std::time::Duration::from_secs(300))
        .map(|result| match result {
            Ok(inner) => inner,
            Err(_) => Ok(Event::default().data("{\"event\":\"timeout\"}")),
        })
        .take_while(|event| {
            if let Ok(e) = event {
                let data = format!("{:?}", e);
                !data.contains("timeout")
            } else {
                true
            }
        });

    Ok(Sse::new(timeout_stream))
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

/// Enqueue an execution message to Redis Streams.
/// C3: Priority field is serialized into Redis fields for round-trip.
async fn enqueue_execution(
    pool: &deadpool_redis::Pool,
    message: &ExecuteMessage,
) -> Result<String, anyhow::Error> {
    let mut conn = pool.get().await?;

    let stream_key = message.priority.stream_key();
    let fields = message.to_redis_fields();

    // Build XADD command with field pairs
    let mut cmd = redis::cmd("XADD");
    cmd.arg(stream_key).arg("*");
    for (k, v) in &fields {
        cmd.arg(k).arg(v);
    }

    let id: String = cmd.query_async(&mut *conn).await?;
    Ok(id)
}

// ─── Cron Scheduler ──────────────────────────────────────────────────────────

/// Background task: Cron scheduler.
/// Loads cron flows from PG, fires them on schedule with Redis SETNX dedup.
async fn cron_scheduler_task(state: AppState) {
    info!("Cron scheduler task started");

    loop {
        match run_cron_cycle(&state).await {
            Ok(fired) => {
                if fired > 0 {
                    info!("Cron cycle: fired {} jobs", fired);
                }
            }
            Err(e) => {
                warn!("Cron cycle error: {}", e);
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
    }
}

async fn run_cron_cycle(state: &AppState) -> Result<usize, anyhow::Error> {
    // Load active cron flows
    let rows = sqlx::query_as::<_, CronFlowRow>(
        "SELECT id, account_id, trigger_config, COALESCE(settings->'priority', '\"normal\"'::jsonb) as priority
         FROM bl_flows
         WHERE status = 'active' AND trigger_config->>'type' = 'cron'",
    )
    .fetch_all(&state.postgres_pool)
    .await?;

    let now = Utc::now();
    let mut fired = 0;

    for row in &rows {
        let cron_expr = row
            .trigger_config
            .get("cron_expression")
            .and_then(|v| v.as_str());

        let Some(cron_expr) = cron_expr else {
            warn!("Flow {} has cron trigger but no cron_expression", row.id);
            continue;
        };

        let schedule = match Schedule::from_str(cron_expr) {
            Ok(s) => s,
            Err(e) => {
                warn!("Flow {} invalid cron expression '{}': {}", row.id, cron_expr, e);
                continue;
            }
        };

        // Check if this minute is a scheduled fire time
        let minute_ts = now.format("%Y%m%d%H%M").to_string();

        // Check if any upcoming time falls within this minute
        let should_fire = schedule
            .upcoming(chrono::Utc)
            .take(1)
            .next()
            .map(|next| {
                // Fire if next occurrence is within 60s
                (next - now).num_seconds() < 60
            })
            .unwrap_or(false);

        if !should_fire {
            continue;
        }

        // SETNX dedup lock
        let lock_key = format!("flow:cron_lock:{}:{}", row.id, minute_ts);
        let mut conn = state.redis_pool.get().await?;
        let acquired: bool = redis::cmd("SET")
            .arg(&lock_key)
            .arg("1")
            .arg("NX")
            .arg("EX")
            .arg(120)
            .query_async(&mut *conn)
            .await
            .unwrap_or(false);

        if !acquired {
            continue; // Another instance already fired this
        }

        let priority: Priority =
            serde_json::from_value(row.priority.clone()).unwrap_or(Priority::Normal);

        let execution_id = Uuid::new_v4();
        let message = ExecuteMessage {
            execution_id,
            flow_id: row.id,
            account_id: row.account_id,
            trigger_data: serde_json::json!({
                "type": "cron",
                "cron_expression": cron_expr,
                "fired_at": now.to_rfc3339(),
            }),
            priority,
            created_at: now,
        };

        match enqueue_execution(&state.redis_pool, &message).await {
            Ok(_) => {
                info!("Cron fired: flow_id={}, execution_id={}", row.id, execution_id);
                fired += 1;
            }
            Err(e) => {
                error!("Cron enqueue failed for flow_id={}: {}", row.id, e);
            }
        }
    }

    Ok(fired)
}

#[derive(sqlx::FromRow)]
struct CronFlowRow {
    id: Uuid,
    account_id: Uuid,
    trigger_config: serde_json::Value,
    priority: serde_json::Value,
}

// ─── Database Event Listener ─────────────────────────────────────────────────

/// Background task: Listens for PostgreSQL NOTIFY events on bl_flow_events.
async fn database_listener_task(state: AppState) {
    info!("Database event listener started");

    loop {
        match run_db_listener(&state).await {
            Ok(()) => {
                info!("DB listener disconnected, reconnecting...");
            }
            Err(e) => {
                error!("DB listener error: {}", e);
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

async fn run_db_listener(state: &AppState) -> Result<(), anyhow::Error> {
    let postgres_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/flow".to_string());

    // Dedicated connection (not from pool) for LISTEN
    let mut listener = sqlx::postgres::PgListener::connect(&postgres_url).await?;
    listener.listen("bl_flow_events").await?;
    info!("LISTEN bl_flow_events active");

    // Load DB event flows into lookup
    let mut flow_lookup = load_db_event_flows(state).await?;
    let mut last_refresh = Utc::now();

    loop {
        // Listen with timeout to allow periodic refresh
        let notification = tokio::time::timeout(
            tokio::time::Duration::from_secs(60),
            listener.recv(),
        )
        .await;

        // Refresh lookup every 60s
        if (Utc::now() - last_refresh).num_seconds() >= 60 {
            match load_db_event_flows(state).await {
                Ok(new_lookup) => {
                    flow_lookup = new_lookup;
                    last_refresh = Utc::now();
                }
                Err(e) => warn!("Failed to refresh DB event flows: {}", e),
            }
        }

        let notification = match notification {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(e.into()),
            Err(_) => continue, // Timeout — loop for refresh
        };

        // Parse notification payload
        let payload: serde_json::Value = match serde_json::from_str(notification.payload()) {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to parse DB event payload: {}", e);
                continue;
            }
        };

        let collection = payload
            .get("collection")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let event = payload
            .get("event")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Match collection to flows
        if let Some(flows) = flow_lookup.get(collection) {
            for flow_match in flows {
                // Check event filter if specified
                if let Some(ref events) = flow_match.events {
                    if !events.contains(&event.to_string()) {
                        continue;
                    }
                }

                let execution_id = Uuid::new_v4();
                let message = ExecuteMessage {
                    execution_id,
                    flow_id: flow_match.flow_id,
                    account_id: flow_match.account_id,
                    trigger_data: serde_json::json!({
                        "type": "db_event",
                        "collection": collection,
                        "event": event,
                        "keys": payload.get("keys"),
                    }),
                    priority: flow_match.priority.clone(),
                    created_at: Utc::now(),
                };

                match enqueue_execution(&state.redis_pool, &message).await {
                    Ok(_) => {
                        info!(
                            "DB event triggered: flow_id={}, collection={}, event={}",
                            flow_match.flow_id, collection, event
                        );
                    }
                    Err(e) => {
                        error!(
                            "DB event enqueue failed for flow_id={}: {}",
                            flow_match.flow_id, e
                        );
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct FlowMatch {
    flow_id: Uuid,
    account_id: Uuid,
    priority: Priority,
    events: Option<Vec<String>>, // None = all events
}

/// Load db_event flows into a HashMap keyed by collection name.
async fn load_db_event_flows(
    state: &AppState,
) -> Result<HashMap<String, Vec<FlowMatch>>, anyhow::Error> {
    let rows = sqlx::query_as::<_, DbEventFlowRow>(
        "SELECT id, account_id, trigger_config, COALESCE(settings->'priority', '\"normal\"'::jsonb) as priority
         FROM bl_flows
         WHERE status = 'active' AND trigger_config->>'type' = 'db_event'",
    )
    .fetch_all(&state.postgres_pool)
    .await?;

    let mut lookup: HashMap<String, Vec<FlowMatch>> = HashMap::new();

    for row in &rows {
        let collection = row
            .trigger_config
            .get("collection")
            .and_then(|v| v.as_str());

        let Some(collection) = collection else {
            warn!("Flow {} has db_event trigger but no collection", row.id);
            continue;
        };

        let events = row
            .trigger_config
            .get("events")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });

        let priority: Priority =
            serde_json::from_value(row.priority.clone()).unwrap_or(Priority::Normal);

        lookup
            .entry(collection.to_string())
            .or_default()
            .push(FlowMatch {
                flow_id: row.id,
                account_id: row.account_id,
                priority,
                events,
            });
    }

    info!("Loaded {} DB event flow mappings", lookup.len());
    Ok(lookup)
}

#[derive(sqlx::FromRow)]
struct DbEventFlowRow {
    id: Uuid,
    account_id: Uuid,
    trigger_config: serde_json::Value,
    priority: serde_json::Value,
}

// ─── Health Push ─────────────────────────────────────────────────────────────

/// Background task: Health push every 15s with 30s TTL.
async fn health_push_task(state: AppState) {
    info!("Health push task started");
    let instance_id = std::env::var("INSTANCE_ID").unwrap_or_else(|_| "trigger-1".to_string());

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;

        let key = format!("flow:triggers:{}", instance_id);
        let uptime_secs = (Utc::now() - state.started_at).num_seconds();

        let health = serde_json::json!({
            "instance_id": instance_id,
            "timestamp": Utc::now().to_rfc3339(),
            "uptime_secs": uptime_secs,
            "requests_total": state.requests_total.load(Ordering::Relaxed),
        });

        if let Ok(mut conn) = state.redis_pool.get().await {
            let payload = serde_json::to_string(&health).unwrap_or_default();
            let _: Result<(), _> = redis::cmd("SETEX")
                .arg(&key)
                .arg(30)
                .arg(&payload)
                .query_async(&mut *conn)
                .await;
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cron_parse() {
        let schedule = Schedule::from_str("0 */5 * * * *");
        assert!(schedule.is_ok(), "Standard cron expression should parse");

        let schedule = Schedule::from_str("invalid");
        assert!(schedule.is_err(), "Invalid expression should fail");
    }

    #[test]
    fn test_cron_lock_key() {
        let flow_id = Uuid::nil();
        let minute_ts = "202603121530";
        let key = format!("flow:cron_lock:{}:{}", flow_id, minute_ts);
        assert!(key.starts_with("flow:cron_lock:"));
        assert!(key.contains(&flow_id.to_string()));
    }

    #[test]
    fn test_db_event_payload_parse() {
        let payload = r#"{"collection":"items","event":"INSERT","keys":42}"#;
        let parsed: serde_json::Value = serde_json::from_str(payload).unwrap();
        assert_eq!(parsed["collection"], "items");
        assert_eq!(parsed["event"], "INSERT");
        assert_eq!(parsed["keys"], 42);
    }

    #[test]
    fn test_db_event_flow_matching() {
        let mut lookup: HashMap<String, Vec<FlowMatch>> = HashMap::new();
        lookup.entry("items".to_string()).or_default().push(FlowMatch {
            flow_id: Uuid::nil(),
            account_id: Uuid::nil(),
            priority: Priority::Normal,
            events: Some(vec!["INSERT".to_string(), "UPDATE".to_string()]),
        });

        assert!(lookup.contains_key("items"));
        let flows = lookup.get("items").unwrap();
        assert_eq!(flows.len(), 1);
        assert!(flows[0]
            .events
            .as_ref()
            .unwrap()
            .contains(&"INSERT".to_string()));
        assert!(!flows[0]
            .events
            .as_ref()
            .unwrap()
            .contains(&"DELETE".to_string()));
        assert!(!lookup.contains_key("orders"));
    }

    #[test]
    fn test_execution_summary_response() {
        let response = serde_json::json!({
            "flow_id": Uuid::nil(),
            "executions": [],
            "limit": 20,
            "offset": 0,
        });
        assert!(response["executions"].is_array());
        assert_eq!(response["limit"], 20);
    }

    #[test]
    fn test_sse_event_format() {
        let event = serde_json::json!({
            "execution_id": Uuid::nil(),
            "flow_id": Uuid::nil(),
            "event_type": {"completed": {"duration_ms": 100}},
            "timestamp": "2026-03-12T00:00:00Z",
        });
        let serialized = serde_json::to_string(&event).unwrap();
        assert!(serialized.contains("completed"));
    }

    // ─── Admin Auth Tests ────────────────────────────────────────────────────

    #[test]
    fn test_admin_auth_valid_token() {
        let mut headers = HeaderMap::new();
        headers.insert("x-admin-token", "secret123".parse().unwrap());
        let expected = Some("secret123".to_string());
        assert!(verify_admin_token(&headers, &expected).is_ok());
    }

    #[test]
    fn test_admin_auth_bad_token() {
        let mut headers = HeaderMap::new();
        headers.insert("x-admin-token", "wrong".parse().unwrap());
        let expected = Some("secret123".to_string());
        assert!(verify_admin_token(&headers, &expected).is_err());
    }

    #[test]
    fn test_admin_auth_missing_token() {
        let headers = HeaderMap::new();
        let expected = Some("secret123".to_string());
        let result = verify_admin_token(&headers, &expected);
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_admin_auth_no_config() {
        let headers = HeaderMap::new();
        let expected: Option<String> = None;
        assert!(verify_admin_token(&headers, &expected).is_ok());
    }

    // ─── Constant-time Comparison Tests ──────────────────────────────────────

    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq(b"hello", b"hello"));
        assert!(!constant_time_eq(b"hello", b"world"));
        assert!(!constant_time_eq(b"hello", b"hell"));
        assert!(constant_time_eq(b"", b""));
    }

    // ─── Webhook Signature Tests ─────────────────────────────────────────────

    #[test]
    fn test_valid_hmac_signature() {
        let secret = "test-secret";
        let body = r#"{"hello":"world"}"#;
        let timestamp = Utc::now().timestamp().to_string();

        // Compute expected HMAC
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(timestamp.as_bytes());
        mac.update(b".");
        mac.update(body.as_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());

        let mut headers = HeaderMap::new();
        headers.insert("x-signature", format!("sha256={}", sig).parse().unwrap());
        headers.insert("x-timestamp", timestamp.parse().unwrap());

        assert!(verify_webhook_signature(&headers, body, secret).is_ok());
    }

    #[test]
    fn test_invalid_hmac_signature() {
        let timestamp = Utc::now().timestamp().to_string();
        let mut headers = HeaderMap::new();
        headers.insert("x-signature", "sha256=deadbeef".parse().unwrap());
        headers.insert("x-timestamp", timestamp.parse().unwrap());

        let result = verify_webhook_signature(&headers, "body", "secret");
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(msg.0["error"].as_str().unwrap().contains("invalid signature"));
    }

    #[test]
    fn test_missing_signature_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-timestamp", "12345".parse().unwrap());

        let result = verify_webhook_signature(&headers, "body", "secret");
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_expired_timestamp() {
        let old_ts = (Utc::now().timestamp() - 600).to_string(); // 10 min ago
        let mut headers = HeaderMap::new();
        headers.insert("x-signature", "sha256=aabb".parse().unwrap());
        headers.insert("x-timestamp", old_ts.parse().unwrap());

        let result = verify_webhook_signature(&headers, "body", "secret");
        assert!(result.is_err());
        let (_, msg) = result.unwrap_err();
        assert!(msg.0["error"].as_str().unwrap().contains("expired"));
    }

    #[test]
    fn test_node_types_metadata() {
        let registry = NodeRegistry::with_pools(None, None);
        let all = registry.all_metadata();
        assert!(!all.is_empty());

        // Verify database requires admin
        let db_meta = registry.get_metadata("core:database").unwrap();
        assert_eq!(db_meta.required_role, RequiredRole::Admin);

        // Verify noop requires any
        let noop_meta = registry.get_metadata("core:noop").unwrap();
        assert_eq!(noop_meta.required_role, RequiredRole::Any);
    }
}
