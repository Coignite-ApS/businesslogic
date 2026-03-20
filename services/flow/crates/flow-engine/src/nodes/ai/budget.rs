//! Budget enforcement — multi-layer cost control for AI nodes.
//!
//! | Layer | Storage | Limit source |
//! |-------|---------|-------------|
//! | 2: Per-flow | ExecutionContext | FlowSettings.budget_limit_usd |
//! | 3: Daily per-account | Redis budget:daily:{acct}:{date} TTL 25h | bl_account_budgets.daily_limit_usd |
//! | 4: Monthly per-account | PG bl_account_budgets.spent_usd | bl_account_budgets.budget_limit_usd |
//! | 5: Global daily | Redis budget:global:{date} TTL 25h | Env AI_DAILY_LIMIT_USD |
//!
//! All layers opt-in: return Ok if pool unavailable.

use chrono::Utc;
use uuid::Uuid;

/// TTL for daily budget keys (25h to handle timezone edge cases).
const DAILY_BUDGET_TTL_SECS: i64 = 90_000;

/// Check all budget layers before an AI call.
/// Returns Ok(()) if all layers pass, Err with the layer that blocked.
pub async fn check_budget(
    pg: Option<&sqlx::PgPool>,
    redis: Option<&deadpool_redis::Pool>,
    account_id: Uuid,
    estimated_cost: f64,
) -> Result<(), anyhow::Error> {
    // Layer 3: Daily per-account (Redis)
    if let Some(pool) = redis {
        if let Ok(mut conn) = pool.get().await {
            let date = Utc::now().format("%Y-%m-%d").to_string();
            let key = format!("budget:daily:{}:{}", account_id, date);

            let spent: f64 = redis::cmd("GET")
                .arg(&key)
                .query_async::<Option<f64>>(&mut *conn)
                .await
                .unwrap_or(None)
                .unwrap_or(0.0);

            // Get daily limit from PG (layer 3 limit source)
            if let Some(pg_pool) = pg {
                let month_start = Utc::now().format("%Y-%m-01").to_string();
                let row: Option<(f64,)> = sqlx::query_as(
                    "SELECT daily_limit_usd FROM bl_account_budgets
                     WHERE account_id = $1 AND month_year = $2::date",
                )
                .bind(account_id)
                .bind(&month_start)
                .fetch_optional(pg_pool)
                .await
                .unwrap_or(None);

                if let Some((daily_limit,)) = row {
                    if spent + estimated_cost > daily_limit {
                        return Err(anyhow::anyhow!(
                            "daily budget exceeded: spent ${:.4} + estimated ${:.4} > limit ${:.2}",
                            spent,
                            estimated_cost,
                            daily_limit
                        ));
                    }
                }
            }
        }
    }

    // Layer 4: Monthly per-account (PG)
    if let Some(pg_pool) = pg {
        let month_start = Utc::now().format("%Y-%m-01").to_string();
        let row: Option<(f64, f64)> = sqlx::query_as(
            "SELECT spent_usd, budget_limit_usd FROM bl_account_budgets
             WHERE account_id = $1 AND month_year = $2::date",
        )
        .bind(account_id)
        .bind(&month_start)
        .fetch_optional(pg_pool)
        .await
        .unwrap_or(None);

        if let Some((spent, limit)) = row {
            if spent + estimated_cost > limit {
                return Err(anyhow::anyhow!(
                    "monthly budget exceeded: spent ${:.4} + estimated ${:.4} > limit ${:.2}",
                    spent,
                    estimated_cost,
                    limit
                ));
            }
        }
    }

    // Layer 5: Global daily (Redis + env var)
    if let Some(pool) = redis {
        if let Ok(global_limit) = std::env::var("AI_DAILY_LIMIT_USD")
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or(())
        {
            if let Ok(mut conn) = pool.get().await {
                let date = Utc::now().format("%Y-%m-%d").to_string();
                let key = format!("budget:global:{}", date);

                let spent: f64 = redis::cmd("GET")
                    .arg(&key)
                    .query_async::<Option<f64>>(&mut *conn)
                    .await
                    .unwrap_or(None)
                    .unwrap_or(0.0);

                if spent + estimated_cost > global_limit {
                    return Err(anyhow::anyhow!(
                        "global daily budget exceeded: spent ${:.4} + estimated ${:.4} > limit ${:.2}",
                        spent,
                        estimated_cost,
                        global_limit
                    ));
                }
            }
        }
    }

    Ok(())
}

/// Record actual cost after an AI call completes.
pub async fn record_cost(
    pg: Option<&sqlx::PgPool>,
    redis: Option<&deadpool_redis::Pool>,
    account_id: Uuid,
    actual_cost: f64,
) -> Result<(), anyhow::Error> {
    if actual_cost <= 0.0 {
        return Ok(());
    }

    // Layer 3: Daily per-account (Redis INCRBYFLOAT)
    if let Some(pool) = redis {
        if let Ok(mut conn) = pool.get().await {
            let date = Utc::now().format("%Y-%m-%d").to_string();
            let key = format!("budget:daily:{}:{}", account_id, date);

            let _: Result<f64, _> = redis::cmd("INCRBYFLOAT")
                .arg(&key)
                .arg(actual_cost)
                .query_async(&mut *conn)
                .await;

            // Set TTL if key is new (EXPIRE only if TTL not set)
            let ttl: i64 = redis::cmd("TTL")
                .arg(&key)
                .query_async(&mut *conn)
                .await
                .unwrap_or(-1);
            if ttl < 0 {
                let _: Result<bool, _> = redis::cmd("EXPIRE")
                    .arg(&key)
                    .arg(DAILY_BUDGET_TTL_SECS)
                    .query_async(&mut *conn)
                    .await;
            }
        }
    }

    // Layer 4: Monthly per-account (PG)
    if let Some(pg_pool) = pg {
        let month_start = Utc::now().format("%Y-%m-01").to_string();
        let _ = sqlx::query(
            "UPDATE bl_account_budgets SET spent_usd = spent_usd + $1, updated_at = NOW()
             WHERE account_id = $2 AND month_year = $3::date",
        )
        .bind(actual_cost)
        .bind(account_id)
        .bind(&month_start)
        .execute(pg_pool)
        .await;
    }

    // Layer 5: Global daily (Redis INCRBYFLOAT)
    if let Some(pool) = redis {
        if let Ok(mut conn) = pool.get().await {
            let date = Utc::now().format("%Y-%m-%d").to_string();
            let key = format!("budget:global:{}", date);

            let _: Result<f64, _> = redis::cmd("INCRBYFLOAT")
                .arg(&key)
                .arg(actual_cost)
                .query_async(&mut *conn)
                .await;

            let ttl: i64 = redis::cmd("TTL")
                .arg(&key)
                .query_async(&mut *conn)
                .await
                .unwrap_or(-1);
            if ttl < 0 {
                let _: Result<bool, _> = redis::cmd("EXPIRE")
                    .arg(&key)
                    .arg(DAILY_BUDGET_TTL_SECS)
                    .query_async(&mut *conn)
                    .await;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_budget_no_pools() {
        // All layers opt-in: no pools = always passes
        let result = check_budget(None, None, Uuid::new_v4(), 1.0).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_record_cost_no_pools() {
        let result = record_cost(None, None, Uuid::new_v4(), 0.5).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_record_cost_zero() {
        // Zero cost is a no-op
        let result = record_cost(None, None, Uuid::new_v4(), 0.0).await;
        assert!(result.is_ok());
    }
}
