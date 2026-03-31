# 04. Formula-API Gateway Auth Path

**Service:** cross-cutting (formula-api + gateway)
**Status:** completed
**Depends on:** GW-01 (Resource Permissions)

---

## Goal

Formula-api accepts gateway-authenticated requests alongside legacy token auth. Gateway signs requests with HMAC-SHA256; formula-api verifies the signature and trusts the gateway's auth decision.

---

## Auth Flow

```
Client → Gateway (validates API key + permissions)
  → adds X-Gateway-Signature, X-Gateway-Timestamp, X-Account-Id
  → forwards to formula-api

Formula-api:
  1. Check X-Gateway-Signature header → if present, verify HMAC
  2. Else check X-Auth-Token → legacy per-calculator token
  3. Neither → 401
```

## HMAC-SHA256 Signature

```
payload = timestamp + "." + method + "." + path + "." + body_hash
signature = HMAC-SHA256(shared_secret, payload)
```

- Shared secret: `GATEWAY_SHARED_SECRET` env var (both services)
- Timestamp tolerance: 30 seconds (replay protection)
- Body hash: SHA256 of request body (empty string if no body)

---

## Key Tasks

- [ ] Gateway: sign outbound requests to formula-api with HMAC
- [ ] Formula-api: `verifyGatewaySignature()` middleware
- [ ] Dual-auth: gateway headers OR legacy X-Auth-Token (either works)
- [ ] Timestamp validation — reject if >30s drift
- [ ] Extract account_id from X-Account-Id header (gateway-authenticated)
- [ ] Shared secret rotation support (accept current + previous key)
- [ ] Unit tests for signature generation and verification
- [ ] Integration test: gateway → formula-api end-to-end

---

## Key Files

- `services/gateway/internal/proxy/signer.go` (new)
- `services/formula-api/src/middleware/gateway-auth.js` (new)
- `services/formula-api/src/middleware/auth.js` (modify — add dual-auth)
