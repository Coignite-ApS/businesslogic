# Flow: Calculator Builder

Building and testing a calculator from scratch. Tests the core value proposition for non-technical users.

## Prerequisites
- Must be logged in (chain with `first-login+` or have credentials)

## Accept Criteria
- [ ] User can create a new calculator
- [ ] User can add input fields
- [ ] User can write or select a formula
- [ ] Calculator can be tested/previewed
- [ ] Code snippets are available for integration
- [ ] No console errors during builder interactions

## Red Flags
- Formula syntax error with no helpful message → (B) -2
- Preview/test doesn't work → (A) -2
- Lost data on navigation → (I) -2

## Phases

### Phase 1: Navigate to Calculators
**Actions:**
1. Click Calculators in sidebar
2. Observe the calculator list (empty or populated)
3. Find the "create new" action

**Evaluate:** (A) Calculator UX — is the entry point obvious?

### Phase 2: Create Calculator
**Actions:**
1. Click create/new calculator
2. Fill in name and description
3. Explore the configuration options
4. Note: what's required? What's optional? Is there guidance?

**Evaluate:** Data Entry (forms, validation, help text)

**Persona variations:**
- **Sarah:** Names it "ROI Calculator" — wants quick setup
- **Marcus:** Names it "Compound Interest Model" — looks for advanced options
- **Anna:** Names it "Client Value Assessment" — wants it to look professional
- **Raj:** Names it "test-calc-001" — immediately looks for API access

### Phase 3: Configure Formula
**Actions:**
1. Navigate to formula/configuration section
2. Try writing a simple formula (e.g., `price * quantity * (1 - discount)`)
3. Observe syntax highlighting, autocomplete, error feedback
4. Try an intentionally wrong formula — how's the error message?

**Evaluate:** (B) Formula Clarity (syntax help, errors, feedback)

### Phase 4: Test/Preview
**Actions:**
1. Find the test/preview functionality
2. Enter sample input values
3. Execute the calculation
4. Verify result makes sense
5. Try edge cases (zero, negative, very large number)

**Evaluate:** (A) Calculator UX, (I) Error Recovery

### Phase 5: Integration
**Actions:**
1. Navigate to integration/embed section
2. Review available code snippets (JavaScript, API, widget)
3. Check if snippets include the calculator's actual ID/config
4. Try copying a snippet — is it complete?

**Evaluate:** (F) API Integration Ease

### Phase 6: Return to List
**Actions:**
1. Navigate back to calculator list
2. Verify the new calculator appears
3. Check if it shows status/metadata

**Evaluate:** Navigation, (H) Cross-Feature Coherence
