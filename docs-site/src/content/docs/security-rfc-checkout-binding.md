---
title: "RFC: Checkout mutation binding token"
description: "RFC for binding a Stripe checkout session to a server-side record, preventing client-side mutation of checkout parameters."
---

**Status:** Implemented (Option B chosen).
**Scope:** `/api/update-payment-metadata`, `/api/create-payment-intent` (Stripe session expire path).
**Background:** The `clientSecret` returned by Stripe is treated as the sole proof of identity by these two endpoints. Same-origin headers + tightened rate limits already lift the bar, but a leaked `clientSecret` (XSS, log, browser extension, screenshot, support copy-paste) still lets an attacker mutate metadata or expire a stranger's session.

## Options considered

### A — Server-side pending state table

New `pending_checkouts(session_id, client_secret_hash, product_id, user_id, created_at)`. Endpoint requires a row match before performing the operation.

- Pros: full server-side ownership of the session, simple to audit, easy to expire rows.
- Cons: new table + maintenance/cleanup job, extra DB round-trip on every metadata write, schema migration on prod.

### B — HMAC over `(session_id, user_id, product_id)` *(chosen)*

Server signs an opaque token at session-creation time using a per-instance secret. Token is returned alongside `clientSecret`. Endpoint recomputes the HMAC and compares with `timingSafeEqual`.

- Pros: no schema change, no extra DB read, stateless. Self-contained inside the request payload, easy to retrofit.
- Cons: secret rotation invalidates in-flight sessions (acceptable; sessions are short-lived). Token must be transported alongside `clientSecret` everywhere.

### C — Client never holds `clientSecret`; server lookup by `sessionId`

Server keeps the mapping, client just sends an opaque `sessionId`. Server resolves to the Stripe object internally.

- Pros: cleanest abstraction.
- Cons: large refactor — `clientSecret` is currently passed straight to Stripe's Embedded Checkout JS on the page. Removing it forces a custom Stripe Elements flow. Out of proportion to the threat.

## Decision

**Option B**. HMAC token, called `bindingToken`, returned by `create-payment-intent` and required by `update-payment-metadata` plus the session-expire path. Verification is `timingSafeEqual` against a freshly computed HMAC over the same `(session_id, user_id, product_id)` tuple.

### Secret management

- Env var `CHECKOUT_BINDING_SECRET` — 32 bytes of base64. Generated once per deployment.
- Startup assertion: production refuses to boot when the env var is unset (chained into `assertProductionStartupConfig`).
- Rotation: change the env var, restart. In-flight sessions become invalid; users restart their checkout. Acceptable because Stripe sessions are typically valid only a few hours.

### Token format

`base64url(HMAC-SHA256(secret, "v1|<stripe-object-id>|<user-id-or-empty>|<product-id>"))`

- `v1` namespace lets us bump the algorithm later without invalidating in-flight tokens silently — the comparison just fails and the user retries.
- Empty user id slot for guest checkouts; same encoding shape on both paths.

### Verification

`timingSafeEqual` over the decoded bytes. Returns boolean; route maps `false` to `403 Forbidden`. No further detail leaked.

## Threats addressed

- Leaked `clientSecret` alone is no longer sufficient to call mutation endpoints — attacker also needs the `bindingToken`, which is not in URL fragments or screenshots.
- Tampered metadata: attacker who substitutes a different `product_id` in the payload would need to forge a new HMAC.

## Out of scope

- DoS against Stripe's session-create flow (separate rate-limit task).
- General secret rotation tooling.
