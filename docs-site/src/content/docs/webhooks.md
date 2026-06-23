---
title: "Webhooks"
description: "Sellf delivers events to customer-configured HTTPS endpoints with HMAC-signed payloads, automatic retry, a per-tenant dead-letter queue, and an admin…"
---

Sellf delivers events to customer-configured HTTPS endpoints with HMAC-signed payloads, automatic retry, a per-tenant dead-letter queue, and an admin Replay UI. The model deliberately mirrors what Stripe, Paddle, and Lemonsqueezy do.

## Event payload

Every delivery carries this envelope:

```json
{
  "event": "purchase.completed",
  "timestamp": "2026-05-23T12:34:56.789Z",
  "data": { /* event-specific */ }
}
```

### `purchase.completed` — VAT tax snapshot

Each `product` and every `bumpProducts[]` entry, plus the `order`, carry a tax
snapshot captured from Stripe at purchase. **All amounts are in minor units**
(cents/grosze), matching `order.amount`:

```json
{
  "product": {
    "id": "…", "name": "…", "slug": "…", "price": 100, "currency": "PLN",
    "net": 10000, "tax": 2300, "gross": 12300,
    "vatRate": 23, "vatExempt": false,
    "taxBehavior": "exclusive", "taxabilityReason": "standard_rated"
  },
  "bumpProducts": [ { "id": "…", "net": 5000, "tax": 0, "vatRate": null, "vatExempt": true } ],
  "order": { "amount": 17300, "netTotal": 15000, "taxTotal": 2300 }
}
```

- `vatRate` is the single applied rate, or `null` when a line has **0 or multiple**
  tax components (Stripe Tax can split jurisdictions — the full breakdown is on
  `/api/v1/payments` `line_items[].tax_breakdown`).
- `vatExempt: true` marks a **"zwolniony / zw."** line — distinct from a 0% rate. It
  reflects the seller's per-product exemption **only in `local` tax mode**. Under Stripe
  Tax (`stripe_tax`) Stripe is the sole authority on taxability, so `vatExempt` is always
  `false` and the real reason lives in `taxabilityReason` (a domestic "zw." status never
  suppresses VAT Stripe legitimately charges in another jurisdiction).
- `taxBehavior` is `inclusive` / `exclusive`; `taxabilityReason` carries Stripe's
  reason in `stripe_tax` mode (`reverse_charge`, `customer_exempt`, `zero_rated`, …).
- The tax fields are present only when tax was captured. The order's
  `tax_snapshot_status` (on `/api/v1/payments`: `none` / `captured` / `partial` /
  `unavailable`) distinguishes "no VAT line" from "not computed".

### Headers

| Header | Notes |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Sellf-Event` | Event name, e.g. `purchase.completed` |
| `X-Sellf-Signature` | `t=<unix_seconds>,v1=<sig>` — `v1` is `HMAC-SHA256(secret, "<t>.<raw_body>")` as lowercase hex. The send timestamp `t` is **inside** the signature (replay-resistant), and `v1=` is versioned so the algorithm can rotate. |
| `X-Sellf-Retry-Attempt` | Present on attempts 2 through max; integer (`"2"`, `"3"`, …) |
| `X-Sellf-Retry` | `"true"` on legacy admin Resend (the old `/retry` endpoint) |

The event time stays in the payload body (`timestamp`).

> **Breaking change (v2026.6.4):** `X-Sellf-Signature` switched from a bare body-only hex digest to the timestamped, versioned `t=…,v1=…` scheme below, and the separate unsigned `X-Sellf-Timestamp` header was removed (it was not covered by the MAC, so it could be replayed/tampered freely). Update receivers to the verifier below.

### Signing verification (Node example)

```js
import crypto from 'crypto';

// Reject deliveries whose signed timestamp is too old (replay protection).
const TOLERANCE_SECONDS = 5 * 60;

function verify(rawBody, signatureHeader, secret) {
  // Parse "t=<unix>,v1=<sig>"
  let t = null;
  let v1 = null;
  for (const part of signatureHeader.split(',')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) t = Number(value);
    else if (key === 'v1') v1 = value;
  }
  if (t === null || !v1) return false;

  // Reject stale / replayed timestamps.
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_SECONDS) return false;

  // Recompute over `${t}.${rawBody}` and constant-time compare.
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

