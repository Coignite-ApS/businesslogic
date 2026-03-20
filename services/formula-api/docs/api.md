# API Reference

Base URL: `http://localhost:3000` (or your deployed host)

## POST /execute

Evaluate a single Excel formula.

**Request:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `formula` | string | yes | Excel formula (max 10,000 chars). `=` prefix optional. |
| `data` | any[][] | no | 2D array of cell values for formula to reference. Skips cache. |
| `locale` | string | no | Locale code (e.g. `de`, `fr`). Default: `en`. |

```json
{"formula": "SUM(1,2,3)", "locale": "en"}
```

**Response (200) — scalar:**

```json
{"result": 6, "formula": "SUM(1,2,3)", "format": "scalar", "cached": false}
```

**Response (200) — array/spill:**

```json
{"result": [[1],[2],[3]], "formula": "TRANSPOSE({1,2,3})", "format": "array", "cached": false}
```

**With data:**

```json
{"formula": "SUM(A1:B2)", "data": [[1,2],[3,4]]}
```
```json
{"result": 10, "formula": "SUM(A1:B2)", "format": "scalar", "cached": false}
```

**Error (422):**

```json
{"error": "Formula error", "type": "NAME", "formula": "INVALID()"}
```

`#NAME?` errors may include `unresolvedFunctions` (array of unresolved function names) when the engine can identify which functions couldn't be resolved.

---

## POST /execute/batch

Evaluate up to 1000 formulas in a single request.

**Request:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `formulas` | string[] | yes | Array of formulas (1-1000 items, each max 10,000 chars) |
| `data` | any[][] | no | Shared 2D array of cell values for all formulas. Skips cache. |
| `locale` | string | no | Locale code. Applies to all formulas. |

```json
{"formulas": ["SUM(1,2)", "AVERAGE(10,20)", "MAX(1,5,3)"], "locale": "en"}
```

**Response (200):**

```json
{
  "results": [
    {"formula": "SUM(1,2)", "result": 3, "format": "scalar", "cached": false},
    {"formula": "AVERAGE(10,20)", "result": 15, "format": "scalar", "cached": false},
    {"formula": "MAX(1,5,3)", "result": 5, "format": "scalar", "cached": false}
  ]
}
```

**With shared data:**

```json
{"data": [[100,200],[300,400]], "formulas": ["A1+B1", "SUM(A1:B2)"]}
```
```json
{
  "results": [
    {"formula": "A1+B1", "result": 300, "format": "scalar", "cached": false},
    {"formula": "SUM(A1:B2)", "result": 1000, "format": "scalar", "cached": false}
  ]
}
```

Per-formula errors are inline (not 422):

```json
{"formula": "INVALID()", "error": "Formula error", "type": "NAME"}
```

---

## POST /execute/sheet

Evaluate formulas against a data grid with cell references. Formulas are placed at specific cells and can reference each other.

**Request:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | any[][] | yes | 2D array of cell values |
| `formulas` | object[] | yes | Array of `{cell, formula}` objects |
| `formulas[].cell` | string | yes | Target cell (e.g. `C1`, `D2`) |
| `formulas[].formula` | string | yes | Formula with cell references |
| `locale` | string | no | Locale code |

```json
{
  "data": [[100, 200], [300, 400]],
  "formulas": [
    {"cell": "C1", "formula": "=A1+B1"},
    {"cell": "C2", "formula": "=SUM(A1:B2)"}
  ]
}
```

**Response (200):**

```json
{
  "results": [
    [100, 200, 300],
    [300, 400, 1000]
  ]
}
```

The response is the full grid including original data and computed cells.

---

## POST /parse/xlsx

Upload an `.xlsx` file and get back a `{sheets, formulas}` object directly passable to `/execute/sheet`.

**Request:** `multipart/form-data` with a `file` field containing the `.xlsx` file.

