# Flow: AI Assistant

Interacting with the AI chat assistant. Tests conversational AI quality and integration with platform data.

## Prerequisites
- Must be logged in
- Ideally has a calculator or KB data (chain: `first-login+calculator-builder+ai-assistant`)

## Accept Criteria
- [ ] AI assistant is accessible and responsive
- [ ] Can send a message and receive a response
- [ ] Response streams (not just appears all at once)
- [ ] AI is aware of platform context (calculators, formulas, KB if populated)
- [ ] Conversation history persists within session
- [ ] No console errors during chat

## Red Flags
- AI response takes >30 seconds → Performance -2
- AI hallucinates platform features that don't exist → (C) -2
- Chat UI breaks during streaming → (I) -2
- Response is completely generic (no platform context) → (C) -1

## Phases

### Phase 1: Open AI Assistant
**Actions:**
1. Navigate to AI Assistant module
2. Observe the chat interface — is it clear how to start?
3. Screenshot the initial state

**Evaluate:** First Impression, (C) AI Assistant Quality

### Phase 2: Introduction Message
**Actions:**
1. Send a greeting: "Hi, what can you help me with?"
2. Wait for response (note streaming behavior)
3. Evaluate: does it explain its capabilities? Is it platform-aware?

**Evaluate:** (C) AI Assistant Quality

**Persona variations:**
- **Sarah:** "Hey! I'm new here. What can this platform do for my pricing business?"
- **Marcus:** "I need to build financial calculators. What's the best approach?"
- **Anna:** "Can you help me create a calculator for my consulting clients?"
- **Raj:** "What's the API latency for formula execution? Any benchmarks?"

### Phase 3: Task-Oriented Question
**Actions:**
1. Ask something specific to persona's domain
2. Evaluate relevance and actionability of response
3. Ask a follow-up that references the first answer

**Evaluate:** (C) AI Assistant Quality, (D) Knowledge Base Utility (if KB involved)

**Persona messages:**
- **Sarah:** "How do I create a margin calculator that my customers can use?"
- **Marcus:** "Can I use PMT and IRR functions in formulas?"
- **Anna:** "I want to embed a calculator in a client proposal. How?"
- **Raj:** "Show me how to call the formula API with TypeScript"

### Phase 4: Context Awareness
**Actions:**
1. Reference something from earlier in the conversation
2. Note: does the AI remember context?
3. If calculator/KB data exists, ask about it specifically

**Evaluate:** (C) AI Assistant Quality, (H) Cross-Feature Coherence

### Phase 5: Edge Cases
**Actions:**
1. Send an empty message or just whitespace
2. Send a very long message (300+ characters)
3. Send rapid messages (don't wait for response)
4. Note: how does the UI handle these?

**Evaluate:** (I) Error Recovery, Error Handling
