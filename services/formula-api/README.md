# Excel Formula API

High-performance Excel formula evaluation API. Evaluate formulas, batch process up to 1000 at once, or run formulas against sheet data with cell references. Supports 16 locales, array/spill detection, and worker-thread concurrency.

## Quick Start

```bash
npm install
npm start
# or
docker build -t formula-api . && docker run -p 3000:3000 formula-api
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/execute` | Single formula (`data?` for cell references) |
| `POST` | `/execute/batch` | Up to 1000 formulas (`data?` for shared dataset) |
| `POST` | `/execute/sheet` | Formulas placed at specific cells in a grid |
| `GET` | `/health` | Health check + cache stats + queue depth |
| `GET` | `/ping` | Lightweight liveness check |

### Single Formula

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "SUM(1,2,3)"}'
```
```json
{"result": 6, "formula": "SUM(1,2,3)", "format": "scalar", "cached": false}
```

### Single Formula with Data

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "SUM(A1:B2)", "data": [[1,2],[3,4]]}'
```
```json
{"result": 10, "formula": "SUM(A1:B2)", "format": "scalar", "cached": false}
```

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "ISBLANK(B1)", "data": [[1]]}'
```
```json
{"result": true, "formula": "ISBLANK(B1)", "format": "scalar", "cached": false}
```

### Array/Spill Formula

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "TRANSPOSE({1,2,3})"}'
```
```json
{"result": [[1],[2],[3]], "formula": "TRANSPOSE({1,2,3})", "format": "array", "cached": false}
```

### Batch

```bash
curl -X POST http://localhost:3000/execute/batch \
  -H "Content-Type: application/json" \
  -d '{"formulas": ["SUM(1,2)", "AVERAGE(10,20,30)", "IF(1>2,\"yes\",\"no\")"]}'
```

### Batch with Shared Data

```bash
curl -X POST http://localhost:3000/execute/batch \
  -H "Content-Type: application/json" \
  -d '{"data": [[100,200],[300,400]], "formulas": ["A1+B1", "A2+B2", "SUM(A1:B2)"]}'
```

### Sheet with Cell References

```bash
curl -X POST http://localhost:3000/execute/sheet \
  -H "Content-Type: application/json" \
  -d '{"data": [[100,200],[300,400]], "formulas": [{"cell":"C1","formula":"SUM(A1:B2)"}]}'
```

### Locales

Pass `locale` to use localized function names and `;` separator:

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"formula": "SUMME(1;2;3)", "locale": "de"}'
```

See [docs/api.md](docs/api.md) for full API reference.

## Documentation

| Doc | Contents |
|-----|----------|
| [API Reference](docs/api.md) | Endpoints, schemas, request/response examples, error codes |
| [Configuration](docs/configuration.md) | Environment variables, locales, caching, blocked functions |
| [Deployment](docs/deployment.md) | Docker, DigitalOcean App Platform, scaling |

## Testing

All tests require a running server (`npm start`).

```bash
npm test              # formulas.test.js — 395+ formula coverage
npm run test:e2e      # e2e.test.js — locales, caching, data param, errors
npm run test:workers  # workers.test.js — concurrency, spill detection, large batches
npm run test:all      # All test suites (381 tests)
npm run test:load     # Load testing with autocannon
```

## License

Licensed under **GNU General Public License v3.0**. See [LICENSE](LICENSE).
