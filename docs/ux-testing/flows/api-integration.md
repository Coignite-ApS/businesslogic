# Flow: API Integration

API keys, code snippets, widget embedding. Tests the developer experience for integrating BusinessLogic.

## Prerequisites
- Must be logged in
- Best with existing calculator (chain: `first-login+calculator-builder+api-integration`)

## Accept Criteria
- [ ] User can find API key management
- [ ] API keys can be created/viewed
- [ ] Code snippets are available and complete
- [ ] Snippets include correct API key and resource IDs
- [ ] Widget embed code is provided
- [ ] MCP integration docs are accessible

## Red Flags
- API key shown in plain text without warning → (F) -1
- Code snippet has placeholder instead of real values → (F) -2
- Widget embed doesn't render or errors → (F) -2

## Phases

### Phase 1: Find API Settings
**Actions:**
1. Look for API key management (Account settings? Sidebar?)
2. Navigate to API keys section
3. Note: how discoverable was it?

**Evaluate:** Navigation, (F) API Integration Ease

### Phase 2: API Key Management
**Actions:**
1. Create a new API key
2. Note the key display/copy experience
3. Check: permissions? Scoping? Expiration?
4. Look for key rotation or revocation options

**Evaluate:** (F) API Integration Ease, Error Handling

### Phase 3: Code Snippets
**Actions:**
1. Navigate to a calculator's integration section
2. Review available code snippets (JavaScript, cURL, Python, etc.)
3. Check: do snippets use the real API key? Real calculator ID?
4. Try copying a snippet — is it clipboard-friendly?

**Evaluate:** (F) API Integration Ease

**Persona variations:**
- **Sarah:** Looks for JavaScript embed snippet — can she paste into her app?
- **Marcus:** Looks for REST API example — wants to understand the request/response
- **Anna:** Looks for widget/embed — wants something visual for clients
- **Raj:** Evaluates TypeScript SDK, checks error handling in snippets, looks for rate limit docs

### Phase 4: Widget/Embed
**Actions:**
1. Find the widget embed option
2. Review the embed code
3. Check: is there a preview? Customization options?
4. Note: does it look professional enough to embed?

**Evaluate:** (F) API Integration Ease, Visual Design

### Phase 5: MCP Integration
**Actions:**
1. Look for MCP-related documentation or config
2. Check if MCP endpoint info is available
3. Note: is MCP explained for non-experts?

**Evaluate:** (F) API Integration Ease, (H) Cross-Feature Coherence
