# #20 — OpenAPI Spec in Integration Tab

**Status:** planned
**Phase:** 4 — Calculator Authoring & Platform
**Priority:** TBD

## Goal

Show OpenAPI 3.0 specification section at the top of the Integration tab so users can document, execute, and describe their calculator API.

## Scope

- Add OpenAPI Specification section at top of API tab
- Three sub-sections beneath it: **Documentation**, **Execute**, **Describe**
- Download OpenAPI 3.0 spec JSON/YAML for the calculator
- Quick-import link to Postman
- Generate spec dynamically from calculator's input/output parameter schema

## Key Tasks

- [ ] Generate OpenAPI 3.0 spec from calculator config (inputs, outputs, endpoint URL)
- [ ] Add OpenAPI section at top of API tab
- [ ] "Download Spec" button — downloads generated spec file
- [ ] "Import to Postman" link — deep link to Postman import
- [ ] Sub-sections: Documentation (spec overview), Execute (try-it / curl examples), Describe (parameter descriptions)

## Acceptance Criteria

- [ ] OpenAPI section visible at top of API tab
- [ ] Spec accurately reflects calculator's current input/output parameters
- [ ] Download produces valid OpenAPI 3.0 spec
- [ ] Postman link opens Postman import flow

## Notes

- Spec should include auth (API token header), base URL, request/response schemas
- Consider also supporting Swagger UI embed or inline try-it panel for "Execute"