Accepted MIME types: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/octet-stream`.

```bash
curl -X POST localhost:3000/parse/xlsx -F "file=@spreadsheet.xlsx"
```

**Response (200):**

```json
{
  "sheets": {
    "Sheet1": [[1, 2, null], [3, 4, null]],
    "Sheet2": [[5, 6]]
  },
  "formulas": [
    {"sheet": "Sheet1", "cell": "C1", "formula": "A1+B1"},
    {"sheet": "Sheet1", "cell": "C2", "formula": "A2+B2"}
  ]
}
```

**Parsing rules:**
- Cells with formulas → `null` in `sheets` grid, formula extracted to `formulas` array
- Cells with values → value in `sheets` grid
- Empty cells → `null`
- Empty sheets → `[[]]`

**Round-trip with `/execute/sheet`:**

```bash
PARSED=$(curl -s -X POST localhost:3000/parse/xlsx -F "file=@sheet.xlsx")
echo $PARSED | curl -s -X POST localhost:3000/execute/sheet -H "Content-Type: application/json" -d @-
```

**Errors:**

| HTTP | When |
|------|------|
| 400 | No file uploaded |
| 413 | File exceeds `MAX_UPLOAD_SIZE` (default 5MB) |
| 415 | Not an xlsx MIME type |
| 422 | Corrupt or invalid xlsx file |

---

## POST /calculators

Create a calculator — a typed spreadsheet function with JSON Schema-validated I/O.

**Request:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sheets` | object | yes | Named sheets with 2D array data (from `/parse/xlsx` or manual) |
| `formulas` | object[] | yes | Array of `{sheet?, cell, formula}` (from `/parse/xlsx` or manual) |
| `input` | object | yes | JSON Schema draft-07 with `mapping` extension on each property |
| `output` | object | yes | JSON Schema draft-07 with `mapping` (scalar) or `mapping` + `mapping_item` (array) |
| `data_mappings` | object[] | no | Reference data ranges for auto-generating `oneOf` enums |
| `locale` | string | no | Locale code (e.g. `da`, `de`). Default: `en`. |

**Input schema properties:**

| Extension field | Description |
|----------------|-------------|
| `mapping` | Cell reference: `'SheetName'!C3` or `C3` (defaults to first sheet) |
| `default` | Default value when field omitted from input |
| `data_mapping_id` | Reference: `"reference_name.field"` — populates `oneOf` const values |
| `data_mapping_title` | Reference: `"reference_name.field"` — populates `oneOf` titles |

Standard JSON Schema fields (`type`, `required`, `minimum`, `maximum`, `minLength`, `maxLength`) are validated by ajv.

**Output schema properties:**

| Extension field | Description |
|----------------|-------------|
| `mapping` | Single cell: `'Sheet'!C3` (scalar) or range: `'Sheet'!A1:F60` (array) |
| `mapping_item` | Column letter for array items: `"A"`, `"B"`, etc. |

**Data mappings:**

```json
[{
  "reference_name": "car_choices",
  "mapping": "'Dialog'!F5:G17",
  "items": {
    "id": { "mapping_item": "F" },
    "title": { "mapping_item": "G" }
  }
}]
```

**Example:**

```json
{
  "sheets": {"Sheet1": [[0, 10], [0, 20]]},
  "formulas": [
    {"sheet": "Sheet1", "cell": "C1", "formula": "A1+B1"},
    {"sheet": "Sheet1", "cell": "C2", "formula": "A2+B2"}
  ],
  "input": {
    "type": "object",
    "properties": {
      "val1": {"type": "number", "mapping": "'Sheet1'!A1", "default": 0},
      "val2": {"type": "number", "mapping": "'Sheet1'!A2", "default": 0}
    }
  },
  "output": {
    "type": "object",
    "properties": {
      "sum1": {"type": "number", "mapping": "'Sheet1'!C1"},
      "sum2": {"type": "number", "mapping": "'Sheet1'!C2"}
    }
  }
}
```

**Response (201):**

