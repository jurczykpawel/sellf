---
title: "Webhooks"
description: "Sellf delivers events to customer-configured HTTPS endpoints with HMAC-signed payloads, automatic retry, a per-tenant dead-letter queue, and an admin…"
---

Sellf delivers events to customer-configured HTTPS endpoints with HMAC-signed payloads, automatic retry, a per-tenant dead-letter queue, and an admin Replay UI. The model deliberately mirrors what Stripe, Paddle, and Lemonsqueezy do.


## Signing secret rotation

In **Webhooks → Edit**, choose **Generate new secret** and confirm. Alternatively,
call `POST /api/v1/webhooks/{id}/rotate-secret` with an admin session or an API key
with `webhooks:write`. No request body is required. A successful response is
`{ "data": { "id": "…", "secret": "whsec_…" } }`.

The replacement and audit entry are committed atomically. The new secret is
encrypted at rest and returned only in this response; the panel keeps it visible
until you close the edit dialog. Copy it to your receiver's secret store now.
After rotation, list/detail/update API responses return an empty `secret` field;
the value cannot be retrieved again. If you lose it, rotate again. Existing
endpoints keep their current secret until explicitly rotated.

**The old secret is invalidated immediately, with no grace period.** Coordinate
rotation with your receiver and replace its verification secret immediately.
Deliveries can fail during the change. Requests already in flight may still carry
the previous signature; newly loaded deliveries, including retries and test sends,
use the current secret. Rotation does not re-sign an HTTP request already sent.
After updating the receiver, send a test and retry failed deliveries as needed.
Delivery IDs and payloads stay the same: keep deduplicating on `id`.

If the response is lost after the operation commits, the old secret still stops
working. Generate another secret and install the value returned by that request.
Do not automatically repeat rotation requests: each successful call replaces the
secret again.

## Event payload

Every delivery carries this envelope:

```json
{
  "id": "5cb0a355-840e-4d73-8ab9-34137a763c39",
  "event": "purchase.completed",
  "timestamp": "2026-05-23T12:34:56.789Z",
  "data": { /* event-specific */ }
}
```

### Delivery identity and deduplication

Delivery is **at least once**. Sellf persists a delivery before making the HTTP
request. Each endpoint receives its own stable UUID in the top-level `id` and the
`X-Sellf-Delivery-Id` header. Automatic retries and manual retries reuse that ID
and the stored event data. Payload customization cannot replace or remove `id`.
This is an additive envelope field; the existing `event`, `timestamp`, `data`, and
signature format stay the same.

**Deduplicate on this id.** Verify the existing `X-Sellf-Signature` against the
raw body, check that the header ID equals the signed payload ID, and store the ID
with your receiver's work in one database transaction. A duplicate already handled
successfully should return a 2xx without sending another email or repeating other
work. A timeout or an interrupted sender after your endpoint accepts a request
can cause another HTTP attempt with the same ID.

For purchases, one logical delivery is recorded per order/event/endpoint; renewed
subscriptions use the invoice ID as their order identity. A failed license attempt
or interrupted fulfillment is recovered by a subsequent event or verification.
An order recorded as completed does not imply its delivery has finished.

### `purchase.completed` — VAT tax snapshot

Each `product` and every `bumpProducts[]` entry, plus the `order`, carry a tax
snapshot captured from Stripe at purchase. **All amounts are in minor units**
(cents/grosze), matching `order.amount`:

