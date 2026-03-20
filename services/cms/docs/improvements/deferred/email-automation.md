# Deferred: Email Automation

**Status:** deferred
**Combines:** old #15 (Email-to-Calculator) + #16 (Folder-to-RAG) + #17 (Email Drafts)

---

## Why Deferred

- Email-to-RAG depends on RAG system which is deferred
- Email-to-Calculator is possible without RAG but lacks a validated use case
- Email draft integration requires email provider OAuth — significant complexity
- Folder-to-RAG is purely a RAG feeder — deferred with RAG

**When to revisit:**
- When RAG system exists and needs content sources
- When we have concrete customer requests for email-triggered calculations
- When we validate the use case through user research

## Concept (for future reference)

### Email-to-Calculator
- Inbound email webhook (e.g., Mailgun, SendGrid)
- Parse email body for calculator inputs
- Execute calculator, format result
- Reply with result (or create draft for approval)

### Folder-to-RAG
- Connect cloud storage (S3, Google Drive, Dropbox)
- Watch for changes → trigger document ingestion pipeline
- Incremental sync (add/update/delete)

### Email Drafts
- OAuth integration with Gmail / Outlook
- Create draft in user's mailbox with calculated result
- Requires per-user OAuth tokens — significant security/UX concern