```json
{
  "calculatorId": "abc123",
  "ttl": 1800,
  "expiresAt": "2026-02-21T15:30:00Z",
  "input": {"type": "object", "properties": {"val1": {"type": "number", "mapping": "'Sheet1'!A1", "default": 0}}},
  "output": {"type": "object", "properties": {"sum1": {"type": "number", "mapping": "'Sheet1'!C1"}}}
}
```

**Errors:** 400 (invalid schema/mapping), 422 (engine creation failed)

---

## POST /execute/calculator/:id

Execute a calculator with flat typed input.

**Request:**

```json
{"val1": 5, "val2": 15}
```

**Response (200):**

```json
{"sum1": 15, "sum2": 35}
```

**With array output (range mapping):**

```json
{
  "total": 50000,
  "expenses": [
    {"name": "Rent", "amount": 12000},
    {"name": "Food", "amount": 6000}
  ]
}
```

Rows where all mapped columns are null are skipped in array outputs.

**Errors:**

| HTTP | When |
|------|------|
| 400 | Input validation failed (ajv) |
| 410 | Calculator not found or expired (client must recreate) |
| 500 | Calculation engine error |

---

## GET /calculator/:id

Get calculator metadata and schemas. Useful for building dynamic UIs from the schema.

**Response (200):**

```json
{
  "calculatorId": "abc123",
  "ttl": 1800,
  "expiresAt": "2026-02-21T15:30:00Z",
  "input": {"type": "object", "properties": {"val1": {"type": "number", "mapping": "'Sheet1'!A1", "oneOf": [...]}}},
  "output": {"type": "object", "properties": {"sum1": {"type": "number", "mapping": "'Sheet1'!C1"}}}
}
```

**Errors:** 404 (not found)

---

## PATCH /calculator/:id

Update any calculator field independently. All fields optional — send only what changed.

**Request:**

```json
{"sheets": {"Sheet1": [[0, 100], [0, 200]]}}
```

Schema-only changes (input/output/data_mappings) are fast — no worker engine rebuild. Data changes (sheets/formulas/locale) trigger engine rebuild.

**Response (200):** Same as POST /calculators response.

**Errors:** 400 (invalid schema), 404 (not found), 422 (engine rebuild failed)

---

## DELETE /calculator/:id

Destroys the calculator engine in the worker and removes from store.

**Response:** 204 No Content

**Errors:** 404 (not found)

---

## GET /functions

List all supported functions, optionally filtered by category, names, or search query. Requires `X-Admin-Token`.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `category` | string | Filter by category (e.g. `Math`, `Statistical`) |
| `names` | string | Comma-separated function names (e.g. `SUM,AVERAGE`) |
| `search` | string | Free-text search across function names and descriptions |

**Response (200):**

```json
{
  "count": 2,
  "functions": [
    {"name": "SUM", "category": "Math", "description": "...", "syntax": "...", "examples": [...]},
    {"name": "AVERAGE", "category": "Statistical", "description": "...", "syntax": "...", "examples": [...]}
  ]
}
```

---

## GET /functions/:name

Get detailed documentation for a single function. Requires `X-Admin-Token`.

**Response (200):** Single function object (same shape as array items above).

**Errors:** 404 (function not found)

---

## GET /health

**Response (200):**

```json
{
  "status": "ok",
  "ts": 1700000000000,
  "cache": {
    "lru": {"size": 42, "max": 50000},
    "redis": "connected"
  },
  "queue": {
    "pending": 3,
    "max": 128
  }
}
```

---

## GET /ping

Lightweight liveness check. Returns `{"status": "ok"}`.

---

## Error Codes

| HTTP | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (calculator) |
| 204 | Deleted (calculator) |
| 400 | Validation error (missing/invalid fields, schema error) |
| 404 | Not found (calculator GET/PATCH/DELETE) |
| 410 | Gone — calculator expired or worker crashed. Client must recreate. |
| 413 | File too large (`/parse/xlsx` only) |
| 415 | Unsupported file type (`/parse/xlsx` only) |
| 422 | Formula error, invalid file, or engine creation failed |
| 503 | Service busy — queue depth or heap threshold exceeded. Retry after `Retry-After` header. |
| 500 | Internal error |