```json
{
  "product": {
    "id": "…", "name": "…", "slug": "…", "price": 10000, "currency": "PLN",
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
- Tax totals and `order.taxSnapshotStatus` are always present; unavailable values are `null`.
  The status (`none` / `captured` / `partial` / `unavailable` / `local`) distinguishes no VAT from missing tax data.

#### Bundles & licenses

When the purchased `product` is a **bundle** (a product that grants access to several component
products), `purchase.completed` also carries the granted components and any issued license keys:

```json
{
  "product": { "id": "…", "name": "Bundle: …", "slug": "…", "net": 19900, "tax": 0, "…": "…" },
  "bundleComponents": [
    { "id": "…", "name": "Course …", "slug": "course-…", "price": 149, "currency": "PLN", "icon": "🤖" }
  ],
  "licenses": [
    { "productId": "…", "token": "<signed-license>", "kid": "…", "jwksUrl": "https://…/api/licenses/jwks?seller=…", "expiresAt": null }
  ]
}
```

- `bundleComponents[]` lists the component products the buyer gained access to through the bundle.
  In tax mode 1a the bundle is a **single** line item carrying its own VAT — components are **not**
  separately taxed lines, so they carry basic product detail without a per-line tax snapshot. The
  field is `[]` for non-bundle purchases.
- Each `licenses[]` entry includes `expiresAt` (ISO 8601 UTC or `null` for a perpetual license), so receivers do not need to decode the token to learn its expiry.
- `licenses[]` carries one entry per product in the order that has license issuance enabled — the
  purchased product itself **and/or** any bundle components. It is omitted when no product in the
  order issues a license.
- **⚠️ Breaking change:** `licenses[]` **replaces** the previous single `license` object. A consumer
  that read `data.license` must switch to `data.licenses[]` (e.g. `data.licenses[0]`).
- **Per-product webhook scoping:** a bundle purchase fires for the bundle **and** every component
  product id, so an endpoint scoped to a component still receives the event.

#### Transfer order paid online

A bank-transfer order the buyer paid by card from the order page sends `purchase.completed` with
`order.settledVia: "stripe"` and the Stripe `order.paymentIntentId` (use it to reconcile or refund);
a transfer booked by the seller has `settledVia: "bank_transfer"` and `paymentIntentId: null`.
`customer.firstName` / `lastName` fall back to the buyer recorded in `orderDetails.buyer`.

#### Purchase source

`purchase.completed` carries `attribution` when the order has a recorded source
([Purchase sources](/purchase-attribution/)). It is frozen at purchase and never contains the ad
click id itself:

```json
"attribution": {
  "channel": "email", "firstChannel": "paid_social", "kind": "payment", "mode": "stored",
  "last": { "source": "listmonk", "medium": "email", "campaign": "mail-05", "content": "cta-1", "term": null,
            "utm_id": null, "referrer_host": null, "landing_path": "/offer", "at": "2026-11-03T10:00:00.000Z" },
  "first": { "source": "facebook", "medium": "paid_social", "campaign": "autumn", "…": "…" },
  "sessionsCount": 3, "daysToPurchase": 4, "clickIdType": null, "deviceClass": "mobile", "country": "PL",
  "affiliateMemberId": null
}
```

### `invoice.paid` — subscription VAT snapshot

`invoice.orderId` and `invoice.orderNumber` identify the Sellf order recorded for this
invoice; `invoice.stripeInvoiceId` retains the Stripe invoice identity.

Recurring subscription charges emit `invoice.paid` (not `purchase.completed`). It carries
an **order-level** VAT snapshot plus the buyer's faktura details, snapshotted by Stripe onto
each invoice at purchase (so they don't change if the buyer later edits their profile):

```json
{
  "event": "invoice.paid",
  "invoice": {
    "stripeInvoiceId": "in_…", "amountPaid": 123.00, "currency": "PLN",
    "net": 100.00, "tax": 23.00, "vatRate": 23,
    "taxBehavior": "exclusive", "taxabilityReason": "standard_rated",
    "taxSnapshotStatus": "captured",
    "nip": "PL1181697228", "taxIdType": "pl_nip", "taxIdCountry": "PL", "companyName": "Firma Sp. z o.o.",
    "address": "ul. Przykładowa 123", "city": "Warszawa", "postalCode": "00-000", "country": "PL"
  }
}
```

- **⚠️ Units differ from `purchase.completed`.** `invoice.paid` amounts (`amountPaid`, `net`,
  `tax`) are in **MAJOR units** (whole currency, e.g. `123.00`) to match `amountPaid`, whereas
  `purchase.completed` uses **minor units** (cents). An integration consuming both events must
  scale accordingly.
- `nip` / address fields appear only for B2B (a tax id on the invoice); `net`/`tax`/`vatRate`
  only when tax was captured (`taxSnapshotStatus: captured`).
- `taxIdType` (`pl_nip`, `eu_vat`, `other`) and `taxIdCountry` follow the company country and
  appear next to `nip` in both `invoice.paid` and `purchase.completed` (`invoice` object); both are
  `null` when there is no tax id. Profile checkouts also store `tax_id_type`, `tax_id_country`
  and, with the optional VIES check, `tax_id_vies` on `orderDetails.buyer`.

For an `invoice.paid` receiver to extend access, use `data.subscription.stripeSubscriptionId`,
`data.invoice.stripeInvoiceId`, `data.product.id`, `data.customer.userId`, `amountPaid`,
`currency` and `paidAt`. The subscription also carries `currentPeriodStart` and
`currentPeriodEnd` (ISO 8601 UTC) from the **paid invoice's recurring line** for that
subscription. They are omitted if no unambiguous non-proration line with a valid period
exists. Do not infer paid access from delivery time or a later subscription update.

For `subscription.canceled` and `subscription.updated`, `subscription.endedAt` is
Stripe's actual `ended_at`, while `canceledAt` is the cancellation/request timestamp.
`endsAt` is the observed access end: actual `ended_at` takes precedence; an immediate
cancellation can fall back to `canceled_at`. A scheduled cancellation uses a recurring
line from a **paid invoice**, not an unpaid renewal's current billing period. If no
paid period can be confirmed, `endsAt` is null. Updated terminal/scheduled events also
use this access end in `currentPeriodEnd`, so receivers cannot mistake an unpaid
billing end for continued access.

`subscription.updated.previousAttributes` holds only the **previous values of normalized
fields that changed** — `status`, `cancelAtPeriodEnd`, `cancelAt`, `canceledAt`, `endedAt`,
`trialEnd`, `currentPeriodStart`, `currentPeriodEnd`, `quantity`, `stripePriceId` (camelCase,
dates as ISO 8601 UTC) — and `changedFields` lists their names. Raw Stripe objects (`items`,
`plan`, invoices) are never forwarded. Fields that changed outside this list produce an empty
`changedFields`.

`subscription.renewal_upcoming` arrives **3 days before the renewal** (`invoice.nextPaymentAttempt`,
or the period end). Stripe announces the upcoming invoice as soon as the renewal enters the
account's window — on many accounts right after checkout, including a 7-day trial — so Sellf
stores the warning and emits it when due. A subscription cancelled, set to cancel at period end
or no longer active by then gets no warning. When the renewal is already within 3 days the
warning goes out immediately.

When a subscription **actually ends** (`customer.subscription.deleted`: immediate cancellation,
or the end of a period the buyer cancelled), Sellf revokes the licenses issued for its invoices:
you receive `license.revoked` with `revocationReason: "subscription_cancelled"` next to
`access.revoked` with the same reason. A cancellation at period end keeps the license valid until
that moment. A subscription that ends **unpaid** (`unpaid` or `incomplete_expired`) loses its
licenses the same way, with `revocationReason: "expired"` (matching `access.revoked`).

### `refund.issued` — refund + credit-note VAT

`payment.orderNumber` is the Sellf order number for the refunded payment (`null` when
unavailable); `payment.id` keeps the Sellf transaction ID.

Fired exactly once per Stripe refund ID (full or partial, from any path). Carries the VAT breakdown of the
refunded amount so you can issue a credit note (faktura korygująca):

```json
{
  "event": "refund.issued",
  "payment": { "id": "…", "amount": 12300, "currency": "PLN", "statusBefore": "completed", "statusAfter": "refunded" },
  "refund": {
    "stripeRefundId": "re_…", "amount": 6150, "currency": "PLN",
    "reason": "requested_by_customer", "status": "succeeded",
    "isFullRefund": false, "totalRefunded": 6150, "refundedAt": "…",
    "source": "stripe_webhook",
    "net": 5000, "tax": 1150, "vatRate": 23,
    "vatExempt": false, "taxabilityReason": "standard_rated"
  }
}
```

- All amounts are in **minor units** (cents/grosze), matching `payment.amount` — like
  `purchase.completed`, unlike `invoice.paid`.
- `amount` is the full amount of this Stripe refund; `totalRefunded` is the cumulative processor total. A partial refund sets `payment.statusAfter` to `partially_refunded` in this payload, the database and payments API.
- `stripeRefundId` identifies the Stripe refund and `status` is its actual processor
  status (`pending`, `requires_action`, `succeeded`, `failed`, or `canceled`), never inferred
  from the payment status. A receiver confirming a full refund must check `status ===
  "succeeded"`, `isFullRefund`, and `totalRefunded >= payment.amount` with a positive payment.
  Later status changes use `refund.updated`, never a second `refund.issued`.
  Repeated identical observations do not create another delivery. Payment details at
  `GET /api/v1/payments/{id}` include `refund.id`, `refund.status` (null if not observed),
  and cumulative `refund.amount` in minor units.
- `net` / `tax` / `vatRate` are the refund's VAT split — present only when the original order
  had a tax snapshot. Across a sequence of partial refunds the credited `tax` sums exactly to
  the order's VAT. `vatRate` is the order's effective (blended) rate.
- `vatExempt: true` marks a **"zw."** order (legal exemption) — distinct from a 0% rate — and
  `taxabilityReason` carries Stripe's reason under Stripe Tax (`reverse_charge`, `customer_exempt`,
  …). Both are omitted when not applicable. Use them to label the credit note correctly.

### `refund.updated` — processor status transitions

Each later status transition of a refund produces one `refund.updated` with the same
customer/product/payment bindings and `refund.stripeRefundId`, `previousStatus`,
`status`, `statusVersion`, full refund `amount`, `currency`, `totalRefunded`, and
`isFullRefund`. `payment.statusAfter` describes the resulting payment state.
For example pending → succeeded keeps the same refund ID, advances statusVersion
from 1 to 2, and sends the full amount. It does not represent another monetary refund
or credit note; VAT adjustments belong to `refund.issued`. Status versions and pending
notifications are persisted, and each endpoint/version has one durable delivery key.
Receivers should retain the highest `statusVersion` per refund ID and ignore older
versions; deliveries and retries may arrive out of order.

### `dispute.created` / `dispute.closed` — payment disputes

These signed events are available for every product, independently of issued licenses
or the `license.revoked` event. Subscribe to the corresponding incoming Stripe events
`charge.dispute.created` and `charge.dispute.closed` on existing Stripe endpoints.
New endpoints registered by Sellf include them automatically.

`data.dispute` carries `stripeDisputeId`, `stripeChargeId`, the actual Stripe `status`
(`needs_response`, `under_review`, `won`, `lost`, etc.), `reason`, `amount` in minor
units, uppercase `currency`, and `createdAt` (ISO 8601 UTC). `data.payment` identifies
`id` (the Sellf transaction), `sessionId`, `paymentIntentId`, `stripeInvoiceId`,
`subscriptionId`, original `amount` and `currency`. `data.product.id` and
`data.customer.userId` / `email` bind it to the buyer. Subscription purchases also
include `data.subscription.id` and `stripeSubscriptionId` when available.

`accessRevoked` and `accessRestored` describe the persisted dispute decision.
Created and lost disputes suspend access. After `won`, the payment returns to its
previous state (`completed` or `partially_refunded`) and access retains its original
expiry. `accessRestored: true` means an entitlement actually returned; a full refund,
a manually deleted grant, an elapsed term or an ended subscription prevents restoration.
Guests recover their original unclaimed purchase. Its saved term also applies when it is
claimed later, even if the product duration has changed. Repeated delivery never extends access.
A win also removes revocation from licenses recorded as revoked by that dispute.
`licenseRestored` and `restoredLicenses` report the actual changed licenses, retaining
their original expiry and token. A manual revocation or refund prevents restoration.
Licenses already revoked before this tracking was introduced are not restored automatically. Receivers should use `accessRestored`
and `payment.statusAfter`, rather than inferring access from `won` alone.
`dispute.restoredAccess` lists each entitlement that actually returned, with
`productId`, `userId` (null for a guest), `grantedAt` and `expiresAt` (null for
permanent access). Guest entries also carry `guestPurchaseId`. Apply this list:
a manually removed main grant may stay absent while a purchased add-on returns.

### `license.issued` / `license.expired` / `license.updated` — Pro

`license.issued` is sent once for every license Sellf records, whatever the path:
purchase, free product, manual issuance in the panel, or `POST /api/v1/licenses`
(`license.issuanceSource` is `purchase`, `manual` or `api`). `license.expired` is sent
once when an active license passes `expiresAt` (checked every 30 seconds by the
business-event cycle); revoked licenses do not expire again.
`license.issued.customer` contains `email` and `userId` (`null` for a guest).
`license.issued` additionally includes `licenseKey`, the signed token needed to deliver a key to the buyer.
Other license lifecycle events never contain the token. Treat the signed webhook body as confidential;
do not write keys to application logs. License subscriptions and dispatch remain Pro-gated.
Supabase buyer emails are optional; manual/API `sendEmail: true` also respects the shop switch.
See [Buyer emails](/buyer-emails/) for the channel policy.

A license issued for an order with an open or lost dispute is recorded as revoked by
that dispute: you receive `license.issued` followed by `license.revoked` with
`dispute.stripeDisputeId`, and `purchase.completed.licenses[]` omits it. A win restores
it (`license.restored`).

`license.updated` is **reserved**: no operation changes an issued license yet. It will be
sent when one exists (tier change, extension, holder change); subscribing now is allowed.

### `license.revoked` / `license.restored` — Pro

Each actual revocation-status change creates a committed notification. Repeating
an unchanged status creates no extra event. Both subscriptions and dispatch require
the Pro license-notification feature; the license state itself is updated regardless
of the shop's current plan.

Both payloads identify `license.id`, `order`, `email`, `tier`, `domain`,
`issuanceSource`, `issuedAt`, `expiresAt`, `revokedAt`, the product and `crlUrl`.
`license.order` is the raw claim signed into the token (payment intent `pi_…`, checkout session,
renewal invoice `in_…`, offline order id or `api_…`); `license.orderId` and `license.orderNumber`
name the Sellf order behind it (null for manual/API issuance without an order). All `license.*`
events carry these fields.
`revocationReason` (top level and `license.revocationReason`) says why the license stopped
working: `refund` (full refund), `dispute`, `manual` (panel or `DELETE /api/v1/licenses/{id}`)
`subscription_cancelled` or `expired` (subscription ended unpaid); it is null while the license is active. Expiry is a separate event
(`license.expired`).
Restoration adds `license.restoredAt`; an associated dispute appears as
`dispute.stripeDisputeId`. The signed token is never included. The original token
can be used again after its revocation is removed; an expired token stays expired.

On either event, invalidate any cached CRL bucket and fetch the current bucket,
then check the token signature and original expiry. The CRL endpoint returns
`Cache-Control: no-store`. Clearing revocation does not extend an expiry date.
To keep a dispute-revoked license revoked even after a win, choose **Keep license
revoked** in issued-license settings. Revocations from earlier versions have no
recorded dispute owner and require a separate seller decision.

### Headers

| Header | Notes |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Sellf-Event` | Event name, e.g. `purchase.completed` |
| `X-Sellf-Delivery-Id` | Stable delivery UUID, equal to the top-level payload `id`. Deduplicate on this id. |
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
| `POST /retry` | Legacy. Claims and updates the same delivery row. Use only for old `failed` rows. |
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

