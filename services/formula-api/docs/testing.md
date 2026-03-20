# Testing

**All tests require a running server** (Docker container on port 3000).

## Test suites

```sh
npm test                   # formulas (395+ formulas, all categories)
npm run test:e2e           # locales, caching, errors, edge cases
npm run test:workers       # concurrency, error serialization, large batches
npm run test:parse         # xlsx upload/parse, round-trip
npm run test:calc          # calculator CRUD, execute, schemas, transforms, cache
npm run test:ratelimit     # per-account rate limiting (needs ADMIN_API_URL)
npm run test:generate      # xlsx generation, styling, round-trip
npm run test:expressions   # named expressions, inline, parse, calculator
npm run test:engine        # cycle resolution, preserveStrings, output errors
npm run test:all           # all *.test.js files
npm run test:load          # autocannon load test
```

## Required env vars

| Var | Purpose |
|---|---|
| `ADMIN_TOKEN` | Must match the container's `ADMIN_TOKEN` |
| `FORMULA_TEST_TOKEN` | Must match the container's `FORMULA_TEST_TOKEN` (auth for `/execute*` routes) |

Both must be set in the container `.env` **and** passed to the test runner.

```sh
ADMIN_TOKEN=... FORMULA_TEST_TOKEN=... npm run test:all
```

Custom server: `API_URL=http://localhost:3001 npm test`

## Test file details

| File | Focus |
|---|---|
| `formulas.test.js` | 12 function categories, batch, sheet, caching, errors, format, array/spill |
| `e2e.test.js` | 16 locales, caching isolation, fingerprint blocking, multi-sheet |
| `workers.test.js` | Parallel dispatch, error serialization, 500-formula batch, event loop |
| `multisheet.test.js` | Cross-sheet formulas, sheet name edge cases, formula-to-formula refs |
| `parse.test.js` | Xlsx upload: values-only, formulas-only, mixed, multi-sheet, errors |
| `generate.test.js` | Xlsx generation: values, formulas, highlights, comments, formats, auth |
| `calculators.test.js` | CRUD, describe, execute, transforms, result cache, oneOf, errors |
| `rate-limit.test.js` | RPS + monthly quota, mock Admin API on port 19876 |
| `expressions.test.js` | Named ranges, VLOOKUP, calculator + expressions, generate round-trip |
| `engine-features.test.js` | preserveStrings, rewriteFormulas, cycles, output errors, inline |
| `load.js` | Throughput via autocannon (req/s, latency p99) |

## Smoke test (no test runner)

```sh
curl -X POST localhost:3000/execute -H "Content-Type: application/json" -H "X-Auth-Token: $FORMULA_TEST_TOKEN" -d '{"formula":"SUM(1,2,3)"}'
curl -X POST localhost:3000/execute -H "Content-Type: application/json" -H "X-Auth-Token: $FORMULA_TEST_TOKEN" -d '{"formula":"SUM(A1:B2)","data":[[1,2],[3,4]]}'
curl localhost:3000/health
```
