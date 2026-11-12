---
title: Sell licenses for your app
description: Add paid license keys to your own application with Sellf. Setup in the panel, delivery to the buyer, offline verification code, revocation and a ready prompt for your AI agent.
---

You build an application (a self-hosted tool, a plugin, a desktop app) and want buyers to unlock it with a license key. Sellf handles the checkout and issues the key. Your application checks the key itself, without calling Sellf on every check.

This page is for the developer of that application. If you prefer to hand the work to an AI agent, copy the [prompt for your agent](#prompt-for-your-ai-agent) at the bottom.

Technical contract for agents and tools: [`/llms/license-integration.md`](/llms/license-integration.md).

## How it works

1. A buyer pays for your product in Sellf.
2. Sellf creates a **license key**: a short text signed with your private signing key. The key states which product it is for, the buyer's email, the plan (tier) and the expiry date.
3. The buyer gets the key (product page, email, or your own mailer).
4. The buyer pastes the key into your application. The application checks the signature with your **public** key and reads the plan from it. No network call is needed for this.
5. From time to time the application asks Sellf whether the key was revoked (refund, chargeback). It sends only a 4-character fragment of a hash, never the key itself.

Requirements: a **Pro** Sellf license on the instance where you sell (key issuance is a Pro feature). Webhooks are optional; registering one needs at least a Registered license.

## Set up Sellf

### 1. Create a signing key

Open **Settings → License** (`/dashboard/settings?tab=license`) and, in **License signing key**, click **Generate key**. Sellf creates an EC P-256 key pair and keeps the private key encrypted on the server. You can instead **Upload key** with your own EC P-256 private key in PKCS8 PEM (`-----BEGIN PRIVATE KEY-----`).

After that the panel shows:

- **Key ID**: the `kid` written into every key.
- **JWKS URL**: `https://your-sellf.example/api/licenses/jwks?seller=<seller-id>`. Your application downloads public keys from here. The `seller` value is your seller ID; you will need it in the application.

:::caution[Rotating the key]
Sellf publishes only the current signing key. Generating or uploading a new one removes the old public key from the JWKS URL, so licenses signed with it stop verifying in applications that rely on that list. Rotate only when you mean to, or keep the old public key in your application (the code below accepts it through `addTrustedKeys`).
:::

### 2. Turn on licenses for a product

Open the product, go to the **License key** section and enable **Issue a license key on purchase**. Optional fields:

- **License tier**: free text written into the key, for example `pro` or `team`. Your application decides what each tier unlocks.
- **Validity (days)**: 1 to 36500. Leave empty for a key that never expires.

Note the product **slug**. Every key contains it, and your application should accept only keys for its own slug.

To bind a license to the buyer's website, add the **License domain** field in the product's **Custom fields** section (**Add license domain**). The buyer types the domain at checkout and the key covers that domain and all its subdomains.

### 3. How the key reaches the buyer

- **Product page**: a signed-in buyer sees the key on the product page in Sellf. A revoked key is shown without the token.
- **Email from Sellf**: when **Settings → Shop → Buyer emails → Send buyer emails through Supabase** is on, Sellf emails the key with a sign-in link.
- **Your own email**: subscribe to the `license.issued` webhook. It carries `licenseKey`, the buyer's email and language. See [Buyer emails](/buyer-emails/).
- **Manually**: issue a key in **Licenses** in the panel, or with `POST /api/v1/licenses` (see the [API](/api/)). Useful for testing, gifts and support.

## Verify the key in your app

Your application needs three values from the seller, stored as configuration:

| Setting | Example | Where to find it |
|---|---|---|
| `SELLF_URL` | `https://your-sellf.example` | The address of the Sellf store |
| `SELLF_SELLER_ID` | `0b6c…` (UUID) | The `seller=` part of the JWKS URL |
| Product slug | `my-app-pro` | The product in Sellf |

What a key looks like: `<payload>.<signature>`. The payload is base64url JSON, for example:

```json
{ "v": 1, "kid": "3f9a1c0b7e2d4a65", "product": "my-app-pro", "email": "buyer@example.com",
  "order": "pi_3PxExample", "tier": "pro", "iat": 1762790400, "exp": 1794326400 }
```

`exp` is `null` for a key without expiry. `domain` appears only when the product asks for a license domain. The full list of fields is in the [technical contract](/llms/license-integration.md#claims).

### TypeScript / Node

One file, no dependencies, Node 18+ or Bun. Copy it into your project as `sellf-license.ts`.

```ts
// sellf-license.ts — verify a Sellf license key inside your app.
// Node 18+ (or Bun), no dependencies.
import { createHash, createVerify } from 'node:crypto';

export interface LicenseClaims {
  v: 1;
  kid: string;          // which signing key was used
  product: string;      // product slug in Sellf
  email: string;        // buyer email
  order: string;        // opaque order id the license belongs to (used for revocation)
  tier: string | null;  // "License tier" set on the product, or null
  iat: number;          // issued at, Unix seconds
  exp: number | null;   // expires at, Unix seconds; null = never expires
  domain?: string;      // present only when the buyer entered a license domain
  [claim: string]: unknown; // custom checkout fields arrive as custom_<field_id>
}

export interface SellfPublicKey { kid: string; alg: string; pem: string }

export type LicenseCheck =
  | { valid: true; claims: LicenseClaims }
  | { valid: false; reason: 'malformed' | 'unknown_key' | 'signature' | 'expired' | 'wrong_product' | 'wrong_domain' | 'revoked' | 'keys_unavailable' };

/** 1. Offline check: signature, expiry, product and domain. */
export function verifyLicenseKey(
  token: string,
  keys: SellfPublicKey[],
  expect: { product: string; domain?: string; now?: Date },
): LicenseCheck {
  const dot = typeof token === 'string' ? token.trim().indexOf('.') : -1;
  if (dot <= 0) return { valid: false, reason: 'malformed' };
  const payload = token.trim().slice(0, dot);
  const signature = token.trim().slice(dot + 1);
  if (!signature) return { valid: false, reason: 'malformed' };

  let claims: LicenseClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (
    claims?.v !== 1 || typeof claims.kid !== 'string' || typeof claims.product !== 'string' ||
    typeof claims.order !== 'string' || typeof claims.iat !== 'number' ||
    !(claims.exp === null || typeof claims.exp === 'number')
  ) return { valid: false, reason: 'malformed' };

  const key = keys.find((k) => k.kid === claims.kid);
  if (!key) return { valid: false, reason: 'unknown_key' };

  // ECDSA P-256 + SHA-256 over the base64url payload string (not the decoded JSON).
  // The signature is DER-encoded, base64url.
  let ok = false;
  try {
    ok = createVerify('SHA256').update(payload).end().verify(key.pem, Buffer.from(signature, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'signature' };

  const nowSec = Math.floor((expect.now ?? new Date()).getTime() / 1000);
  if (claims.exp !== null && claims.exp < nowSec) return { valid: false, reason: 'expired' };
  if (claims.product !== expect.product) return { valid: false, reason: 'wrong_product' };
  // A domain-bound key needs the instance domain; without it the key is rejected.
  if (claims.domain !== undefined && !domainMatches(claims.domain, expect.domain)) {
    return { valid: false, reason: 'wrong_domain' };
  }
  return { valid: true, claims };
}

/** A license for example.com also covers its subdomains (app.example.com). */
function domainMatches(licensed: unknown, instance: string | undefined): boolean {
  if (typeof licensed !== 'string' || !licensed) return false;
  const host = (instance ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return host !== '' && (host === licensed || host.endsWith(`.${licensed}`));
}

// ---------- network helpers (cache them; never call Sellf on every check) ----------

const SELLF_URL = process.env.SELLF_URL ?? 'https://your-sellf.example';
const SELLF_SELLER_ID = process.env.SELLF_SELLER_ID ?? '';
const CACHE_MS = 5 * 60_000;
const FORCED_REFRESH_MS = 60_000;

let keyCache: { keys: SellfPublicKey[]; at: number } | null = null;
let lastForcedRefresh = 0;
const trustedKeys: SellfPublicKey[] = [];

function isPublicKey(k: unknown): k is SellfPublicKey {
  const key = k as SellfPublicKey;
  return !!key && typeof key.kid === 'string' && typeof key.alg === 'string' &&
    typeof key.pem === 'string' && key.pem.includes('-----BEGIN PUBLIC KEY-----');
}

/** Keys you load yourself at startup (saved last good copy, or an old key kept after a rotation). */
export function addTrustedKeys(keys: unknown[]): void {
  trustedKeys.push(...keys.filter(isPublicKey));
}

/** 2. Public keys. Cached for 5 minutes; the last good copy is kept when Sellf is down or answers nonsense. */
export async function getPublicKeys(opts: { force?: boolean } = {}): Promise<SellfPublicKey[]> {
  const fresh = keyCache !== null && Date.now() - keyCache.at < CACHE_MS;
  if (!fresh || opts.force) {
    try {
      const res = await fetch(`${SELLF_URL}/api/licenses/jwks?seller=${SELLF_SELLER_ID}`, { redirect: 'error' });
      if (!res.ok) throw new Error(`JWKS ${res.status}`);
      const body = (await res.json()) as { keys?: unknown };
      if (!Array.isArray(body?.keys) || !body.keys.every(isPublicKey)) throw new Error('JWKS: unexpected response');
      keyCache = { keys: body.keys, at: Date.now() }; // persist this copy if you want it to survive a restart
    } catch (error) {
      if (!keyCache && trustedKeys.length === 0) throw error;
    }
  }
  return [...(keyCache?.keys ?? []), ...trustedKeys];
}

/**
 * Revocation buckets by 4-char prefix. at = 0 means "refresh at the next check, keep the content until then".
 * version changes on every webhook, so a response to a request sent before the webhook cannot overwrite it.
 */
const revokedCache = new Map<string, { hashes: Set<string>; at: number; version: number }>();
const HASH = /^[a-f0-9]{64}$/;

function orderHash(order: string): string {
  return createHash('sha256').update(order, 'utf8').digest('hex');
}

/** 3. Revocation: send only the first 4 hex chars of SHA-256(order), match locally. */
export async function isRevoked(order: string): Promise<boolean> {
  const hash = orderHash(order);
  const prefix = hash.slice(0, 4);
  const cached = revokedCache.get(prefix);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.hashes.has(hash);
  const startVersion = cached?.version ?? 0;
  try {
    const res = await fetch(`${SELLF_URL}/api/licenses/revoked?seller=${SELLF_SELLER_ID}&prefix=${prefix}`, { redirect: 'error' });
    if (!res.ok) throw new Error(`CRL ${res.status}`);
    const body = (await res.json()) as { order_hashes?: unknown };
    const list = body?.order_hashes;
    if (!Array.isArray(list) || !list.every((h) => typeof h === 'string' && HASH.test(h))) throw new Error('CRL: unexpected response');
    // Store the answer only if no webhook changed this bucket while the request was running.
    if ((revokedCache.get(prefix)?.version ?? 0) === startVersion) {
      revokedCache.set(prefix, { hashes: new Set(list as string[]), at: Date.now(), version: startVersion });
    }
  } catch {
    // Sellf unreachable or wrong answer: keep what you knew. With nothing known, this
    // example lets the license through (fail open); change it if your app must fail closed.
  }
  // Read the current bucket, not the snapshot from before the request.
  return revokedCache.get(prefix)?.hashes.has(hash) ?? false;
}

/**
 * Call after a license.revoked / license.restored webhook whose signature you verified.
 * revoked: the order counts as revoked at once, even offline.
 * restored: the bucket is refreshed at the next check; until a refresh started after this
 * webhook succeeds, the last known state stays.
 */
export function handleLicenseWebhook(event: 'license.revoked' | 'license.restored', order: string): void {
  const hash = orderHash(order);
  const prefix = hash.slice(0, 4);
  const bucket = revokedCache.get(prefix) ?? { hashes: new Set<string>(), at: 0, version: 0 };
  if (event === 'license.revoked') bucket.hashes.add(hash);
  bucket.at = 0;
  bucket.version += 1;
  revokedCache.set(prefix, bucket);
}

/** Full check: offline verification first, then the revocation list. */
export async function checkLicense(token: string, expect: { product: string; domain?: string }): Promise<LicenseCheck> {
  let keys: SellfPublicKey[];
  try {
    keys = await getPublicKeys();
  } catch {
    return { valid: false, reason: 'keys_unavailable' }; // no key known yet and Sellf unreachable
  }
  let result = verifyLicenseKey(token, keys, expect);
  // A key signed right after a rotation: refresh the key list once, at most once a minute.
  if (!result.valid && result.reason === 'unknown_key' && Date.now() - lastForcedRefresh > FORCED_REFRESH_MS) {
    lastForcedRefresh = Date.now();
    result = verifyLicenseKey(token, await getPublicKeys({ force: true }), expect);
  }
  if (!result.valid) return result;
  if (await isRevoked(result.claims.order)) return { valid: false, reason: 'revoked' };
  return result;
}
```

Usage:

```ts
import { addTrustedKeys, checkLicense, handleLicenseWebhook } from './sellf-license';

// Optional, at startup: keys saved from an earlier run, so a restart during a Sellf outage still works.
addTrustedKeys(loadSavedKeys());

// The domain comes from your own configuration, never from the license key or the request.
const result = await checkLicense(licenseKeyFromSettings, { product: 'my-app-pro', domain: config.publicDomain });
if (result.valid) {
  enablePlan(result.claims.tier); // e.g. "pro"
} else if (result.reason === 'keys_unavailable') {
  keepPreviousDecision(); // first start while Sellf is unreachable: your choice (see FAQ)
} else {
  showLicenseError(result.reason); // see "Common problems" below
}

// In your webhook receiver, after verifying the X-Sellf-Signature:
if (event.event === 'license.revoked' || event.event === 'license.restored') {
  handleLicenseWebhook(event.event, event.data.license.order);
}
```

When to check: when the user saves a key, when the application starts, and then every few hours. Store the last result so a short Sellf outage does not change anything for the buyer.

What the code does besides the signature check:

- **New signing key.** A key with an unknown `kid` makes the code download the key list once more (at most once a minute) before rejecting it, so licenses signed right after a key rotation work at once.
- **Wrong answers.** A response without the expected shape (`keys` with `kid`/`alg`/`pem`, `order_hashes` with 64-character hex hashes) is treated like an outage: the last good copy stays.
- **Restarts.** The cache lives in memory. To survive a restart during a Sellf outage, save the last key list (it is public, so a plain file is fine) and load it with `addTrustedKeys` at startup.

The browser's Web Crypto API expects a different signature encoding (raw `r||s`) than Sellf uses (DER). Verify on your server or in Node, not in browser JavaScript.

### PHP

The same offline check, including the domain (`ext-openssl`, PHP 8+). `$keys` is the `keys` array from the JWKS URL. Fetching keys and the revocation list works as in the TypeScript version; check the revocation list before unlocking anything.

```php
<?php
// $keys = the "keys" array from the JWKS URL; $instanceDomain = this installation's domain from your own config.
function sellf_domain_matches($licensed, ?string $instance): bool {
    if (!is_string($licensed) || $licensed === '') return false;
    $host = preg_replace(['/\.$/', '/^www\./'], '', strtolower(trim($instance ?? '')));
    return $host !== '' && ($host === $licensed || str_ends_with($host, '.' . $licensed));
}

function sellf_verify_license(string $token, array $keys, string $product, ?string $instanceDomain = null, ?int $now = null): ?array {
    $parts = explode('.', trim($token), 2);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') return null;
    [$payload, $sig] = $parts;
    $b64 = fn(string $s) => base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
    $claims = json_decode($b64($payload) ?: '', true);
    if (!is_array($claims) || ($claims['v'] ?? null) !== 1 || !isset($claims['kid'], $claims['order'])) return null;
    $key = null;
    foreach ($keys as $k) { if (($k['kid'] ?? null) === $claims['kid']) { $key = $k; break; } }
    if (!$key) return null;
    // ECDSA P-256 / SHA-256, DER signature, signed over the base64url payload string.
    if (openssl_verify($payload, $b64($sig) ?: '', $key['pem'], OPENSSL_ALGO_SHA256) !== 1) return null;
    if ($claims['exp'] !== null && $claims['exp'] < ($now ?? time())) return null;
    if (($claims['product'] ?? null) !== $product) return null;
    // A domain-bound key needs the instance domain; without it the key is rejected.
    if (array_key_exists('domain', $claims) && !sellf_domain_matches($claims['domain'], $instanceDomain)) return null;
    return $claims; // then check the revocation list (see below) before unlocking anything
}

// Example:
// $claims = sellf_verify_license($licenseKey, $keys, 'my-app-pro', 'app.example.com');
// if ($claims === null) { /* show "invalid license" */ } else { /* use $claims['tier'] */ }
```

### Python

The same offline check, including the domain. Requires Python 3.10+ and `pip install cryptography`. Check the revocation list before unlocking anything.

```python
import base64, json, time
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

def _b64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def _domain_matches(licensed, instance: str | None) -> bool:
    if not isinstance(licensed, str) or not licensed:
        return False
    host = (instance or "").strip().lower().removesuffix(".")
    host = host[4:] if host.startswith("www.") else host
    return host != "" and (host == licensed or host.endswith("." + licensed))

def sellf_verify_license(token: str, keys: list, product: str,
                         instance_domain: str | None = None, now: int | None = None) -> dict | None:
    payload, sep, sig = token.strip().partition(".")
    if not payload or not sep or not sig:
        return None
    try:
        claims = json.loads(_b64url(payload))
    except ValueError:
        return None
    if not isinstance(claims, dict) or claims.get("v") != 1:
        return None
    key = next((k for k in keys if k.get("kid") == claims.get("kid")), None)
    if key is None:
        return None
    public_key = serialization.load_pem_public_key(key["pem"].encode())
    try:
        # ECDSA P-256 / SHA-256, DER signature, signed over the base64url payload string.
        public_key.verify(_b64url(sig), payload.encode("ascii"), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError):
        return None
    if claims.get("exp") is not None and claims["exp"] < (now or int(time.time())):
        return None
    if claims.get("product") != product:
        return None
    # A domain-bound key needs the instance domain; without it the key is rejected.
    if "domain" in claims and not _domain_matches(claims["domain"], instance_domain):
        return None
    return claims  # then check the revocation list before unlocking anything

# Example:
# claims = sellf_verify_license(license_key, keys, "my-app-pro", "app.example.com")
# if claims is None: show "invalid license"  else: use claims["tier"]
```

## Revocation

A key keeps a valid signature forever, so Sellf publishes a list of revoked orders. An order lands on it after:

- a full refund or order cancellation (partial refunds keep the license),
- a chargeback (dispute); a won dispute can restore the license, unless it was revoked independently, for example after a full refund or a manual decision by the seller,
- manual revocation in **Licenses** or `DELETE /api/v1/licenses/{id}`,
- a subscription that ended unpaid, or whose paid period ended after cancellation.

**Checking the list.** Compute SHA-256 of the key's `order` value (lowercase hex) and send the first 4 characters:

```text
GET https://your-sellf.example/api/licenses/revoked?seller=<seller-id>&prefix=6270
→ 200 { "order_hashes": ["6270e1…", "…"] }
```

If your full hash is in `order_hashes`, the license is revoked. Your application sends only this prefix, never the token or the full hash. The endpoint does not return the whole list in a single request. The `isRevoked` function above does exactly this.

**Getting notified.** Subscribe to `license.revoked` and `license.restored` webhooks (Pro). After verifying the webhook signature, call `handleLicenseWebhook(event, order)` with `data.license.order`. For `license.revoked` the order counts as revoked immediately, even if Sellf is unreachable afterwards. For `license.restored` the code downloads the bucket again at the next check and keeps the last known state until that succeeds. An answer to a request that was already running when the webhook arrived is ignored, so it cannot undo the webhook; only a refresh started after the webhook can lift a revocation. Keep the periodic checks as well: a webhook can arrive late or not at all. The webhook payload contains the order, email, tier, domain, the reason (`refund`, `dispute`, `manual`, `subscription_cancelled`, `expired`) and `crlUrl`, but never the key itself. Details: [Webhooks](/webhooks/).

## Expiry

- `exp` is set at issuance from **Validity (days)**. It is in the signed key, so your application can check it offline.
- `exp: null` means the key never expires.
- For subscriptions, the key may outlive the subscription: when a subscription ends, the order goes on the revocation list, even if `exp` is later. Check the list.
- Changing the expiry in Sellf (`license.updated`) does not change keys already issued.

## Common problems

| Result | Usual cause | What to do |
|---|---|---|
| `malformed` | Key copied with extra text, cut in half, or not a Sellf key | Ask the buyer to copy the whole key again; trim spaces |
| `unknown_key` | Wrong `SELLF_SELLER_ID`, or the key was signed with a key that is no longer published (rotation) | Check the JWKS URL in **Settings → License**; see the rotation note above |
| `keys_unavailable` | First start, no saved keys, and Sellf unreachable | Save the key list and load it with `addTrustedKeys`; decide what the app does meanwhile |
| `signature` | The key was edited, or it was signed by a different store | Issue a new key; check `SELLF_URL` |
| `expired` | `exp` has passed | The buyer renews or buys again |
| `wrong_product` | A valid key for another product of the same seller | Compare the slug in the key with your product slug |
| `wrong_domain` | The application runs on a different domain than the one in the key | Issue a key for the right domain |
| `revoked` | Refund, chargeback, manual revocation or ended subscription | Expected; show the buyer how to buy again |
| JWKS returns `{"keys": []}` | Wrong seller ID, or no signing key yet | Generate a key in Sellf; check the ID |
| `429` from Sellf | More than 60 requests per minute | Cache keys and revocation results |

## FAQ

**Does my application need a Sellf API key?** No. Verification uses only the public endpoints. Never ship an API key inside an application you distribute.

**What happens when Sellf is down?** It depends on what the application already knows:

- **Public keys known** (cached or loaded with `addTrustedKeys`): the signature check works normally, offline.
- **No public key known** (first start without a saved copy): the signature cannot be checked and `checkLicense` returns `keys_unavailable`. Never skip the signature check. Decide what the app does meanwhile: keep the previous decision, run in free mode, or ask the user to try later.
- **Revocation list:** the last known bucket is used. With nothing known for that bucket, the code above lets the license through so an outage does not lock out a paying buyer. If your app must fail closed, return `true` there instead.

**Can a buyer share their key?** The key is tied to the buyer's email and, if you ask for it, to a domain. Show the email in your application's license screen and use the domain binding for web software.

**Can I issue keys outside a purchase?** Yes: **Licenses** in the panel, or `POST /api/v1/licenses` with an API key that has `licenses:write`.

**Where are the tiers defined?** Nowhere in Sellf beyond the product's **License tier** text. Your application maps tier names to features.

## Prompt for your AI agent

Copy this into Claude Code, Codex, Cursor or another coding agent working in your application's repository. Fill in the three values at the top.

```text
Add Sellf license key support to this application.

Values (put them in configuration, not in code):
- SELLF_URL = https://your-sellf.example
- SELLF_SELLER_ID = <seller UUID from the JWKS URL in Sellf, Settings → License>
- SELLF_PRODUCT_SLUG = <product slug in Sellf>

First read the full technical contract and follow it exactly:
https://docs.sellf.app/llms/license-integration.md
(token format, claims, public-key and revocation endpoints, verification algorithm, webhooks).
A tested reference implementation is in the "Verify the key in your app" section of
https://docs.sellf.app/license-integration/

Build:
1. A place where the user pastes the license key (settings screen, CLI command or env var,
   whatever fits this app) and where it is stored.
2. Offline verification: split the token at the first ".", decode the base64url JSON payload,
   pick the public key by "kid" from GET {SELLF_URL}/api/licenses/jwks?seller={SELLF_SELLER_ID},
   verify the ECDSA P-256/SHA-256 DER signature over the payload string, then check "exp",
   "product" == SELLF_PRODUCT_SLUG and, if present, "domain" (subdomains allowed). The instance
   domain comes from this app's trusted configuration; a domain-bound key is rejected when it is
   not configured. On an unknown "kid", refresh the key list once (rate-limited) before rejecting.
3. Revocation: SHA-256 of the "order" claim, send only the first 4 hex chars to
   GET {SELLF_URL}/api/licenses/revoked?seller={SELLF_SELLER_ID}&prefix=<4 hex>, revoked if the
   full hash is in "order_hashes".
4. Caching: public keys and revocation buckets cached (at least 5 minutes), last good copy used
   when Sellf is unreachable or answers with an unexpected shape (validate "keys" entries and
   64-hex "order_hashes" before replacing the cache). Check on key entry, on start and every few
   hours, even if webhooks are used.
   Decide explicitly, and tell me what you chose: (a) what happens on a first start with no saved
   public key while Sellf is unreachable (never skip the signature check), (b) whether keys are
   saved to survive restarts, (c) whether a revocation check that cannot reach Sellf and knows
   nothing about the bucket lets the license through or blocks it.
   If the app receives Sellf webhooks: on a verified license.revoked mark that order revoked
   immediately; on license.restored refresh the bucket at the next check without dropping the
   known state before a refresh succeeds. Version each bucket: an answer to a request started
   before a webhook must not overwrite the bucket.
5. Feature gating by the "tier" claim, in one place, and a clear message for each failure
   (malformed, unknown key, bad signature, expired, wrong product, wrong domain, revoked).

Do not:
- call Sellf on every license check or every request;
- ask for, store or generate the seller's private signing key;
- trust any claim before the signature is verified, or skip the "exp" check;
- use a Sellf API key in this application;
- send the token or the full order hash to Sellf, or write tokens to logs;
- clear the known revocation state before a successful refresh.

Test it with automated tests that need no network: generate an EC P-256 key pair in the test,
sign base64url(JSON claims) with SHA-256 (DER signature) to make tokens, and cover: valid key,
key without expiry (exp null), expired key, modified payload, key signed by another key pair,
unknown kid followed by a successful key refresh (rotation), wrong product, wrong domain,
missing instance domain for a domain-bound key, revoked order (mocked revocation response),
revoked order still revoked after a license.revoked webhook while Sellf is unreachable, a
license.revoked webhook arriving while a revocation request is in flight (the late answer, ok or
failed, must not erase it), a 200
response with the wrong shape that must not replace the cache, and Sellf unreachable on a cold
start. Then report what you changed and how to try it with a real key from Sellf.
```
