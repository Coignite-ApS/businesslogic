//! Trigger configuration and types.

use serde::{Deserialize, Serialize};

/// How a flow gets triggered.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TriggerConfig {
    /// HTTP webhook — trigger receives POST to /webhook/{flow_id}.
    Webhook {
        /// Optional secret for HMAC signature verification.
        #[serde(skip_serializing_if = "Option::is_none")]
        secret: Option<String>,
        /// HTTP methods to accept (default: POST).
        #[serde(default = "default_methods")]
        methods: Vec<String>,
    },

    /// Cron schedule — 5-field cron expression (minute hour day month weekday).
    Cron {
        expression: String,
        /// Optional timezone (default: UTC).
        #[serde(default = "default_timezone")]
        timezone: String,
    },

    /// Database event — PostgreSQL LISTEN/NOTIFY on table changes.
    DatabaseEvent {
        /// Directus collection name to watch.
        collection: String,
        /// Events to trigger on.
        events: Vec<DatabaseEventType>,
    },

    /// Manual — triggered via REST API call.
    Manual,

    /// Flow-to-flow — triggered when another flow's node emits an event.
    FlowEvent {
        /// Source flow ID to listen to.
        source_flow_id: uuid::Uuid,
        /// Event name to match.
        event_name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseEventType {
    Create,
    Update,
    Delete,
}

fn default_methods() -> Vec<String> {
    vec!["POST".to_string()]
}

fn default_timezone() -> String {
    "UTC".to_string()
}