PM2 running the app does not schedule this job. Set `SELLF_URL` and `CRON_SECRET`
in the scheduler environment, and configure this job separately from
`affiliate-sync`. Check the scheduler's output for unsuccessful requests.

Sellf saves each delivery before sending its first attempt immediately, including
**Send test** requests. A test has one attempt and no automatic retries. The
scheduler handles failed or interrupted regular deliveries; it is not required
for their first attempt or for log rows to appear. Delivery history initially
shows all statuses; the failed filter includes scheduled retries and exhausted
deliveries.

### Queue driver selection

The queue lives behind a small interface so the storage backend can swap without touching `WebhookService` or the UI:

```
WEBHOOK_QUEUE_DRIVER=supabase   # default
WEBHOOK_QUEUE_DRIVER=sqs         # AWS SQS stub (throws NotImplemented)
```

A future SQS implementation would replace `pickDue` with `ReceiveMessage`, `markFailed` with `ChangeMessageVisibility`, and `markPermanentlyFailed` with `SendMessage` to a configured DLQ queue. `webhook_logs` would remain the audit log of attempts in either case.

## Stripe checkout expiration

Enable `checkout.session.expired` on the Stripe endpoint that delivers to
`/api/webhooks/stripe`, alongside the completion events. New endpoints created
from Sellf settings include it automatically. For an existing endpoint, add the
event in Stripe Dashboard → Workbench → Webhooks → your endpoint → Edit events.

