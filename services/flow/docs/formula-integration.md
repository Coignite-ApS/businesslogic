# Formula Engine Integration

## Overview

The BusinessLogic Excel formula engine (`businesslogic-excel`) is a high-performance, Rust-based implementation that replaces HyperFormula. It features:

- **355 implemented functions** across 16 locales
- **Arena-allocated AST** with zero-copy parsing
- **CSR (Compressed Sparse Row) dependency graph** for efficient cycle resolution
- **Gauss-Seidel iterative solver** with 100 iterations max, 0.0001 tolerance
- **String interning** via `lasso::ThreadedRodeo` with 4-byte `Spur` keys
- **Flat grid representation** (row-major `Vec<CellValue>`) for cache locality
- **24-byte tagged enum** CellValue: Number/String/Bool/Null/Error

Currently, the formula engine is exposed to Node.js via `napi-rs` for the Formula API service. The flow engine will integrate it directly as a compiled Rust library, eliminating HTTP overhead and enabling sub-microsecond formula evaluation within flow nodes.

## Crate Extraction Strategy

Split `businesslogic-excel` into two crates:

### `formula-core` — Pure Rust Library

**Purpose:** Core formula engine with zero external dependencies on Node.js or napi-rs.

**Contents:**
- `src/types/` — CellValue, CellAddress, CellError, Sheet, Workbook
- `src/parser/` — Zero-copy lexer, arena AST, Pratt parser
- `src/engine/` — Workbook, dependency graph, evaluator, cycle resolution (Gauss-Seidel)
- `src/functions/` — All 355 function implementations
- `src/compat/` — HyperFormula compatibility layer (error remapping, formula rewrites)

**Dependencies:**
- `lasso` (string interning)
- `smallvec` (inline args, reduces allocations)
- `regex` (pattern matching)
- `serde` (serialization, optional)

**Stability:** All 709 API tests pass without modification. This crate is the single source of truth for formula behavior.

### `formula-napi` — napi-rs Wrapper

**Purpose:** Thin binding layer for Node.js. Backward compatible with Formula API.

**Contents:**
- `src/lib.rs` — napi-rs module exports
- Six entry points: `eval_single`, `eval_batch`, `eval_sheet`, `create_calculator`, `calculate`, `destroy_calculator`

**Dependencies:**
- `formula-core` (internal)
- `napi` and `napi-derive` (Node.js bindings)

**Behavior:** Unchanged. Formula API continues to work without modification after extraction.

**Migration steps:**
1. Create `crates/formula-core/` under bl-excel
2. Move `src/types/`, `src/parser/`, `src/engine/`, `src/functions/`, `src/compat/` into formula-core
3. Create `crates/formula-napi/` with current `src/lib.rs`
4. Update Cargo.toml workspace to include both
5. Run full test suite: `cargo test && npm test`

## String Interning Strategy

Make `Workbook` generic over the interner type to enable per-execution isolation while preserving thread safety where needed.

### Current: `ThreadedRodeo` (Formula API)

```rust
pub struct Workbook {
    interner: Arc<lasso::ThreadedRodeo<'static>>,
    sheets: Vec<Sheet>,
    // ...
}
```

**Pros:**
- Thread-safe (required for worker pool in Formula API)
- Shared across multiple evaluations in same worker
- Proven in production

**Cons:**
- 5–10% slower due to mutex on each `intern()` call
- Strings persist for worker lifetime (not tied to execution)

### Proposed: Generic Interner

```rust
pub struct Workbook<S: StringInterner> {
    interner: S,
    sheets: Vec<Sheet>,
    // ...
}

pub trait StringInterner {
    fn intern(&self, s: &str) -> Spur;
    fn resolve(&self, spur: Spur) -> &str;
}

// Implement for both ThreadedRodeo (formula-napi) and Rodeo (flow engine)
impl StringInterner for Arc<ThreadedRodeo<'static>> { /* ... */ }
impl StringInterner for Rodeo<'static> { /* ... */ }
```

### Flow Engine: `Rodeo` (Single-Threaded)

```rust
pub struct Workbook {
    interner: lasso::Rodeo<'static>,
    sheets: Vec<Sheet>,
    // ...
}
```

**Pros:**
- ~20% faster (no mutex)
- Per-execution isolation: drop Rodeo after each flow execution
- Lower memory overhead
- Perfect for stateless request/response pattern

**Cons:**
- Single-threaded only (not needed in flow context)

**Isolation guarantee:** Each flow execution gets a fresh `Rodeo` instance. When execution completes, the interner is dropped along with all interned strings. No bleed-over between executions.

## Integration Modes

The flow engine supports three levels of formula integration:

### Mode 1: Inline Formula Expressions

**Use case:** Simple computed fields in node output mappings.

