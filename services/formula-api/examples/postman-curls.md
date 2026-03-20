# Postman Import — cURL Commands

Import each curl into Postman: **Import > Raw Text > paste curl**.

Base URL: `localhost:3000` — change to your server.

---

## Health

```bash
curl -X GET http://localhost:3000/health
```

```bash
curl -X GET http://localhost:3000/ping
```

---

## Execute — Single Formula

**Basic formula:**
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "SUM(1,2,3)"}'
```

**With locale (German):**
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "SUMME(1;2;3)", "locale": "de"}'
```

**With data (cell references):**
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "SUM(A1:B2)", "data": [[1,2],[3,4]]}'
```

**Array/spill formula:**
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "SORT({5,3,1,4,2})"}'
```

**Error case (unknown function):**
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "NOTAFUNCTION(1)"}'
```

---

## Execute — Batch

**Basic batch:**
```bash
curl -X POST http://localhost:3000/execute/batch \
  -H "Content-Type: application/json" \
  -d '{"formulas": ["SUM(1,2)", "MAX(3,4)", "AVERAGE(10,20,30)"]}'
```

**Batch with shared data:**
```bash
curl -X POST http://localhost:3000/execute/batch \
  -H "Content-Type: application/json" \
  -d '{"data": [[100,200],[300,400]], "formulas": ["SUM(A1:B1)", "A1*B1", "SUM(A1:B2)"]}'
```

**Batch with locale (Danish):**
```bash
curl -X POST http://localhost:3000/execute/batch \
  -H "Content-Type: application/json" \
  -d '{"formulas": ["SUM(1;2;3)", "MIDDEL(10;20;30)"], "locale": "da"}'
```

---

## Execute — Sheet

**Single sheet:**
```bash
curl -X POST http://localhost:3000/execute/sheet \
  -H "Content-Type: application/json" \
  -d '{"data": [[1,2],[3,4]], "formulas": [{"cell": "C1", "formula": "A1+B1"}, {"cell": "C2", "formula": "SUM(A1:B2)"}]}'
```

**Multi-sheet with cross-sheet references:**
```bash
curl -X POST http://localhost:3000/execute/sheet \
  -H "Content-Type: application/json" \
  -d '{"sheets": {"Sales": [[100,200],[300,400]], "Tax": [[0.1],[0.2]]}, "formulas": [{"sheet": "Sales", "cell": "C1", "formula": "A1*Tax!A1"}, {"sheet": "Sales", "cell": "C2", "formula": "A2*Tax!A2"}]}'
```

---

## Parse XLSX

**Upload and parse:**
```bash
curl -X POST http://localhost:3000/parse/xlsx \
  -F "file=@spreadsheet.xlsx"
```

**Round-trip (parse then execute):**
```bash
curl -s -X POST http://localhost:3000/parse/xlsx -F "file=@spreadsheet.xlsx" | curl -s -X POST http://localhost:3000/execute/sheet -H "Content-Type: application/json" -d @-
```

---

## Calculators — Create

**Simple calculator (two inputs, two outputs):**
```bash
curl -X POST http://localhost:3000/calculators \
  -H "Content-Type: application/json" \
  -d '{
    "sheets": {"Sheet1": [[0, 10], [0, 20]]},
    "formulas": [
      {"sheet": "Sheet1", "cell": "C1", "formula": "A1+B1"},
      {"sheet": "Sheet1", "cell": "C2", "formula": "A2+B2"}
    ],
    "input": {
      "type": "object",
      "properties": {
        "val1": {"type": "number", "mapping": "Sheet1!A1", "default": 0},
        "val2": {"type": "number", "mapping": "Sheet1!A2", "default": 0}
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "sum1": {"type": "number", "mapping": "Sheet1!C1"},
        "sum2": {"type": "number", "mapping": "Sheet1!C2"}
      }
    }
  }'
```

**Multi-sheet calculator with cross-sheet formulas:**
```bash
curl -X POST http://localhost:3000/calculators \
  -H "Content-Type: application/json" \
  -d '{
    "sheets": {
      "Input": [[0]],
      "Rates": [[0.25]],
      "Result": [[null]]
    },
    "formulas": [{"sheet": "Result", "cell": "A1", "formula": "Input!A1*Rates!A1"}],
    "input": {
      "type": "object",
      "properties": {
        "amount": {"type": "number", "mapping": "Input!A1", "default": 0}
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "tax": {"type": "number", "mapping": "Result!A1"}
      }
    }
  }'
