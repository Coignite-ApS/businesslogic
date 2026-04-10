# Flow: Formula Testing

Writing and executing formulas. Tests the formula engine's UX for non-developers.

## Prerequisites
- Must be logged in

## Accept Criteria
- [ ] User can access formula testing interface
- [ ] User can write a formula and execute it
- [ ] Results are displayed clearly
- [ ] Error messages are helpful for syntax issues
- [ ] Formula history/results persist

## Red Flags
- Formula executes but shows no result → (B) -2
- Cryptic error message (e.g., raw stack trace) → (B) -2, (I) -1
- Input lost after execution → (I) -2

## Phases

### Phase 1: Navigate to Formulas
**Actions:**
1. Click Formulas in sidebar
2. Observe the formula interface
3. Note: is there a getting-started guide? Examples?

**Evaluate:** First Impression, (B) Formula Clarity

### Phase 2: Simple Formula
**Actions:**
1. Write a basic formula: `=10 * 5 + 2`
2. Execute it
3. Verify result = 52
4. Note: how fast? Clear result display?

**Evaluate:** (B) Formula Clarity, Performance

### Phase 3: Complex Formula
**Actions:**
1. Try a more complex formula with functions (IF, SUM, etc.)
2. Example: `=IF(100 > 50, "Above target", "Below target")`
3. Note: autocomplete? Function documentation?

**Evaluate:** (B) Formula Clarity

**Persona variations:**
- **Sarah:** `=price * (1 + margin_pct)` — business formula
- **Marcus:** `=PMT(0.05/12, 360, -250000)` — financial function
- **Anna:** `=CONCATENATE("Score: ", ROUND(total/max*100, 1), "%")` — display formula
- **Raj:** Tests nested functions, array formulas, edge cases

### Phase 4: Error Handling
**Actions:**
1. Write an intentionally broken formula: `=IF(, ,)`
2. Note the error message — is it helpful?
3. Try: missing closing paren, unknown function, division by zero
4. For each: does the error point to the problem?

**Evaluate:** (B) Formula Clarity, (I) Error Recovery

### Phase 5: Integration View
**Actions:**
1. Look for API/integration options from formulas
2. Can you get a code snippet to call this formula via API?
3. Check MCP integration references if visible

**Evaluate:** (F) API Integration Ease