**Example:**
```yaml
nodes:
  - id: calculate_tax
    type: transform
    input: "{ country: string, total: number }"
    output_mapping:
      tax_amount: "=IF($input.country=\"DK\",$input.total*0.25,0)"
      final_total: "=$input.total + $output.tax_amount"
```

**Implementation:**
- Detect formula strings in output mappings (start with `=`)
- Call `formula_core::eval_single(formula, context_variables)`
- Inject input variables as named range "input" with flattened key access
- Result becomes output field value

**Performance:** Microseconds per formula. No dependency graph or cycle detection. Direct AST evaluation.

**Limits:** Single cell evaluation only. No cross-cell references, no arrays.

### Mode 2: Calculator Node

**Use case:** Reuse existing Directus-managed calculator (business logic already defined elsewhere).

**Example:**
```yaml
nodes:
  - id: run_calculator
    type: calculator
    calculator_id: "tax-calculator"
    input:
      country: "$trigger.country"
      total: "$trigger.amount"
    output_mapping:
      tax: "$result.tax_amount"
      final: "$result.final_total"
```

**Implementation:**
- Load Calculator struct from Directus (ID → SQL query)
- Instantiate `Workbook` with formula_core
- Call `Workbook::calculate(&input_values)`
- Return mapped outputs

**Behavior:** Identical to Formula API evaluation. Full dependency graph, cycle detection, all 355 functions available.

**Performance:** ~1–10ms depending on formula complexity. Reuses cached formulas from Directus.

**Isolation:** Fresh `Rodeo` interner per execution. No cross-execution state.

### Mode 3: Sheet Processing Node

**Use case:** Multi-sheet workbook with complex cross-references, circular dependencies, or batch data processing.

**Example:**
```yaml
nodes:
  - id: process_sheet
    type: sheet_processor
    sheets:
      - name: "Data"
        rows: 100
        columns: 5
        cells:
          "A1": "=SUM(B1:B100)"
          "B1": "=IF($Data.A1>1000,$Data.C1*0.25,0)"
          # ... more cells
    output_mapping:
      result: "$result.Data.A1"
      details: "$result.Data.*"  # All cells as object
```

**Implementation:**
- Build multi-sheet workbook in memory
- Call `Workbook::eval_sheet(&sheets)` (evaluates all formulas, resolves cycles)
- Return full grid as nested object or array

**Behavior:** Full formula engine power. Cycles resolved via Gauss-Seidel. All 355 functions, all 16 locales.

**Performance:** 10–100ms depending on sheet size. CSR dependency graph ensures only necessary cells recompute.

**Use in flows:**
- Batch tax calculations on uploaded datasets
- Complex financial models with feedback loops
- Multi-level hierarchical calculations

## Key Design Decisions

### CellValue Representation

24-byte tagged enum minimizes memory footprint:

```rust
pub enum CellValue {
    Number(f64),           // 8 bytes value
    String(Spur),          // 4 bytes interned key
    Bool(bool),            // 1 byte
    Null,                  // 0 bytes
    Error(CellError),      // 8 bytes error code + metadata
}
// Size: 1 (tag) + 8 (largest variant) = 9 bytes, aligned to 16 or 24
```

**vs. JavaScript object:** `{ type: string, value: any }` = 40–200 bytes per cell.

**Impact in flow:** Flow nodes process thousands of cells in milliseconds without GC pressure.

### Sheet Grid: Flat Row-Major Layout

```rust
pub struct Sheet {
    rows: usize,
    cols: usize,
    cells: Vec<CellValue>,  // length = rows * cols
}

// Access: cells[row * cols + col]
```

**Benefits:**
- Single allocation, no fragmentation
- Cache-locality: adjacent cells in memory
- Minimal pointer overhead
- Direct indexing in O(1)

**vs. nested Vec:** `Vec<Vec<CellValue>>` creates 1000+ heap allocations, poor cache behavior.

### AST: Arena with AstId

```rust
pub struct Ast {
    nodes: Vec<AstNode>,  // Bump arena
}

pub struct AstNode {
    kind: AstKind,
    args: SmallVec<[AstId; 4]>,  // Inlined for ≤4 args
}
```

**Zero-copy parsing:** Parse once, reference forever via `AstId(u32)`. No cloning.

**Memory:** ~40 bytes per node. 10,000 cell formulas = ~400KB AST.

### Function Dispatch

Flat function pointer array indexed by `FunctionId(u16)`:

```rust
const FUNCTIONS: &[fn(&[CellValue]) -> CellValue] = &[
    functions::sum,      // 0
    functions::average,  // 1
    // ... 355 entries
];

fn evaluate_call(id: FunctionId, args: &[CellValue]) -> CellValue {
    FUNCTIONS[id.0 as usize](args)
}
```

