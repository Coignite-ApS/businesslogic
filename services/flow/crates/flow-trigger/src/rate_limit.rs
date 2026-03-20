//! Rate limiting — per-account RPS + monthly counters via Redis.

use chrono::Utc;
use std::fmt;
use uuid::Uuid;

/// Rate limit exceeded.
#[derive(Debug)]
pub enum RateLimitError {
    /// Requests per second exceeded.
    RpsExceeded { retry_after_secs: u64 },
    /// Monthly quota exceeded.
    MonthlyExceeded,
    /// Redis error.
    Redis(String),
}

impl fmt::Display for RateLimitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RpsExceeded { retry_after_secs } => {
                write!(f, "rate limit exceeded, retry after {}s", retry_after_secs)
            }
            Self::MonthlyExceeded => write!(f, "monthly execution quota exceeded"),
            Self::Redis(e) => write!(f, "rate limit redis error: {}", e),
        }
    }
}

/// Check both RPS and monthly rate limits for an account.
pub async fn check_rate_limit(
    pool: &deadpool_redis::Pool,
    account_id: &Uuid,
    rps_limit: u64,
    monthly_limit: u64,
) -> Result<(), RateLimitError> {
    let mut conn = pool.get().await.map_err(|e| RateLimitError::Redis(e.to_string()))?;

    let now = Utc::now();
    let epoch_s = now.timestamp();

    // RPS check: INCR + EXPIRE
    let rps_key = format!("rl:flow:rps:{}:{}", account_id, epoch_s);
    let count: i64 = redis::cmd("INCR")
        .arg(&rps_key)
        .query_async(&mut *conn)
        .await
        .map_err(|e| RateLimitError::Redis(e.to_string()))?;

    if count == 1 {
        // First request this second — set TTL
        let _: Result<(), _> = redis::cmd("EXPIRE")
            .arg(&rps_key)
            .arg(2)
            .query_async(&mut *conn)
            .await;
    }

    if count as u64 > rps_limit {
        return Err(RateLimitError::RpsExceeded { retry_after_secs: 1 });
    }

    // Monthly check: INCR + EXPIRE
    let month_key = format!("rl:flow:mo:{}:{}", account_id, now.format("%Y-%m"));
    let monthly_count: i64 = redis::cmd("INCR")
        .arg(&month_key)
        .query_async(&mut *conn)
        .await
        .map_err(|e| RateLimitError::Redis(e.to_string()))?;

    if monthly_count == 1 {
        // First request this month — set TTL (35 days)
        let _: Result<(), _> = redis::cmd("EXPIRE")
            .arg(&month_key)
            .arg(35 * 24 * 3600)
            .query_async(&mut *conn)
            .await;
    }

    if monthly_count as u64 > monthly_limit {
        return Err(RateLimitError::MonthlyExceeded);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rps_key_format() {
        let id = Uuid::nil();
        let key = format!("rl:flow:rps:{}:{}", id, 1710000000);
        assert!(key.starts_with("rl:flow:rps:"));
        assert!(key.contains(&id.to_string()));
    }

    #[test]
    fn test_monthly_key_format() {
        let id = Uuid::nil();
        let key = format!("rl:flow:mo:{}:2026-03", id);
        assert!(key.starts_with("rl:flow:mo:"));
        assert!(key.ends_with("2026-03"));
    }

    #[test]
    fn test_rate_limit_error_display() {
        let rps = RateLimitError::RpsExceeded { retry_after_secs: 1 };
        assert!(rps.to_string().contains("retry after"));

        let monthly = RateLimitError::MonthlyExceeded;
        assert!(monthly.to_string().contains("monthly"));

        let redis_err = RateLimitError::Redis("conn refused".to_string());
        assert!(redis_err.to_string().contains("conn refused"));
    }
}
