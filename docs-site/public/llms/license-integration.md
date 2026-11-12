# Sellf license keys: integration contract

> Technical reference for developers and AI agents that add Sellf license checks to an
> application. Human guide: https://docs.sellf.app/license-integration/
> Everything below describes the current Sellf source. Replace `https://your-sellf.example`
> with the seller's Sellf address.

## 1. Model

- The seller sells a product in Sellf with "Issue a license key on purchase" enabled.
- On a completed purchase (or a free claim, manual issuance in the panel, or `POST /api/v1/licenses`)
  Sellf signs a license token with the seller's private key and records it.
- The application verifies the token OFFLINE with the seller's public key. No call to Sellf is
  needed per check.
- Revocation (refund, chargeback, manual, ended subscription) is published as a list of
  SHA-256 hashes of the token's `order` claim. The application checks it periodically.
- Issuing license keys requires a Sellf Pro license on the seller's instance
  (feature `license-key-issuance`).

The application never holds the private key and never needs a Sellf API key to verify licenses.

## 2. Token format

```
<payload>.<signature>
```

- `payload` = base64url (no padding) of the UTF-8 JSON claims.
- `signature` = base64url (no padding) of an ECDSA P-256 / SHA-256 signature, **DER-encoded**
  (the default output of Node `crypto.sign`, PHP `openssl_sign`, Python `cryptography`).
  WebCrypto produces/expects raw `r||s` (IEEE P1363) instead; convert if you use WebCrypto.
- The signed bytes are the ASCII `payload` string itself (the part before the first `.`),
  not the decoded JSON.
- Split on the FIRST `.` only.
- Algorithm label published with the key: `ES256`.

### Claims

| Claim | Type | Meaning |
|---|---|---|
| `v` | `1` | Format version. Reject anything else. |
| `kid` | string | Signing key id: first 16 hex chars of SHA-256 of the public key PEM. Selects the key from JWKS. |
| `product` | string | Product slug in Sellf. Check it equals your product. |
| `email` | string | Buyer email (normalized). |
| `order` | string | Opaque order reference the license belongs to. Examples: Stripe payment intent `pi_…`, checkout session, renewal invoice `in_…`, offline order id, `free_<user>_<product>` for free claims, `manual_<uuid>` / `api_<uuid>` for manual and API issuance. Do not parse it; use it as-is for revocation. |
| `tier` | string \| null | "License tier" set on the product (free text, e.g. `pro`). |
| `iat` | number | Issued at, Unix seconds. |
| `exp` | number \| null | Expiry, Unix seconds. `null` = never expires. Set to `iat + days * 86400` from the product's "Validity (days)" (1 to 36500). |
| `domain` | string (optional) | Present only when the product has the "License domain" checkout field and the buyer filled it. Bare lowercase host, no `www.`, no scheme. |
| `custom_<field_id>` | string (optional) | Other custom checkout field answers (`-` in the field id becomes `_`). |

Unknown extra claims may appear; ignore the ones you do not use.

Example decoded payload:

```json
{
  "v": 1,
  "kid": "3f9a1c0b7e2d4a65",
  "product": "my-app-pro",
  "email": "buyer@example.com",
  "order": "pi_3PxExample",
  "tier": "pro",
  "iat": 1762790400,
  "exp": 1794326400,
  "domain": "example.com"
}
```

## 3. Public keys (JWKS-like endpoint)

```
GET https://your-sellf.example/api/licenses/jwks?seller=<seller-uuid>
```

- `seller`: the seller's UUID. It is part of the "JWKS URL" shown in Sellf under
  Settings → License → License signing key, and of `jwksUrl` in webhook payloads.
- No authentication.
- `200`:
  ```json
  { "keys": [ { "kid": "3f9a1c0b7e2d4a65", "alg": "ES256", "pem": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n" } ] }
  ```
  `pem` is an SPKI PEM of an EC P-256 public key. Header `Cache-Control: public, max-age=300, s-maxage=300`.
- `400 {"error":"Bad request"}` when `seller` is missing or not a UUID.
- `429 {"error":"Rate limited"}` above 60 requests per minute per client.
- `500 {"error":"Server error"}`.
- An unknown seller returns `200 {"keys": []}`.

Important: only the seller's ACTIVE key is published. When the seller generates or uploads a
new signing key, the previous key is deactivated and disappears from this list, so tokens
signed with it no longer verify against the list. If your application must keep accepting
older tokens after a rotation, keep a copy of the old public key in the application.