When a buyer changes the cart or leaves checkout before confirming payment,
Sellf expires the previous Checkout Session and marks its pending transaction
`abandoned`. Returning with the browser's Back button starts at the first step
without creating a session until the buyer continues. Confirmation redirects
keep the active session. Natural expiration does the same reconciliation via
this Stripe event. Completed transactions remain unchanged, and repeated events
are safe to process. Failed reconciliation returns HTTP 500 so Stripe can retry.

If the browser closes before a session-creation response arrives, it cannot send
a later close request, even when creation uses `keepalive`. Keep the expiration
event enabled to reconcile these attempts. While the page remains alive, queued
closure waits for creation to finish. Sellf also retains sessions whose
PaymentIntent is processing, awaiting capture or additional action, or succeeded.

## Order and entitlement contracts

`purchase.completed` always includes `data.order.orderId` (the immutable Sellf payment UUID) and
`orderNumber`, for both Stripe and offline orders. Provider IDs stay in `sessionId` and
`paymentIntentId`; they are not substitutes for the UUID accepted by `GET /api/v1/payments/{id}`.
The detail endpoint includes the provider, order number, due date, transfer instructions,
order details, line items, coupon and invoice summary available on the payment list.

`purchase.completed` and `order.placed`, `order.cancelled`, `order.overdue`, `order.abandoned`
use `data.amountUnit = "minor"`. All declared monetary fields are minor units of their currency:
`order.amount/grossTotal/netTotal/taxTotal`, product/bump/component `price/net/tax/gross`, and
`lines[].unit_price/total_price/discounted_total/net_amount/tax_amount/gross_amount`.
A configured unit price remains a unit price; tax snapshots and order totals include quantity.
For PLN/USD the multiplier is 100; JPY has no fractional unit. `quantity` and VAT percentages are not money.
These webhook units differ from the stored line-price fields returned by the v1 payment API.