```

**Calculator with array output:**
```bash
curl -X POST http://localhost:3000/calculators \
  -H "Content-Type: application/json" \
  -d '{
    "sheets": {
      "Data": [["Rent", null], ["Food", null], ["Transport", null]]
    },
    "formulas": [
      {"sheet": "Data", "cell": "B1", "formula": "100*1"},
      {"sheet": "Data", "cell": "B2", "formula": "200*1"},
      {"sheet": "Data", "cell": "B3", "formula": "300*1"}
    ],
    "input": {
      "type": "object",
      "properties": {
        "multiplier": {"type": "number", "mapping": "Data!C1", "default": 1}
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "expenses": {
          "type": "array",
          "mapping": "Data!A1:B3",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string", "mapping_item": "A"},
              "amount": {"type": "number", "mapping_item": "B"}
            }
          }
        }
      }
    }
  }'
```

**Calculator with data_mappings (auto-populates oneOf):**
```bash
curl -X POST http://localhost:3000/calculators \
  -H "Content-Type: application/json" \
  -d '{
    "sheets": {
      "Input": [[0]],
      "Lookup": [[1, "Alpha"], [2, "Beta"], [3, "Gamma"]]
    },
    "formulas": [{"sheet": "Input", "cell": "B1", "formula": "A1*2"}],
    "data_mappings": [{
      "reference_name": "choices",
      "mapping": "Lookup!A1:B3",
      "items": {
        "id": {"mapping_item": "A"},
        "title": {"mapping_item": "B"}
      }
    }],
    "input": {
      "type": "object",
      "properties": {
        "selection": {
          "type": "integer",
          "mapping": "Input!A1",
          "data_mapping_id": "choices.id",
          "data_mapping_title": "choices.title"
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "result": {"type": "number", "mapping": "Input!B1"}
      }
    }
  }'
```

**Calculator with locale (Danish):**
```bash
curl -X POST http://localhost:3000/calculators \
  -H "Content-Type: application/json" \
  -d '{
    "sheets": {"S": [[0, 10]]},
    "formulas": [{"sheet": "S", "cell": "C1", "formula": "A1+B1"}],
    "input": {
      "type": "object",
      "properties": {"x": {"type": "number", "mapping": "S!A1", "default": 0}}
    },
    "output": {
      "type": "object",
      "properties": {"total": {"type": "number", "mapping": "S!C1"}}
    },
    "locale": "da"
  }'
```

**Calculator with input validation:**
```bash
curl -X POST http://localhost:3000/calculators \
  -H "Content-Type: application/json" \
  -d '{
    "sheets": {"S": [[0]]},
    "formulas": [{"sheet": "S", "cell": "B1", "formula": "A1*2"}],
    "input": {
      "type": "object",
      "required": ["salary"],
      "properties": {
        "salary": {"type": "number", "mapping": "S!A1", "minimum": 0, "maximum": 500000}
      }
    },
    "output": {
      "type": "object",
      "properties": {"doubled": {"type": "number", "mapping": "S!B1"}}
    }
  }'
```

---

## Calculators — Execute

Replace `CALCULATOR_ID` with the `calculatorId` from create response.

**Execute with all inputs:**
```bash
curl -X POST http://localhost:3000/execute/calculator/CALCULATOR_ID \
  -H "Content-Type: application/json" \
  -d '{"val1": 5, "val2": 15}'
```

**Execute with defaults (partial input):**
```bash
curl -X POST http://localhost:3000/execute/calculator/CALCULATOR_ID \
  -H "Content-Type: application/json" \
  -d '{"val1": 100}'
```

**Execute with empty body (all defaults):**
```bash
curl -X POST http://localhost:3000/execute/calculator/CALCULATOR_ID \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Calculators — Get

```bash
curl -X GET http://localhost:3000/calculators/CALCULATOR_ID
```

---

## Calculators — Patch

**Update sheets data (triggers engine rebuild):**
```bash
curl -X PATCH http://localhost:3000/calculators/CALCULATOR_ID \
  -H "Content-Type: application/json" \
  -d '{"sheets": {"Sheet1": [[0, 100], [0, 200]]}}'
```

**Update output schema only (no engine rebuild):**
```bash
curl -X PATCH http://localhost:3000/calculators/CALCULATOR_ID \
  -H "Content-Type: application/json" \
  -d '{
    "output": {
      "type": "object",
      "properties": {
        "sum1": {"type": "number", "mapping": "Sheet1!C1", "title": "First Sum"},
        "sum2": {"type": "number", "mapping": "Sheet1!C2", "title": "Second Sum"}
      }
    }
  }'
```

**Update locale:**
```bash
curl -X PATCH http://localhost:3000/calculators/CALCULATOR_ID \
  -H "Content-Type: application/json" \
  -d '{"locale": "da"}'
```

---

## Calculators — Delete

```bash
curl -X DELETE http://localhost:3000/calculators/CALCULATOR_ID
```