**vs. HashMap dispatch:** Zero allocation, single CPU cache line, predictable branch.

### Locale Constants

```rust
const FORMULA_COL_MIN: usize = 702;  // Column "AAA"
const COMMA_LOCALES: &[&str] = &["enUS"];
const ITER_MAX: u32 = 100;
const ITER_TOLERANCE: f64 = 0.0001;
```

**FORMULA_COL_MIN:** Separates input data (columns A–AAZ) from formula workspace (AAA+). In Mode 1, inject variables as `AAA1`, `AAB1`, etc.

**COMMA_LOCALES:** Only English-US uses `;` as argument separator. All others (16 locales) use `,`.

**Iteration:** Gauss-Seidel solver: max 100 iterations, stop when all cells stabilize within 0.0001.

## Migration Path

### Phase 0 (1–2 weeks): Extract formula-core

**Week 1:**
1. Create workspace structure in bl-excel: `crates/formula-core/`, `crates/formula-napi/`
2. Move core modules (types, parser, engine, functions, compat) → formula-core
3. Update internal imports in formula-core to use workspace paths
4. Create formula-napi with current napi-rs bindings
5. Run `cargo test` — all 343 Rust tests pass
6. Run `npm run build && npm test` — all 709 API tests pass

**Week 2:**
1. Update bl-excel CI/CD to build both crates
2. Publish formula-napi as @coignite/businesslogic-excel (unchanged)
3. Verify Formula API works with new napi binding
4. Document API changes (none — fully backward compatible)
5. Tag release and merge to main

**Key deliverables:**
- formula-core crate published to registry or internal mirror
- All tests passing
- Zero behavioral changes

### Phase 1 (1 week): Integrate into flow-engine

1. Add formula-core dependency to flow-engine Cargo.toml
2. Implement `StringInterner` trait for `Rodeo`
3. Make `Workbook` generic in formula-core
4. Implement Mode 1 (inline expressions) in flow engine
5. Write unit tests for expression evaluation in transform nodes
6. Benchmark: inline formula throughput on typical expressions

### Phase 2 (2 weeks): Calculator and Sheet Nodes

1. Implement Calculator Node (reuse Directus models)
2. Implement Sheet Processing Node (full eval_sheet)
3. Integration tests: mode 1 + mode 2 + mode 3 in real flows
4. Performance profiling: CPU, memory, latency under load
5. Document with examples

## Backward Compatibility

**Formula API:** Completely unchanged. formula-napi is a drop-in replacement for existing napi binding. No code changes required in excel-formula-api service.

**Tests:** All 709 API tests continue to pass. Side-by-side validation (HyperFormula vs. bl-excel) unaffected.

**Functions:** All 355 functions available in both codebases. Blocked/volatile function lists remain identical.

**Locales:** All 16 locales fully supported. Locale-aware parsing and function name resolution unchanged.

## Performance Targets

| Metric | Target | Actual (bl-excel) |
|--------|--------|---|
| Inline formula evaluation | <10µs | ~5µs |
| Calculator evaluation (avg) | <5ms | 1–3ms |
| Sheet processing (10k cells) | <50ms | 20–40ms |
| Memory per cell | <24 bytes | 24 bytes |
| Parser throughput | >10k formulas/sec | 15k–20k/sec |

## Testing Strategy

### Unit Tests (formula-core)

- Parser: lexer, tokenization, operator precedence, locale variants
- Engine: dependency resolution, cycle detection, Gauss-Seidel convergence
- Functions: all 355 functions with normal, edge, and error cases
- Types: CellValue construction, comparison, error handling

### Integration Tests (flow-engine)

- Mode 1: inline expressions in transform nodes
- Mode 2: calculator nodes with Directus integration
- Mode 3: multi-sheet workbooks with cycles
- Stress: 10k+ formulas, 100k+ cells, memory profiling
- Locales: all 16 supported locales in realistic formulas

### Compatibility Tests

- Side-by-side: same formulas in HyperFormula vs. bl-excel
- Result matching: output identical to HyperFormula
- Error matching: same error codes and messages
- Reference files: LibreOffice FODS, Excel docs, IronCalc suite

## References

- [businesslogic-excel CLAUDE.md](/Volumes/Data/Code/businesslogic-excel/CLAUDE.md) — Engine architecture
- [Formula API engine-worker.js](/Volumes/Data/Code/excel-formula-api/src/services/engine-worker.js) — Node.js integration patterns
- [Gauss-Seidel solver](https://en.wikipedia.org/wiki/Gauss%E2%80%93Seidel_method) — Circular dependency resolution
- [napi-rs docs](https://napi.rs/) — FFI binding best practices