Every order carries `taxSnapshotStatus`: `none`, `captured`, `partial`, `unavailable` or `local`.
Unknown net/tax values are explicitly `null`, never invented zeroes. `grossTotal` is the saved
payment amount. Product/line `vatRate` is a percentage or `null`; `unavailable` does not mean VAT-exempt.

Transfer `order.*` events include `access.policy` (`on_placement` or `after_payment`) and
`access.grants[]`: `productId`, `status`, `grantedAt`, `expiresAt`. A grant may be `granted`,
`pending_confirmation`, `pending_payment`, `expired`, or `revoked`. Dates are read from saved access;
for a pending grant they are not assigned yet. A `null` expiry on a granted entitlement means unlimited access.

| Event | Consumer decision and identifiers |
|---|---|
| `order.abandoned` | A pending checkout ended without payment: internal order/provider IDs, old/new status, customer, amount and VAT. |
| `seats.held` | Seats reserved: reservation, order, product, session/tier, session date and quantity. |
| `seats.confirmed` | Seats confirmed: same identifiers with the actual previous/new reservation status. |
| `seats.released` | Seats released: same identifiers and reason (`order_abandoned`, `order_cancelled`, `payment_refunded`, `hold_expired`, or `reservation_released`). |
| `access.granted` | Entitlement created, including free grants, purchases and guest claims. |
| `access.updated` | Saved entitlement dates or source changed, including administrative extensions. |
| `access.revoked` | Entitlement record removed; includes the effective revocation time and `revocationReason`. |
| `access.expired` | Saved expiry passed; one notification per grant/expiry, including after renewal. |