Caching: cache keys for at least 5 minutes. Keep the last good copy and use it when Sellf is
unreachable. Do not fetch on every license check. Before replacing the cache, validate the
response: an object whose `keys` is an array of `{kid: string, alg: string, pem: string}`;
anything else counts as a failed fetch (`{"keys": []}` is a valid, empty answer).
When a token's `kid` is not in the cached list, refresh the list once before rejecting, and
rate-limit these forced refreshes (for example once a minute), so a key signed right after a
rotation works without hammering the endpoint.
Cold start: with no cached or saved key and Sellf unreachable, the signature cannot be checked.
Never skip it; the application must decide what to do meanwhile (keep its previous decision,
free mode, retry later). Saving the last key list (it is public) lets a restart survive an outage.

## 4. Revocation list (k-anonymity range query)

```
GET https://your-sellf.example/api/licenses/revoked?seller=<seller-uuid>&prefix=<4 hex chars>
```

1. `h = lowercase hex SHA-256(UTF-8 bytes of claims.order)` (64 chars).
2. `prefix = h[0:4]` — exactly 4 lowercase hex chars (`^[a-f0-9]{4}$`). No other length is accepted.
3. Call the endpoint. `200`:
   ```json
   { "order_hashes": ["6270e1…(64 hex)", "…"] }
   ```
   It lists every revoked order hash of that seller starting with the prefix. An empty
   array means nothing in that bucket is revoked.
4. The license is revoked when `h` is in `order_hashes`.

- No authentication. Header `Cache-Control: no-store`.
- `400 {"error":"Bad request"}` for a missing/invalid `seller` or `prefix`.
- `429 {"error":"Rate limited"}` above 60 requests per minute per client.
- `500 {"error":"Server error"}`.
- The application sends only the prefix, never the token or the full hash. The endpoint does not
  return the whole list in a single request.

What puts an order on the list: full refund, order cancellation, chargeback (dispute), manual
revocation in the panel or `DELETE /api/v1/licenses/{id}`, a subscription that ended unpaid, and
a subscription license whose paid period ended after cancellation (even if the token's `exp`
is later). Partial refunds do not revoke. A won dispute can restore the license
(`license.restored`) unless it was revoked independently (for example a full refund or a manual
revocation); the original token then works again until its own `exp`.

Caching: cache each prefix bucket (5 minutes is a reasonable default). Before replacing a
bucket, validate the response: `order_hashes` must be an array of 64-character lowercase hex
strings; anything else counts as a failed fetch and the last good bucket stays.
On a verified `license.revoked` webhook, add SHA-256(`data.license.order`) to its bucket at once
and mark the bucket for refresh. On `license.restored`, mark the bucket for refresh only. In both
cases keep the known content until a refresh succeeds; never clear it first. Version each bucket
and bump the version on every webhook: a response to a request started before the webhook must
not replace the bucket or mark it fresh. Only a refresh started after the webhook may replace it
(this is how `license.restored` lifts a revocation). After the request, and on errors, read the
current bucket rather than a snapshot taken before the request.
When Sellf is unreachable: keep the last known bucket. With nothing known for that bucket, decide
explicitly whether to allow the license ("fail open", so an outage does not lock out a paying
buyer) or block it.

## 5. Verification algorithm

```
input: token, expectedProduct, instanceDomain (optional)
1. Trim. Split at the first ".". Both parts non-empty, else MALFORMED.
2. claims = JSON.parse(base64url_decode(payload)). Must be an object with v === 1,
   string kid/product/order, number iat, exp number or null. Else MALFORMED.
3. key = keys.find(k => k.kid === claims.kid). None: refresh keys once (rate-limited), retry;
   still none: UNKNOWN_KEY.
4. ECDSA-P256-SHA256 verify(key.pem, data = ASCII payload, sig = DER(base64url_decode(signature))).
   False or error: SIGNATURE.
5. If claims.exp !== null and claims.exp < now_unix_seconds: EXPIRED.
6. If claims.product !== expectedProduct: WRONG_PRODUCT.
   (All products of one seller share the same key, so this check matters.)
7. If claims.domain is present: the instance domain (from the application's trusted
   configuration, lowercase, without "www." and trailing ".") must equal claims.domain or end
   with "." + claims.domain. Not configured or no match: WRONG_DOMAIN.
8. Revocation (section 4). Revoked: REVOKED.
9. Valid. Use claims.tier for feature gating.
```

Never trust a decoded claim before step 4 succeeds.

Reference implementation in TypeScript (Node 18+/Bun, no dependencies), PHP and Python:
https://docs.sellf.app/license-integration/#verify-the-key-in-your-app

## 6. Webhooks (optional, in addition to periodic checks)

Envelope (every event):

