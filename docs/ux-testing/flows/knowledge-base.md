# Flow: Knowledge Base

Uploading documents, searching, and asking questions. Tests the KB as a business intelligence tool.

## Prerequisites
- Must be logged in

## Accept Criteria
- [ ] User can access knowledge base module
- [ ] User can create/manage a knowledge base
- [ ] Document upload works (or process is clear)
- [ ] Search returns relevant results
- [ ] Can ask questions and get KB-grounded answers
- [ ] No console errors

## Red Flags
- Upload fails silently → (D) -2, (I) -2
- Search returns nothing for obvious match → (D) -2
- AI answer doesn't cite source documents → (D) -1

## Phases

### Phase 1: Navigate to Knowledge Base
**Actions:**
1. Click Knowledge Base in sidebar
2. Observe the KB interface — any existing KBs?
3. Find the create/manage action

**Evaluate:** First Impression, (D) Knowledge Base Utility

### Phase 2: Create Knowledge Base
**Actions:**
1. Create a new knowledge base
2. Name it appropriately for persona
3. Note the configuration options available

**Evaluate:** Data Entry, (D) Knowledge Base Utility

**Persona variations:**
- **Sarah:** "Pricing Methodology" — business knowledge
- **Marcus:** "Financial Policies & Procedures"
- **Anna:** "Consulting Frameworks"
- **Raj:** "API Documentation & Standards"

### Phase 3: Upload Document
**Actions:**
1. Find the document upload/ingest option
2. Upload a test document (if available) or note the process
3. Observe: progress indicator? Success feedback?
4. Check if document appears in KB after upload

**Evaluate:** (D) Knowledge Base Utility, Performance

### Phase 4: Search
**Actions:**
1. Try searching for content that should be in the KB
2. Try a query that shouldn't match anything
3. Note: speed, relevance ranking, result formatting

**Evaluate:** (D) Knowledge Base Utility

### Phase 5: Ask Questions
**Actions:**
1. Use the "ask" feature (if available) to query the KB
2. Ask a question that requires synthesizing info from docs
3. Check: does the answer cite sources? Is it accurate?

**Evaluate:** (D) Knowledge Base Utility, (C) AI Assistant Quality