### Unpaid transfer orders: lifecycle

Every transfer `order.*` event additionally carries in `data.order`: `status`, `payUrl` (signed link to the order
page: status, transfer details and an "I have sent the transfer" button, valid until `payUrlExpiresAt`),
`reservation` (`timed` — time-limited hold, `invoice` — invoice issued, awaiting payment without expiry, `none`),
`reminderAt`, `releaseAt`, `invoiceHoldAt`, `transferDeclaredAt`, `transferDeclaredNote`, `cancelReason`,
`cancelReasonText`, `reopenedAt`; `data.customer.locale` is the buyer language (`pl`/`en`). Integrators use these fields to issue
their own proforma, invoice or mail (n8n, Listmonk). Each event is delivered once per order.

| Event | When | What the receiver can do |
|---|---|---|
| `order.placed` | A transfer order is placed. | Confirmation with `payUrl`; `releaseAt` is the event reservation deadline. |
| `order.payment_reminder` | `reminderAt` (default 24 h) passed without payment or invoice. | Reminder "pay by `releaseAt`" with the link. |
| `order.transfer_declared` | The buyer clicked "I have sent the transfer" (once). | Check the bank statement; `releaseAt` is already extended (default 72 h). |
| `order.invoice_issued` | An invoice was issued for the unpaid order (in Sellf or via `POST /api/v1/payments/:id/invoice-issued`). | Status "invoice issued, awaiting payment": `reservation = invoice`, `releaseAt = null`, no expiry. |
| `order.cancelled` | Cancellation: `cancelReason = payment_window_expired` (automatic after `releaseAt`) or `admin` with the administrator's text in `cancelReasonText`. `reservation = none`, `reminderAt`/`releaseAt` are `null`. `customer.userId` matches `seats.released`. | Tell the buyer, correct the invoice; `lateTransferPolicy = admin_decision`. |
| `order.overdue` | The due date of an order without a timed hold passed. | Dunning. |
| `order.reopened` | An administrator accepted a transfer that arrived after cancellation (order price, even over the seat limit). | Match the payment: `previousStatus = cancelled`; `purchase.completed` follows. |
| `order.participants_updated` | The buyer added the participant list after payment (product option "add participants later"). Sent once per order. | `orderDetails.participants.people` holds the full list (`first_name`, `last_name`, `email`), `orderDetails.quantity.value` the count; `purchase.completed` carried an empty list. |

The timed reservation applies to events and is configured by the seller (Settings → Payments → Bank transfer).
Regular products never expire. Schedule `/api/cron?job=transfer-reservations` every 5 minutes.