## Retry policy and DLQ

When a delivery fails (network error, non-2xx response, SSRF block) the worker retries with exponential backoff before declaring the delivery permanently failed:

| Attempt | Delay before next retry |
|--------:|------------------------:|
| 1 → 2   |                    1 min |
| 2 → 3   |                    5 min |
| 3 → 4   |                   30 min |
| 4 → 5   |                    2 hrs |
| 5 → 6   |                   12 hrs |

After the 5th failed attempt the delivery enters the **dead-letter queue** (status `permanently_failed`). It stays there until an admin clicks **Replay** in `/dashboard/webhooks/deliveries`, at which point the attempt counter resets to 0 and the row goes back to `pending_retry` with `next_retry_at = NOW()` for the worker to pick up.

### Concurrency safety

`pick_due_webhook_deliveries(limit)` uses `FOR UPDATE SKIP LOCKED` plus a 60-second `next_retry_at` lease, so:

- two concurrent cron invocations never dispatch the same delivery
- a worker that crashes mid-dispatch automatically releases its rows after 60 s

### State machine

```
[INSERT after first dispatch]
  → success                                  (dispatch ok)
  → pending_retry                            (fail, retries remain)
  → permanently_failed                       (fail, no retries — only when max_attempts=1)

pending_retry --(worker, ok)-->         success
pending_retry --(worker, fail, <max)--> pending_retry [attempt_count++, exp backoff]
pending_retry --(worker, fail, >=max)--> permanently_failed [failed_permanently_at=now]
permanently_failed --(admin Replay)-->  pending_retry [attempt_count=0, next_retry_at=now]
pending_retry --(admin Cancel)-->       permanently_failed
pending_retry --(admin Force now)-->    pending_retry [next_retry_at=now]
* --(admin Archive)-->                  archived
```

## Admin actions per status

| Status               | Actions                                |
|----------------------|----------------------------------------|
| `success`            | Resend                                  |
| `pending_retry`      | Retry now, Cancel                       |
| `permanently_failed` | Replay, Archive                         |
| `failed` (legacy)    | Retry, Archive                          |
| `retried` / `archived` | view only                            |

`failed` and `retried` are pre-DLQ legacy statuses. New deliveries never land in `failed` — a failed first attempt now produces `pending_retry` with the retry already scheduled.

## REST API

All endpoints under `/api/v1/webhooks/logs/[id]/*` require the `webhooks:write` scope.

| Method & Path | Effect |
|---------------|--------|
| `POST /retry` | Legacy. Creates a new log row and marks the original `retried`. Use only for old `failed` rows. |
| `POST /replay` | DLQ Replay. Only valid for `permanently_failed`; resets `attempt_count` to 0 and re-queues for immediate retry. |
| `POST /force-retry` | Pulls a `pending_retry` row forward to `next_retry_at = NOW()`. |
| `POST /cancel` | Flips a `pending_retry` row to `permanently_failed`. |
| `POST /archive` | Soft-archives any row. |

Listing logs supports filters `status=pending_retry|permanently_failed|all_failed` in addition to the existing `success|failed|archived|retried|all` values. `all_failed` is the union `failed + pending_retry + permanently_failed`.

## Operator setup

The worker is exposed at `/api/cron?job=webhook-deliveries-retry`. Schedule it to fire every minute from any cron source you trust (PM2, system cron, an external scheduler) with the shared `CRON_SECRET` bearer token:

```cron
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$SELLF_URL/api/cron?job=webhook-deliveries-retry" > /dev/null
```

### Queue driver selection

The queue lives behind a small interface so the storage backend can swap without touching `WebhookService` or the UI:

```
WEBHOOK_QUEUE_DRIVER=supabase   # default
WEBHOOK_QUEUE_DRIVER=sqs         # AWS SQS stub (throws NotImplemented)
```

A future SQS implementation would replace `pickDue` with `ReceiveMessage`, `markFailed` with `ChangeMessageVisibility`, and `markPermanentlyFailed` with `SendMessage` to a configured DLQ queue. `webhook_logs` would remain the audit log of attempts in either case.
