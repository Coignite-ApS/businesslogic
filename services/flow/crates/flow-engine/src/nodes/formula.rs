//! Formula evaluation nodes — powered by businesslogic-excel.
//!
//! Two nodes:
//! - `core:formula_eval` — evaluate a single Excel formula against input data
//! - `core:calculator` — spreadsheet-style multi-cell evaluation with formulas

use super::expression::{context_from_snapshot, interpolate_string};
use super::NodeHandler;
use businesslogic_excel::engine::evaluator::EvalContext;
use businesslogic_excel::engine::pipeline;
use businesslogic_excel::engine::workbook::Workbook;
use businesslogic_excel::parser::ast::AstArena;
use businesslogic_excel::types::*;
use businesslogic_excel::types::address::parse_cell_ref;
use flow_common::node::{RequiredRole, NodeInput, NodeResult, NodeTypeMeta, PortDef};
use std::sync::Arc;

// ── formula_eval ────────────────────────────────────────────────────────────

pub fn formula_eval_metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:formula_eval".to_string(),
        name: "Formula".to_string(),
        description: "Evaluate a single Excel formula against input data.".to_string(),
        category: "data".to_string(),
        tier: flow_common::node::NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "any".to_string(),
            required: false,
        }],
        outputs: vec![PortDef {
            name: "output".to_string(),
            data_type: "any".to_string(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "formula": {
                    "type": "string",
                    "description": "Excel formula (e.g., '=SUM(A1:A10)', '=IF(A1>100,\"high\",\"low\")')"
                },
                "data": {
                    "description": "Cell data as {A1: val, B2: val} or [[row0...], [row1...]]. Supports {{$trigger.x}} interpolation."
                },
                "locale": {
                    "type": "string",
                    "default": "enUS"
                }
            },
            "required": ["formula"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn formula_eval_handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let formula_raw = input
                .config
                .get("formula")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Formula: missing 'formula' config"))?;

            let locale = input
                .config
                .get("locale")
                .and_then(|v| v.as_str())
                .unwrap_or("enUS");

            let context = context_from_snapshot(&input.context_snapshot);
            let trigger = &context.trigger;
            let last = &context.last;
            let nodes = &context.nodes;

            // Interpolate formula
            let formula = interpolate_string(formula_raw, trigger, last, nodes);

            // Build workbook from data config or $last
            let mut wb = Workbook::new();
            let data = input
                .config
                .get("data")
                .cloned()
                .or_else(|| context.last.clone())
                .unwrap_or(serde_json::Value::Null);

            let mut sheet = Sheet::new("Data".into(), 100, 26);
            populate_sheet_from_json(&mut sheet, &data, &wb);
            let sheet_id = wb.add_sheet(sheet);

            // Parse formula
            let separator = pipeline::separator_for(locale);
            let mut arena = AstArena::new();
            let root = businesslogic_excel::parser::pratt::parse_formula_with_locale(
                &formula,
                &mut arena,
                &wb.interner,
                separator,
                sheet_id,
                |name| wb.sheet_id_by_name(name),
                locale,
            )
            .map_err(|e| anyhow::anyhow!("Formula parse error: {:?}", e))?;

            // Evaluate
            let eval_ctx = EvalContext::new(&wb, &arena, CellAddress::new(sheet_id, 0, 0));
            let result = eval_ctx.eval(root);
            let json_result = cell_value_to_json(&result, &wb);

            Ok(NodeResult::ok(json_result))
        })
    })
}

// ── calculator ──────────────────────────────────────────────────────────────

pub fn calculator_metadata() -> NodeTypeMeta {
    NodeTypeMeta {
        id: "core:calculator".to_string(),
        name: "Calculator".to_string(),
        description: "Spreadsheet-style multi-cell evaluation with formulas.".to_string(),
        category: "data".to_string(),
        tier: flow_common::node::NodeTier::Core,
        inputs: vec![PortDef {
            name: "input".to_string(),
            data_type: "any".to_string(),
            required: false,
        }],
        outputs: vec![PortDef {
            name: "output".to_string(),
            data_type: "object".to_string(),
            required: true,
        }],
        config_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "sheets": {
                    "type": "object",
                    "description": "Sheet data as {SheetName: [[cell_values...], ...]}"
                },
                "formulas": {
                    "type": "array",
                    "description": "Array of {sheet, cell, formula} objects",
                    "items": {
                        "type": "object",
                        "properties": {
                            "sheet": {"type": "string"},
                            "cell": {"type": "string"},
                            "formula": {"type": "string"}
                        },
                        "required": ["cell", "formula"]
                    }
                },
                "output_cells": {
                    "type": "object",
                    "description": "Map of output names to cell refs {name: 'A3'}"
                },
                "locale": {
                    "type": "string",
                    "default": "enUS"
                }
            },
            "required": ["formulas"],
            "additionalProperties": false
        }),
        estimated_cost_usd: 0.0,
        required_role: RequiredRole::default(),
    }
}