Access events carry `customer`, `product`, `access.id`, `grantedAt`, `expiresAt`,
`statusBefore/statusAfter`, `reason` and `actor` (`user`, `api_key`, or `system`; system ID is null).
`access.granted` and `access.updated` also carry `grantSource`: how the access was obtained, recorded
once when it was granted (`purchase`, `bundle`, `bank_transfer`, `subscription`, `free`, `manual`, or
`unknown` for grants older than this field). Prefer `grantSource` over `reason`: `reason` is kept unchanged
for existing integrations, but can be inferred (for example `free_product` from the price), so a paid
product claimed with a 100% coupon has `grantSource: "free"`.
The root `accessGrantedAt/accessExpiresAt` aliases contain the same saved dates.
`access.granted` and `access.updated` also carry `accessEndsAt`: the saved expiry, or for a
subscription the end of the current paid period (null for unlimited access). A subscription
sends `access.updated` (`reason: "subscription_renewed"`) **once per renewed period**; repeated
Stripe events for the same period do not produce further updates.
`access.revoked` and `access.expired` carry `revocationReason`: `refund`, `dispute`, `manual`,
`subscription_cancelled` or `expired` (a subscription that ended unpaid, or a natural expiry).
`reason` keeps its original meaning (where the access came from: `purchase`, `subscription`, …).
`sourceOrders` contains related saved orders; `sourceOrder` is populated only when there is one
unambiguous order. Manual or unlinked grants may have no order. `occurredAt` records the change,
while the envelope timestamp records delivery preparation. Consumers should use the explicit
state and dates, not infer access from payment status or from the time a webhook arrives.

Changes are captured transactionally and delivered through the signed queue with stable keys.
A retry retains its delivery ID. Deduplicate that ID at the receiver. Long-running production
servers process changes and expiries every 30 seconds; builds and test fixtures do not start
background processing. Serverless deployments must schedule the authenticated
`/api/cron?job=business-events` endpoint. The existing `access-expired` job uses the same producer.
Keep the existing webhook-delivery retry job configured for transient HTTP failures.

Delivery order across workers or retries is not guaranteed. Apply access state by `occurredAt` per grant, ignoring an older transition that arrives later.

The `{{order_id}}` substitution prefers the internal UUID when available; provider references and existing delivery keys are unchanged.

### Free-checkout custom answers

Free checkout uses the same product-defined field validation as paid checkout. Before sending
a signup link, validated answers are stored in a private request context. The link carries
an opaque UUID, not the domain or other answers. Confirmation binds that context to the
verified buyer and product. Pending grants from another sign-in consult the same store;
they do not depend on editable user metadata or put the answer data into the authentication JWT.

The grant saves `custom_field_values`, and `access.*` and `lead.captured` expose the normalized
snapshot as `customFieldValues`. License issuance receives that snapshot, including
`_sellf_license_domain`. Repeated confirmation retains the same free order key
`free_<userId>_<productId>` and existing issued token. Pending contexts have a 30-day lifetime;
claimed contexts are cleaned after one day, while the grant snapshot remains available.

Manual issuance uses the product's domain definition too: a required domain field must be
filled, an optional one can be omitted, and a product without that field issues a token
without `claims.domain`. Missing required values return HTTP 400 before signing.

## Invoice, partner, refund-request and catalogue events

These events are captured transactionally with the change, like access events, and delivered through
the same signed queue. Each carries `actor`, `occurredAt` and (except payouts) `product`. Monetary
fields are minor units (`amountUnit = "minor"`). A redelivered queue entry keeps its delivery key, so
the receiver gets it once; still deduplicate by envelope `id`.