### Formula Error Types

| Type | Description |
|------|-------------|
| `NAME` | Unknown function or syntax error |
| `VALUE` | Wrong argument type |
| `NUM` | Invalid numeric value |
| `DIV_BY_ZERO` | Division by zero |
| `REF` | Invalid cell reference |
| `NA` | Value not available |
| `ERROR` | Generic parse error |

---

## Response `format` Field

All successful `/execute` and `/execute/batch` responses include a `format` field:

| Value | Meaning | Example result |
|-------|---------|----------------|
| `scalar` | Single value (number, string, boolean, null) | `6` |
| `array` | 2D array from spill/array formula | `[[1],[2],[3]]` |

Array formulas (TRANSPOSE, MMULT, FILTER, etc.) that produce multi-cell output return the full result as a 2D array.

---

## Optional `data` Parameter

`/execute` and `/execute/batch` accept an optional `data` field (2D array). When present:

- Formulas can reference cells (e.g. `A1`, `B2:C3`)
- Results are **never cached** (no read, no write)
- Each request gets an isolated engine instance

**Difference with `/execute/sheet`:** The sheet endpoint lets you place formulas at specific cells so they can reference each other and returns the full grid. `/execute` and `/execute/batch` with `data` evaluate independent formulas against shared data and return only formula results.

---

## Locales

All endpoints accept a `locale` field. Non-English locales use `;` as the function argument separator and localized function names.

| Code | Language | SUM equivalent |
|------|----------|----------------|
| `en` | English | `SUM(1,2,3)` |
| `de` | German | `SUMME(1;2;3)` |
| `fr` | French | `SOMME(1;2;3)` |
| `es` | Spanish | `SUMA(1;2;3)` |
| `it` | Italian | `SOMMA(1;2;3)` |
| `pt` | Portuguese | `SOMA(1;2;3)` |
| `nl` | Dutch | `SOM(1;2;3)` |
| `pl` | Polish | `SUMA(1;2;3)` |
| `sv` | Swedish | `SUMMA(1;2;3)` |
| `fi` | Finnish | `SUMMA(1;2;3)` |
| `da` | Danish | `SUM(1;2;3)` |
| `nb` | Norwegian | `SUMMER(1;2;3)` |
| `tr` | Turkish | `TOPLA(1;2;3)` |
| `cs` | Czech | `SUMA(1;2;3)` |
| `hu` | Hungarian | `SZUM(1;2;3)` |
| `ru` | Russian | `SUM(1;2;3)` |

---

## Supported Functions

~400 Excel-compatible functions across these categories:

- **Math & Trigonometry** — SUM, PRODUCT, ROUND, SQRT, SIN, COS, PI, MOD, ABS, ...
- **Statistical** — AVERAGE, MEDIAN, STDEV, VAR, COUNT, COUNTIF, NORM.S.DIST, ...
- **Text** — CONCATENATE, LEFT, RIGHT, MID, UPPER, LOWER, LEN, FIND, SUBSTITUTE, ...
- **Logical** — IF, IFS, AND, OR, NOT, XOR, SWITCH, IFERROR, ...
- **Date & Time** — DATE, TODAY, NOW, YEAR, MONTH, DAY, EDATE, EOMONTH, DATEDIF, ...
- **Financial** — PMT, FV, PV, NPV, IRR, SLN, ...
- **Lookup & Reference** — INDEX, MATCH, CHOOSE, ROW, COLUMN, ...
- **Engineering** — DEC2BIN, HEX2DEC, BITAND, DELTA, ERF, COMPLEX, ...
- **Information** — ISNUMBER, ISTEXT, ISERROR, ISNA, ISEVEN, ISODD, ...
- **Matrix** — MMULT, TRANSPOSE, FILTER, ...