pub fn calculator_handler() -> NodeHandler {
    Arc::new(|input: NodeInput| {
        Box::pin(async move {
            let locale = input
                .config
                .get("locale")
                .and_then(|v| v.as_str())
                .unwrap_or("enUS");

            let context = context_from_snapshot(&input.context_snapshot);
            let trigger = &context.trigger;
            let last = &context.last;
            let nodes = &context.nodes;

            // Build workbook from sheets config
            let sheets_data = input
                .config
                .get("sheets")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({"Data": []}));

            let (mut wb, _sheet_names) = pipeline::build_workbook(&sheets_data)
                .map_err(|e| anyhow::anyhow!("Calculator: failed to build workbook: {}", e))?;
            wb.locale = businesslogic_excel::engine::workbook::LocaleSettings::from_locale(locale);

            // Parse formulas with interpolation
            let formulas_config = input
                .config
                .get("formulas")
                .and_then(|v| v.as_array())
                .ok_or_else(|| anyhow::anyhow!("Calculator: missing 'formulas' config"))?;

            let formulas_json: Vec<serde_json::Value> = formulas_config
                .iter()
                .map(|f| {
                    let mut f = f.clone();
                    if let Some(formula_str) = f.get("formula").and_then(|v| v.as_str()) {
                        let interpolated = interpolate_string(formula_str, trigger, last, nodes);
                        if let Some(obj) = f.as_object_mut() {
                            obj.insert("formula".to_string(), serde_json::Value::String(interpolated));
                        }
                    }
                    f
                })
                .collect();

            let default_sheet = formulas_json
                .first()
                .and_then(|f| f.get("sheet"))
                .and_then(|s| s.as_str())
                .unwrap_or("Data");

            let expr_table = pipeline::build_expression_table(None);

            let mut parsed = pipeline::parse_formulas(
                &formulas_json,
                &wb,
                default_sheet,
                locale,
                &expr_table,
            )
            .map_err(|e| anyhow::anyhow!("Calculator: formula parse error: {}", e))?;

            // Evaluate all formulas (returns tuple, not Result)
            let _eval_result = pipeline::evaluate_all(&mut wb, &mut parsed);

            // Extract output cells
            let mut output = serde_json::Map::new();

            if let Some(output_cells) = input.config.get("output_cells").and_then(|v| v.as_object()) {
                for (name, cell_ref) in output_cells {
                    if let Some(ref_str) = cell_ref.as_str() {
                        let val = resolve_cell_ref(&wb, ref_str);
                        output.insert(name.clone(), val);
                    }
                }
            } else {
                // Default: return all formula cells
                for pf in &parsed {
                    let sheet_id = pf.addr.sheet;
                    let val = wb.get_cell(sheet_id, pf.addr.row, pf.addr.col);
                    let cell_name = format_cell_ref(pf.addr.col, pf.addr.row);
                    let sheet_name = wb.sheet(sheet_id).map(|s| s.name.clone()).unwrap_or_default();
                    let key = if sheet_name.is_empty() || sheet_name == "Data" {
                        cell_name
                    } else {
                        format!("{}!{}", sheet_name, cell_name)
                    };
                    output.insert(key, cell_value_to_json(val, &wb));
                }
            }

            Ok(NodeResult::ok(serde_json::Value::Object(output)))
        })
    })
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Populate a sheet from JSON data.
/// - Object {A1: val, B2: val} — cell references as keys
/// - Array [[row0_vals...], [row1_vals...]] — 2D grid
fn populate_sheet_from_json(sheet: &mut Sheet, data: &serde_json::Value, wb: &Workbook) {
    match data {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                if let Some((col, row)) = parse_cell_ref(key) {
                    sheet.ensure_size(row + 1, col + 1);
                    sheet.set(row, col, json_to_cell_value(val, wb));
                }
            }
        }
        serde_json::Value::Array(rows) => {
            for (row_idx, row_val) in rows.iter().enumerate() {
                if let Some(cols) = row_val.as_array() {
                    for (col_idx, cell_val) in cols.iter().enumerate() {
                        sheet.ensure_size(row_idx as u32 + 1, col_idx as u16 + 1);
                        sheet.set(
                            row_idx as u32,
                            col_idx as u16,
                            json_to_cell_value(cell_val, wb),
                        );
                    }
                }
            }
        }
        _ => {}
    }
}