| Event | When | Fields for the receiver's decision |
|---|---|---|
| `invoicing.issued` | The invoicing provider (Fakturownia) issued the sales invoice. | `invoice.id/number/providerInvoiceId/viewUrl/attempt/paymentSynced`, `order` (ID, number, amount, currency), `customer`. |
| `invoicing.failed` | An issue attempt failed. Sent once per attempt. | `invoice.attempt`, `invoice.error` (provider message), `invoice.willRetry` (`false` after the 5th attempt). |
| `invoicing.corrected` | An issued invoice was marked as corrected. | `invoice.number`, `statusBefore/statusAfter`, `order`. |
| `commission.accrued` | A partner earned a commission on a paid order. | `partner` (memberId, code, displayName, status), `commission.amount/currency/baseAmount/eligibleAt/paidAt/livemode`, `order`. |
| `commission.reversed` | A refund reversed (part of) a commission. | `commission.amount` is negative; same identifiers. |
| `payout.reserved` | The owner approved commissions into a payout (reservation). | `payout.id/amount/currency/cutoff/payeeReference/commissionIds`, `partner`. `product` is `null`. |
| `payout.paid` | The payout was marked as paid. | `payout.bankReference/invoiceReference/bankAmount/paidAt`. |
| `payout.cancelled` | A reserved payout was cancelled; commissions return to the balance. | `payout.statusBefore = "reserved"`. |
| `refund.requested` | A buyer filed a refund request. | `refundRequest.id/requestedAmount/currency/reason`, `order`, `customer`. |
| `refund.request_approved` / `refund.request_rejected` / `refund.request_cancelled` | The request was decided or withdrawn. | `refundRequest.statusBefore/statusAfter/adminResponse/processedAt`. The money movement itself is `refund.issued`. |
| `product.published` / `product.unpublished` | `is_active` changed, or an active product was created/deleted. | `product` (id, slug, isActive, availableFrom/Until, productType), `availability.before/after`, `deleted`. |
| `product.price_changed` | Price, sale price, sale end, recurring price or currency changed. | `price.before/after` with `price`, `salePrice`, `salePriceUntil`, `recurringPrice`, `currency` in minor units. |
| `product.sold_out` | Held (unexpired) plus confirmed seats reached an event session's capacity. | `session.id/label/startsAt/capacity/taken/remaining`, the `reservation` that filled it. Seats freed later are reported by `seats.released`. |

`actor` is the authenticated admin (`user`) or API key (`api_key`) for changes made through the admin panel or the v1 API, and `system` for automatic changes (sync, scheduled jobs, buyer actions report `user`). A refund request returned to `pending` after a failed Stripe refund is announced again as `refund.requested` with `statusBefore = "approved"`.

A partner commission becomes payable when `eligibleAt` passes; Sellf does not send a separate event
for that moment, the approval point is `payout.reserved`. Publication windows (`availableFrom/Until`)
are reported in the payload but their passage in time does not produce an event.

## PlayerStack leads

[Email-confirmed lead forms and marketing consent](/playerstack-leads/).


### Buyer notification data

See [Buyer emails](/buyer-emails/). All amounts below use minor currency units.

| Event | Data for the mail sender |
| --- | --- |
| `order.placed`, `order.payment_reminder` | `customer.email/locale`, `order.transfer` (holder, account, bank, title), `order.amount/currency`, `order.paymentDeadline`, `order.payUrl`, reservation and release dates, line items. |
| `order.cancelled` | Same order identity, `order.cancelReason` and `order.cancelReasonText`. |
| `purchase.completed` | Customer, products, amount, order identity, `order.settledVia`; confirms received payment for both Stripe and bank transfers. `customer.locale` and `buyerMail.event_date/event_online_url` carry the same entitled event details used by Supabase mail (online URL omitted without access). |
| `order.participants_needed` | Customer email/locale, product id/name/slug, order id/number/amount/currency/status, `orderDetails`, `reminder.stage` (1: after 24h; 2: two days before event), `reminder.participantsUrl` (personal link). Stable delivery identity per order and stage. No extra paid-event gate; normal webhook registration rules apply. |
| `license.issued` | `licenseKey` plus customer, product, tier, expiry and order identity. Pro-gated as before. |

The participant link and license key are delivery credentials. Send them only to the intended buyer, validate the webhook signature, and exclude them from application logs. The persistent queue encrypts license-issuance and participant-notice bodies for retries with the instance APP_ENCRYPTION_KEY; webhook log views contain the encrypted representation.

### Buyer language and confirmed leads

`data.customer.locale` is always present (`pl` or `en`) in `purchase.completed`, `license.issued`, `order.placed`, `order.payment_reminder`, `order.cancelled`, `order.participants_needed`, `refund.issued`, `lead.captured`, `waitlist.signup`, `access.expired`, and subscription events that carry a customer. The language is taken from that order, transaction, subscription or lead, rather than another purchase by the same email address. Older records without a saved language use the shop default: `shop_config.custom_settings.default_locale` (`pl` or `en`, configurable through the shop configuration API). If unset, the application default applies. Waitlist requests accept an optional `locale` with the same values. Retry deliveries keep their original language. Endpoint field selection can intentionally omit customer fields. A confirmed product lead emits one `lead.captured` containing the lead ID, source, consent snapshot and confirmation dates together with the product details, access dates, custom answers and license when issued. Confirming the same lead again retains its delivery key. List-only signups retain the lead and consent fields without product access.