```json
{ "id": "<delivery uuid>", "event": "license.revoked", "timestamp": "2026-11-10T12:00:00.000Z", "data": { } }
```

Headers: `X-Sellf-Event`, `X-Sellf-Delivery-Id` (equals `id`), `X-Sellf-Signature: t=<unix>,v1=<hex>`
where `v1 = HMAC-SHA256(endpoint secret, "<t>.<raw body>")`. Verify against the raw body, reject
`t` outside a tolerance window (e.g. 5 minutes either way), compare in constant time, deduplicate
on `id`. Webhooks can arrive late or not at all, so keep the periodic revocation checks. Details: https://docs.sellf.app/webhooks/

License events (all require Sellf Pro, feature `license-revoked-webhook`):
`license.issued`, `license.revoked`, `license.restored`, `license.expired`, `license.updated`.

`data` for all `license.*` events:

```json
{
  "customer": { "email": "buyer@example.com", "userId": null, "locale": "en" },
  "license": {
    "id": "<issued license uuid>",
    "order": "pi_3PxExample",
    "email": "buyer@example.com",
    "tier": "pro",
    "domain": "example.com",
    "issuanceSource": "purchase",
    "issuedAt": "2026-11-10T12:00:00.000Z",
    "expiresAt": "2027-11-10T12:00:00.000Z",
    "revokedAt": null,
    "orderId": "<sellf order uuid or null>",
    "orderNumber": 1042,
    "revocationReason": null
  },
  "revocationReason": null,
  "product": { "id": "<product uuid>", "name": "My App Pro", "slug": "my-app-pro" },
  "crlUrl": "https://your-sellf.example/api/licenses/revoked?seller=<seller-uuid>"
}
```

- `license.issued` additionally carries `licenseKey` (the signed token). It is the event to use
  for emailing the key to the buyer. No other license event contains the token.
- `revocationReason`: `refund`, `dispute`, `manual`, `subscription_cancelled`, `expired`, or `null`.
- `license.restored` adds `license.restoredAt`.
- `license.updated` = changed expiry in Sellf's records; the signed token is NOT re-issued.
- `purchase.completed` also has `licenses[]`:
  `{ "productId", "token", "kid", "jwksUrl", "expiresAt" }` per licensed product in the order
  (informational; do not send a key email from it).

Treat webhook bodies as confidential (they can contain the key). Do not log tokens.

## 7. Seller-side REST API (needs a Sellf API key, not used for verification)

Base `https://your-sellf.example/api/v1`, header `Authorization: Bearer sf_live_…`.
Scopes: `licenses:read`, `licenses:write` (write implies read). All require Pro.

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/licenses` | `licenses:read` | List, cursor pagination; filters `product_id`, `email`, `status` (`active`/`expired`/`revoked`), `source` (`purchase`/`manual`/`api`). No tokens. |
| POST | `/licenses` | `licenses:write` | Body `{ productId, email, domain?, customFieldValues?, sendEmail?, locale? }`. `201` with the license incl. `token`, `jwksUrl`, `crlUrl`, `emailSent`. `409` when the product does not issue licenses or there is no active signing key. 30 requests/min per key. `domain` is used only when the product has the "License domain" field. |
| GET | `/licenses/{id}` | `licenses:read` | One license including `token`. |
| DELETE | `/licenses/{id}` | `licenses:write` | Permanent revocation. |

License object fields: `id`, `productId`, `product {name, slug}`, `email`, `order`, `kid`, `tier`,
`domain`, `issuanceSource`, `issuedAt`, `expiresAt`, `revokedAt`, `revokedByDisputeId`,
`status`, `jwksUrl`, `crlUrl`, and `token` when included.

An application that only verifies licenses needs none of this. Never ship a Sellf API key
inside a distributed application.

## 8. Rules for implementers

- Do: verify signature, `exp`, `product` (and `domain` when present) locally; cache keys and
  revocation buckets and validate responses before replacing them; refresh keys once on an unknown
  `kid`; re-check periodically (on start and every few hours) rather than on every request;
  decide cold-start and fail-open/closed behavior explicitly.
- Do not: call Sellf on every check; store or request the seller's private key; trust claims
  without a valid signature; ignore `exp`; send the full order hash or the token to Sellf;
  log tokens; clear known revocations before a successful refresh.
- Test with a key pair generated locally (EC P-256), signing `base64url(JSON)` with SHA-256 and
  DER output; cover valid, expired, modified payload, other key, unknown kid then rotation,
  wrong product, wrong and missing domain, revoked, revoked after a webhook while offline,
  webhook during an in-flight revocation request (successful and failed),
  malformed 200 responses, cold start offline.