fn json_to_cell_value(val: &serde_json::Value, wb: &Workbook) -> CellValue {
    match val {
        serde_json::Value::Number(n) => CellValue::Number(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => CellValue::String(wb.intern(s)),
        serde_json::Value::Bool(b) => CellValue::Bool(*b),
        serde_json::Value::Null => CellValue::Null,
        _ => CellValue::String(wb.intern(&val.to_string())),
    }
}

fn cell_value_to_json(val: &CellValue, wb: &Workbook) -> serde_json::Value {
    match val {
        CellValue::Number(n) => serde_json::json!(n),
        CellValue::String(spur) => serde_json::json!(wb.resolve(*spur)),
        CellValue::Bool(b) => serde_json::json!(b),
        CellValue::Null => serde_json::Value::Null,
        CellValue::Error(e) => serde_json::json!({"error": e.as_str()}),
        CellValue::Array(vals) => {
            serde_json::Value::Array(vals.iter().map(|v| cell_value_to_json(v, wb)).collect())
        }
    }
}

fn resolve_cell_ref(wb: &Workbook, ref_str: &str) -> serde_json::Value {
    let (sheet_name, cell_part) = if let Some(pos) = ref_str.find('!') {
        (&ref_str[..pos], &ref_str[pos + 1..])
    } else {
        ("Data", ref_str)
    };

    let sheet_id = wb.sheet_id_by_name(sheet_name).unwrap_or(SheetId(0));

    if let Some((col, row)) = parse_cell_ref(cell_part) {
        let val = wb.get_cell(sheet_id, row, col);
        cell_value_to_json(val, wb)
    } else {
        serde_json::Value::Null
    }
}

fn format_cell_ref(col: u16, row: u32) -> String {
    let mut col_str = String::new();
    let mut c = col as u32;
    loop {
        col_str.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    format!("{}{}", col_str, row + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_cell_ref() {
        assert_eq!(format_cell_ref(0, 0), "A1");
        assert_eq!(format_cell_ref(1, 0), "B1");
        assert_eq!(format_cell_ref(25, 0), "Z1");
        assert_eq!(format_cell_ref(26, 0), "AA1");
        assert_eq!(format_cell_ref(0, 9), "A10");
    }

    #[tokio::test]
    async fn test_formula_eval_sum() {
        let handler = formula_eval_handler();
        let input = NodeInput::new( serde_json::json!({
                "formula": "=SUM(A1:A3)",
                "data": {"A1": 10, "A2": 20, "A3": 30}
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data, serde_json::json!(60.0));
    }

    #[tokio::test]
    async fn test_formula_eval_if() {
        let handler = formula_eval_handler();
        let input = NodeInput::new( serde_json::json!({
                "formula": "=IF(A1>50,\"high\",\"low\")",
                "data": {"A1": 100}
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data, serde_json::json!("high"));
    }

    #[tokio::test]
    async fn test_formula_eval_grid_data() {
        let handler = formula_eval_handler();
        let input = NodeInput::new( serde_json::json!({
                "formula": "=AVERAGE(A1:B2)",
                "data": [[10, 20], [30, 40]]
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data, serde_json::json!(25.0));
    }

    #[tokio::test]
    async fn test_formula_eval_parse_error() {
        let handler = formula_eval_handler();
        let input = NodeInput::new( serde_json::json!({
                "formula": "=INVALID_SYNTAX((("
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        assert!(handler(input).await.is_err());
    }

    #[tokio::test]
    async fn test_formula_eval_missing_formula() {
        let handler = formula_eval_handler();
        let input = NodeInput::new( serde_json::json!({}),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        assert!(handler(input).await.is_err());
    }

    #[tokio::test]
    async fn test_formula_eval_metadata() {
        let meta = formula_eval_metadata();
        assert_eq!(meta.id, "core:formula_eval");
        assert_eq!(meta.tier, flow_common::node::NodeTier::Core);
    }

    #[tokio::test]
    async fn test_calculator_metadata() {
        let meta = calculator_metadata();
        assert_eq!(meta.id, "core:calculator");
    }

    #[tokio::test]
    async fn test_calculator_basic() {
        let handler = calculator_handler();
        let input = NodeInput::new( serde_json::json!({
                "sheets": {
                    "Data": [[100, 200], [150, 250]]
                },
                "formulas": [
                    {"sheet": "Data", "cell": "A3", "formula": "=SUM(A1:A2)"},
                    {"sheet": "Data", "cell": "B3", "formula": "=SUM(B1:B2)"}
                ],
                "output_cells": {
                    "total_a": "A3",
                    "total_b": "B3"
                }
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["total_a"], serde_json::json!(250.0));
        assert_eq!(result.data["total_b"], serde_json::json!(450.0));
    }

    #[tokio::test]
    async fn test_calculator_no_output_cells() {
        let handler = calculator_handler();
        let input = NodeInput::new( serde_json::json!({
                "sheets": {"Data": [[10, 20]]},
                "formulas": [
                    {"sheet": "Data", "cell": "A2", "formula": "=A1*2"}
                ]
            }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let result = handler(input).await.unwrap();
        assert_eq!(result.data["A2"], serde_json::json!(20.0));
    }
}
