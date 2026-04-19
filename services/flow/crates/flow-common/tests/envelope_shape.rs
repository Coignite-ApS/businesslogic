/// Cross-language envelope shape contract test (Rust side).
/// Deserializes the same JSON fixture as the TypeScript test and asserts
/// required fields are present and correctly typed.
/// If this breaks, task 21's aggregator will silently mis-parse events.

use serde_json::Value;

const VALID_MODULES: &[&str] = &["calculators", "kb", "flows", "ai"];
const VALID_KINDS: &[&str] = &[
    "calc.call",
    "kb.search",
    "kb.ask",
    "ai.message",
    "embed.tokens",
    "flow.execution",
    "flow.step",
    "flow.failed",
];

#[test]
fn envelope_samples_deserialize_correctly() {
    let json = include_str!("../../../../../packages/bl-events/test/fixtures/envelope-samples.json");
    let samples: Vec<Value> = serde_json::from_str(json).expect("fixture must parse as JSON array");

    assert_eq!(samples.len(), 8, "fixture must have 8 samples (one per event_kind)");

    for (i, s) in samples.iter().enumerate() {
        // account_id: non-empty string
        let account_id = s.get("account_id").unwrap_or_else(|| panic!("[{i}] missing account_id"));
        assert!(account_id.is_string() && !account_id.as_str().unwrap().is_empty(),
            "[{i}] account_id must be non-empty string");

        // api_key_id: string or null
        let api_key_id = s.get("api_key_id").unwrap_or_else(|| panic!("[{i}] missing api_key_id"));
        assert!(api_key_id.is_string() || api_key_id.is_null(),
            "[{i}] api_key_id must be string or null");

        // module: one of the known values
        let module = s["module"].as_str().unwrap_or_else(|| panic!("[{i}] missing module"));
        assert!(VALID_MODULES.contains(&module), "[{i}] unknown module: {module}");

        // event_kind: one of the known values
        let kind = s["event_kind"].as_str().unwrap_or_else(|| panic!("[{i}] missing event_kind"));
        assert!(VALID_KINDS.contains(&kind), "[{i}] unknown event_kind: {kind}");

        // quantity: non-negative number
        let quantity = s.get("quantity").unwrap_or_else(|| panic!("[{i}] missing quantity"));
        assert!(quantity.is_number(), "[{i}] quantity must be a number");
        assert!(quantity.as_f64().unwrap() >= 0.0, "[{i}] quantity must be non-negative");

        // cost_eur: must be null (aggregator computes it)
        assert!(s["cost_eur"].is_null(), "[{i}] cost_eur must be null");

        // metadata: object
        assert!(s["metadata"].is_object(), "[{i}] metadata must be an object");

        // occurred_at: string ending with Z (UTC ISO 8601)
        let occurred_at = s["occurred_at"].as_str().unwrap_or_else(|| panic!("[{i}] missing occurred_at"));
        assert!(occurred_at.ends_with('Z'), "[{i}] occurred_at must end with Z");
    }
}

#[test]
fn envelope_samples_cover_all_event_kinds() {
    let json = include_str!("../../../../../packages/bl-events/test/fixtures/envelope-samples.json");
    let samples: Vec<Value> = serde_json::from_str(json).unwrap();

    for kind in VALID_KINDS {
        assert!(
            samples.iter().any(|s| s["event_kind"].as_str() == Some(kind)),
            "fixture missing event_kind: {kind}",
        );
    }
}
