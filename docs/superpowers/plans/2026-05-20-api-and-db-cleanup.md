# API and DB Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Strict TDD (red→green→refactor). DRY, KISS, SOLID. No public artifact telegraphs security details (see `vault/brands/_shared/reference/coding-standards.md` "Hard rule").

**Goal:** Apply remaining hardening from prior audits/pentests as one cohesive branch — grouped by area to maximize refactor reuse and minimize churn.

**Architecture:** Each group introduces a small shared primitive first (DTO mapper, ownership guard, URL pre-flight) then uses it across all affected routes. Database changes go into a single bundled migration. Test-first throughout.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript strict, Supabase (PostgreSQL + RLS), Stripe SDK v20, Vitest (unit + API integration), Playwright (E2E), Bun.

**Branch:** `chore/api-and-db-cleanup` (generic — no security telegraphing per coding-standards). All commit messages, branch names, test names, code comments must remain feature-level. NEVER reference `audit`, `pentest`, `finding #N`, `vulnerability`, `attacker`, or specific findings — describe new behavior.

---

## Execution Order (priority high → low)

1. **Group A — API input validation refactor** (allowlist DTO + Zod) [HIGH]
2. **Group B — Rate-limit consistency** (per-identifier everywhere) [HIGH]
3. **Group C — Captcha on paid embed checkout** [HIGH]
4. **Group D — Ownership verification helper** [HIGH]
5. **Group E — Redirect + outbound URL pre-flight** [HIGH]
6. **Group F — DB hardening migration bundle** [MEDIUM]
7. **Group G — CSV export quoting** [MEDIUM]
8. **Group H — Public payment config DTO split** [MEDIUM]
9. **Group I — Migration CI lint** [MEDIUM]
10. **Group J — Production startup assertions** [MEDIUM]
11. **Group K — Granular API scope + webhook quota** [MEDIUM]
12. **Group L — Defense-in-depth bundle** [LOW]
13. **Group M — Supabase config trim** [LOW]

---

## File Structure

### New shared primitives (created in this branch)

- `admin-panel/src/lib/api/dto/product.ts` — Product API DTOs + `mapApiInputToProductRow()` allowlist mapper. Replaces denylist approach in `sanitizeProductData`.
- `admin-panel/src/lib/api/ownership.ts` — `assertPaymentIntentOwnership()` helper. Reusable across update-payment-metadata + future Stripe-bound routes.
- `admin-panel/src/lib/security/outbound-url.ts` — `assertSafeOutboundUrl()` pre-flight wrapper around existing `validateWebhookUrlAsync()`. Single import point for tracking/server.ts + future outbound dispatchers.
- `admin-panel/src/lib/captcha/route-guard.ts` — `requireCaptcha(token, provider?)` route-level guard returning Response on failure. Replaces inline `verifyCaptchaToken` + Response building duplicated across embed routes.
- `admin-panel/src/lib/actions/payment-config-public.ts` — `getPublicPaymentConfig()` returning narrow DTO. Existing `payment-config.ts` becomes admin-only.
- `admin-panel/src/lib/startup/production-assertions.ts` — Consolidated startup checks (TRUSTED_PROXY, E2E_MODE, DEMO_MODE, CAPTCHA_PROVIDER). Replaces ad-hoc `assertTrustedProxyConfig`.
- `admin-panel/scripts/lint-migrations.ts` — Static analysis: every `CREATE FUNCTION` in `seller_main`/`public` must have matching `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. Wired into `package.json` script + CI.

### Modified files (grouped by phase)

- **Group A:** `validations/product.ts` (deprecate `sanitizeProductData`), `app/api/v1/products/route.ts`, `app/api/v1/products/[id]/route.ts`, `app/api/consent/route.ts` (Zod schema).
- **Group B:** `app/api/coupons/verify/route.ts`, `app/api/update-payment-metadata/route.ts`, `lib/api/middleware.ts`, `app/api/cron/route.ts`.
- **Group C:** `app/api/embed/checkout-session/route.ts`, `app/api/embed/free-access/route.ts` (use new route-guard).
- **Group D:** `app/api/update-payment-metadata/route.ts`.
- **Group E:** `lib/tracking/server.ts` (sendToGtmSS, FB CAPI), `app/[locale]/auth/product-access/route.ts`, `app/[locale]/p/[slug]/payment-status/page.tsx`.
- **Group F:** new `supabase/migrations/<timestamp>_temporal_rls_idempotent_completion_and_locks.sql`.
- **Group G:** `app/api/v1/payments/export/route.ts`.
- **Group H:** `lib/actions/payment-config.ts` (split), callers under `app/[locale]/p/[slug]/`.
- **Group I:** new `scripts/lint-migrations.ts`, `package.json`, GitHub Actions workflow `.github/workflows/lint-migrations.yml`.
- **Group J:** `lib/startup/production-assertions.ts`, `instrumentation.ts` (wire-up).
- **Group K:** `lib/api/api-keys.ts` (scope registry), `app/api/v1/payments/[id]/refund/route.ts`, `app/api/v1/webhooks/route.ts`.
- **Group L:** `app/api/v1/system/upgrade-status/route.ts`, `app/api/runtime-config/route.ts`, `app/api/v1/payments/route.ts`, `lib/services/gus-api-client.ts`, `app/api/status/route.ts`, `app/api/cron/route.ts`.
- **Group M:** `supabase/config.toml`.

### New tests (TDD)

- `admin-panel/tests/unit/api/dto/product.test.ts` — allowlist mapper + extra-field stripping.
- `admin-panel/tests/api/products-allowlist.test.ts` — POST/PATCH with extra fields ignored.
- `admin-panel/tests/api/consent-validation.test.ts` — `anonymous_id` type assertions (number → 400, not 500).
- `admin-panel/tests/unit/lib/rate-limit-identifier.test.ts` — per-identifier propagation in route handlers.
- `admin-panel/tests/unit/lib/captcha/route-guard.test.ts` — pass/fail/missing-token branches.
- `admin-panel/tests/api/embed-checkout-session-captcha.test.ts` — paid path requires captcha.
- `admin-panel/tests/unit/api/ownership.test.ts` — mismatch returns 403, match returns null.
- `admin-panel/tests/api/update-payment-metadata-ownership.test.ts` — mismatched session denies operation.
- `admin-panel/tests/unit/lib/security/outbound-url.test.ts` — private IP / loopback rejected, public URL passes through.
- `admin-panel/tests/unit/lib/tracking/server-gtm-ss.test.ts` — pre-flight runs before fetch; FB CAPI uses Authorization header (no token in URL).
- `admin-panel/tests/api/auth-product-access-redirect.test.ts` — `success_url` rejected when external host.
- `admin-panel/tests/api/products-public-temporal.test.ts` — products before `available_from` not visible to anon.
- `admin-panel/tests/api/payments-export-csv.test.ts` — leading-space formula gets quoted.
- `admin-panel/tests/unit/actions/payment-config-public.test.ts` — public DTO omits admin-only fields.
- `admin-panel/tests/unit/scripts/lint-migrations.test.ts` — script flags CREATE FUNCTION without REVOKE.
- `admin-panel/tests/unit/startup/production-assertions.test.ts` — each guard branch.
- `admin-panel/tests/api/refund-scope.test.ts` — refund requires `payments:refund`, not just `*`.
- `admin-panel/tests/api/webhooks-quota.test.ts` — 51st webhook returns 429/409.

---

## Group A — API input validation refactor (HIGH)

**Scope:** Convert `sanitizeProductData` from denylist to allowlist DTO. Add Zod validation to consent route's `anonymous_id`.

**Files:**
- Create: `admin-panel/src/lib/api/dto/product.ts`
- Create: `admin-panel/tests/unit/api/dto/product.test.ts`
- Create: `admin-panel/tests/api/products-allowlist.test.ts`
- Modify: `admin-panel/src/app/api/v1/products/route.ts:172`
- Modify: `admin-panel/src/app/api/v1/products/[id]/route.ts:140`
- Modify: `admin-panel/src/app/api/consent/route.ts:42-50`
- Modify: `admin-panel/src/lib/validations/product.ts` — deprecate `sanitizeProductData` (re-export shim that calls new mapper) OR delete callers and remove it. Pick deletion if no non-API callers remain.
- Create: `admin-panel/tests/api/consent-validation.test.ts`

### Task A.1: Write failing test for product DTO mapper

- [ ] **Step 1: Create test file**

```ts
// admin-panel/tests/unit/api/dto/product.test.ts
import { describe, it, expect } from 'vitest';
import { mapApiInputToProductRow, ProductCreateDTO } from '@/lib/api/dto/product';

describe('mapApiInputToProductRow', () => {
  it('strips fields outside the create allowlist', () => {
    const input = {
      name: 'X',
      slug: 'x',
      description: 'd',
      price: 10,
      is_admin: true,
      sale_quantity_sold: 999,
      created_at: '2020-01-01',
      arbitrary_field: 'evil',
    } as Record<string, unknown>;

    const result = mapApiInputToProductRow(input, 'create');

    expect(result).not.toHaveProperty('is_admin');
    expect(result).not.toHaveProperty('sale_quantity_sold');
    expect(result).not.toHaveProperty('created_at');
    expect(result).not.toHaveProperty('arbitrary_field');
    expect(result.name).toBe('X');
    expect(result.slug).toBe('x');
  });

  it('lowercases slug and uppercases currency', () => {
    const result = mapApiInputToProductRow(
      { name: 'X', slug: 'AbC', description: 'd', price: 1, currency: 'usd' },
      'create',
    );
    expect(result.slug).toBe('abc');
    expect(result.currency).toBe('USD');
  });

  it('coerces empty-string date fields to null', () => {
    const result = mapApiInputToProductRow(
      { name: 'X', slug: 'x', description: 'd', price: 1, available_from: '', available_until: '' },
      'create',
    );
    expect(result.available_from).toBeNull();
    expect(result.available_until).toBeNull();
  });

  it('rejects payload missing required fields in create context', () => {
    expect(() => mapApiInputToProductRow({ name: 'X' }, 'create')).toThrowError(
      /price|slug|description/,
    );
  });

  it('allows partial payload in update context', () => {
    const result = mapApiInputToProductRow({ name: 'New' }, 'update');
    expect(result).toEqual({ name: 'New' });
  });

  it('exports ProductCreateDTO Zod schema', () => {
    expect(ProductCreateDTO).toBeDefined();
    expect(typeof ProductCreateDTO.parse).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd admin-panel && bunx vitest run tests/unit/api/dto/product.test.ts
```

Expected: FAIL — module `@/lib/api/dto/product` not found.

### Task A.2: Implement product DTO mapper (allowlist via Zod)

- [ ] **Step 1: Create module**

```ts
// admin-panel/src/lib/api/dto/product.ts
import { z } from 'zod';

const SLUG_RE = /^[a-z0-9-]+$/;
const ISO_DATE = z.string().datetime({ offset: true }).or(z.literal('')).optional().nullable();
const CONTENT_DELIVERY = z.enum(['content', 'redirect', 'download']);

const baseFields = {
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80).transform((s) => s.toLowerCase()).refine((s) => SLUG_RE.test(s), 'slug: lowercase letters, digits, hyphens only'),
  description: z.string().trim().min(1).max(5000),
  price: z.number().nonnegative().finite(),
  currency: z.string().trim().length(3).transform((s) => s.toUpperCase()).optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  icon: z.string().max(8).optional(),
  content_delivery_type: CONTENT_DELIVERY.optional(),
  content_config: z.record(z.string(), z.unknown()).optional(),
  available_from: ISO_DATE,
  available_until: ISO_DATE,
  sale_price: z.number().nonnegative().nullable().optional(),
  sale_price_until: ISO_DATE,
  sale_quantity_limit: z.union([z.number().int().nonnegative(), z.string().transform((s) => (s === '' ? null : parseInt(s, 10))), z.null()]).optional(),
  product_type: z.enum(['one_time', 'subscription']).optional(),
  auto_grant_duration_days: z.number().int().nonnegative().nullable().optional(),
  allow_custom_price: z.boolean().optional(),
  custom_price_min: z.number().nonnegative().optional(),
  custom_price_presets: z.array(z.number().nonnegative()).max(20).optional(),
  preview_video_config: z.record(z.string(), z.unknown()).nullable().optional(),
  checkout_template: z.string().max(40).optional(),
  custom_checkout_fields: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
};

export const ProductCreateDTO = z.object(baseFields).strip();
export const ProductUpdateDTO = z.object(baseFields).partial().strip();

export type ProductCreateInput = z.infer<typeof ProductCreateDTO>;
export type ProductUpdateInput = z.infer<typeof ProductUpdateDTO>;

function normaliseEmptyDate<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  for (const k of keys) {
    if (row[k] === '') (row[k] as unknown) = null;
  }
  return row;
}

export function mapApiInputToProductRow(
  input: Record<string, unknown>,
  context: 'create' | 'update',
): Record<string, unknown> {
  const schema = context === 'create' ? ProductCreateDTO : ProductUpdateDTO;
  const parsed = schema.parse(input) as Record<string, unknown>;
  return normaliseEmptyDate(parsed, ['available_from', 'available_until', 'sale_price_until'] as Array<keyof typeof parsed>);
}
```

- [ ] **Step 2: Run unit test to confirm pass**

```bash
cd admin-panel && bunx vitest run tests/unit/api/dto/product.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit (TDD red→green)**

```bash
git add admin-panel/src/lib/api/dto/product.ts admin-panel/tests/unit/api/dto/product.test.ts
git commit -m "feat(api): add product DTO allowlist mapper"
```

### Task A.3: Wire allowlist into POST/PATCH product routes

- [ ] **Step 1: Write failing API test for extra-field stripping**

```ts
// admin-panel/tests/api/products-allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { adminApiRequest } from './setup';

describe('Products API — allowlist', () => {
  it('ignores fields outside DTO on POST', async () => {
    const res = await adminApiRequest('POST', '/api/v1/products', {
      name: 'Test allowlist',
      slug: 'test-allowlist',
      description: 'd',
      price: 10,
      sale_quantity_sold: 9999,
      arbitrary_evil: 'x',
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.sale_quantity_sold ?? 0).toBe(0);
    expect(body.data).not.toHaveProperty('arbitrary_evil');
  });

  it('ignores fields outside DTO on PATCH', async () => {
    const created = await adminApiRequest('POST', '/api/v1/products', {
      name: 'Test patch', slug: 'test-patch', description: 'd', price: 10,
    });
    const id = (await created.json()).data.id;

    const res = await adminApiRequest('PATCH', `/api/v1/products/${id}`, {
      name: 'Renamed', sale_quantity_sold: 9999, evil: 1,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Renamed');
    expect(body.data.sale_quantity_sold ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run API test to confirm fail (sale_quantity_sold currently passes through update path)**

```bash
cd admin-panel && bun run test:api -- products-allowlist
```

Expected: FAIL — current `sanitizeProductData` only deletes explicit fields; arbitrary unknown fields pass through.

- [ ] **Step 3: Replace `sanitizeProductData` call with new mapper**

In `admin-panel/src/app/api/v1/products/route.ts:172`:

Replace `const sanitizedData = sanitizeProductData(productDataRaw, true);` with:

```ts
let sanitizedData: Record<string, unknown>;
try {
  sanitizedData = mapApiInputToProductRow(productDataRaw, 'create');
} catch (err) {
  if (err instanceof z.ZodError) {
    throw new ApiValidationError('Validation failed', { _errors: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  throw err;
}
```

Add imports:
```ts
import { z } from 'zod';
import { mapApiInputToProductRow } from '@/lib/api/dto/product';
```

Remove the `sanitizeProductData` import. Apply same change in `admin-panel/src/app/api/v1/products/[id]/route.ts:140` with `'update'` context.

- [ ] **Step 4: Run unit + API tests + lint + typecheck**

```bash
cd admin-panel && bunx vitest run tests/unit/api/dto/ && bun run test:api -- products-allowlist && bun run lint && bun run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Delete dead helper if no other callers**

```bash
grep -rn "sanitizeProductData" admin-panel/src admin-panel/tests
```

If only this file references it → delete the function from `validations/product.ts`. If admin UI server actions still call it, keep but mark `@deprecated`.

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/app/api/v1/products/ admin-panel/tests/api/products-allowlist.test.ts admin-panel/src/lib/validations/product.ts
git commit -m "refactor(api/products): replace denylist sanitizer with DTO allowlist"
```

### Task A.4: Zod-validate consent route inputs

- [ ] **Step 1: Write failing test**

```ts
// admin-panel/tests/api/consent-validation.test.ts
import { describe, it, expect } from 'vitest';
import { publicApiRequest } from './setup';

describe('Consent route input validation', () => {
  it('returns 400 when anonymous_id is a number', async () => {
    const res = await publicApiRequest('POST', '/api/consent', {
      anonymous_id: 123, consents: { necessary: true }, consent_version: '1.0',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/anonymous_id/i);
  });

  it('returns 400 when anonymous_id contains disallowed chars', async () => {
    const res = await publicApiRequest('POST', '/api/consent', {
      anonymous_id: '../etc/passwd', consents: {}, consent_version: '1.0',
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid kebab-case anonymous_id', async () => {
    const res = await publicApiRequest('POST', '/api/consent', {
      anonymous_id: 'anon-abc-123', consents: { necessary: true }, consent_version: '1.0',
    });
    expect([200, 204]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd admin-panel && bun run test:api -- consent-validation
```

Expected: number test gets 500 (current code crashes on `.length` access).

- [ ] **Step 3: Replace ad-hoc check with Zod**

In `admin-panel/src/app/api/consent/route.ts`, replace the three `if` blocks at lines 42-50 with:

```ts
import { z } from 'zod';

const ConsentBodySchema = z.object({
  anonymous_id: z.string().min(1).max(200).regex(/^[a-z0-9_-]+$/i).optional(),
  consents: z.record(z.string(), z.unknown()).optional().refine(
    (v) => v === undefined || JSON.stringify(v).length <= 5000,
    'consents payload too large',
  ),
  consent_version: z.string().max(50).optional(),
});

const parsed = ConsentBodySchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json(
    { error: 'Invalid request', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
    { status: 400 },
  );
}
const { anonymous_id, consents, consent_version } = parsed.data;
```

Delete the old `const { anonymous_id, … } = body` and the three `if` blocks.

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd admin-panel && bun run test:api -- consent-validation && bun run lint && bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/app/api/consent/route.ts admin-panel/tests/api/consent-validation.test.ts
git commit -m "refactor(api/consent): replace ad-hoc body checks with Zod schema"
```

---

## Group B — Rate-limit consistency (HIGH)

**Scope:** Make every rate-limit call use a per-identifier bucket so attacker cannot DoS the global counter.

**Reference:** `lib/rate-limiting.ts` already exposes `checkRateLimitForIdentifier(action, max, window, identifier)`. Public DB function `check_rate_limit` already accepts optional 4th `identifier_param` arg (committed in `c5a53a0`).

### Task B.1: Coupon route — per-code + per-IP layered

- [ ] **Step 1: Write failing test in existing `coupon-race-condition` style**

```ts
// admin-panel/tests/api/coupons-per-code-limit.test.ts
import { describe, it, expect } from 'vitest';
import { publicApiRequest } from './setup';

describe('Coupons verify — per-code rate limit', () => {
  it('per-code bucket exhausts independently of per-IP', async () => {
    const productId = process.env.E2E_PRODUCT_ID!;
    // burn 5 attempts on CODE_A
    for (let i = 0; i < 5; i++) {
      await publicApiRequest('POST', '/api/coupons/verify', { code: 'CODE_A', productId });
    }
    const codeABlocked = await publicApiRequest('POST', '/api/coupons/verify', { code: 'CODE_A', productId });
    expect(codeABlocked.status).toBe(429);

    // CODE_B from same IP should still be allowed
    const codeBOk = await publicApiRequest('POST', '/api/coupons/verify', { code: 'CODE_B', productId });
    expect([200, 404]).toContain(codeBOk.status); // 404 if code doesn't exist, 200 if valid — NOT 429
  });
});
```

(Note: `RATE_LIMIT_TEST_MODE=true` must be set in test env. Confirm via `vitest.config.api.ts`.)

- [ ] **Step 2: Run to confirm fail**

Expected: CODE_B returns 429 because global bucket is exhausted.

- [ ] **Step 3: Modify route to layered per-code + global**

In `admin-panel/src/app/api/coupons/verify/route.ts:21`, replace single rate-limit call with:

```ts
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { getRateLimitIdentifier } from '@/lib/rate-limiting';

// per-code bucket (prevents code-space enumeration)
const codeOk = await checkRateLimitForIdentifier('coupon_verify_code', 5, 60, `code:${String(code).toUpperCase()}`);
if (!codeOk) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

// per-IP/user secondary guard
const allowed = await checkRateLimit('coupon_verify', 30, 60);
if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
```

Note `code` needs to be validated *before* the per-code bucket build to avoid using NULL as identifier. Move the `if (!code || typeof code !== 'string' …)` validation block above the rate-limit calls.

- [ ] **Step 4: Run tests**

```bash
cd admin-panel && bun run test:api -- coupons-per-code-limit
```

Expected: PASS.

- [ ] **Step 5: Collapse RPC error reasons in HTTP layer (was finding M16)**

Replace `return NextResponse.json(data);` with:

```ts
// Public response carries no enumeration signal — only valid/invalid.
if (!data?.valid) {
  return NextResponse.json({ valid: false });
}
return NextResponse.json(data);
```

- [ ] **Step 6: Write test for error collapse**

```ts
it('returns plain {valid:false} for expired/invalid/used codes (no enumeration)', async () => {
  const productId = process.env.E2E_PRODUCT_ID!;
  const res = await publicApiRequest('POST', '/api/coupons/verify', { code: 'NONEXISTENT_XYZ', productId });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ valid: false });
});
```

- [ ] **Step 7: Commit**

```bash
git add admin-panel/src/app/api/coupons/verify/route.ts admin-panel/tests/api/coupons-per-code-limit.test.ts
git commit -m "refactor(api/coupons): layer per-code rate limit and collapse public response"
```

### Task B.2: update-payment-metadata rate-limit cap

- [ ] **Step 1: Open `admin-panel/src/app/api/update-payment-metadata/route.ts`**

Locate current `checkRateLimit('update_payment_metadata', 10, 1)` call.

- [ ] **Step 2: Tighten to 5/min + add per-user bucket when session has user_id**

```ts
const ipOk = await checkRateLimit('update_payment_metadata', 5, 1);
if (!ipOk) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

if (existingUserId) {
  const userOk = await checkRateLimitForIdentifier('update_payment_metadata_user', 10, 5, `user:${existingUserId}`);
  if (!userOk) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
}
```

- [ ] **Step 3: Add coverage in existing `tests/api/payments.test.ts` or new file**

Test: 6 rapid POSTs to update-payment-metadata from same fingerprint → 6th returns 429.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(api): tighten checkout metadata throttling per IP and per user"
```

### Task B.3: API key verify — per-IP

- [ ] **Step 1: Locate `admin-panel/src/lib/api/middleware.ts:280-285`**

Find `const verifyAttemptAllowed = await checkRateLimit('api_key_verify', 120, 1);`.

- [ ] **Step 2: Add identifier propagation**

```ts
import { extractTrustedClientIp } from '@/lib/security/client-ip';
import { headers } from 'next/headers';

const hdrs = await headers();
const ip = extractTrustedClientIp(hdrs);
const identifier = ip ? `ip:${ip}` : `fp:${fingerprint(hdrs)}`;
const verifyAttemptAllowed = await checkRateLimitForIdentifier('api_key_verify', 60, 1, identifier);
```

`fingerprint` already exists in client-ip helper or rate-limiting; reuse, don't re-implement.

- [ ] **Step 3: Test — 61 attempts from one IP returns 429, attempts from different IP still pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(api): per-source bucket for api key verification"
```

### Task B.4: /api/cron rate-limit

- [ ] **Step 1: Open `admin-panel/src/app/api/cron/route.ts`**

Currently uses CRON_SECRET timing-safe compare with no rate limit.

- [ ] **Step 2: Add per-token rate limit**

```ts
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';

const tokenFingerprint = createHash('sha256').update(providedSecret).digest('hex').slice(0, 16);
const allowed = await checkRateLimitForIdentifier('cron_invoke', 60, 1, `token:${tokenFingerprint}`);
if (!allowed) return new Response('Too many requests', { status: 429 });
```

- [ ] **Step 3: Test** — 61 rapid hits with same `Authorization: Bearer …` returns 429.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api/cron): bucket invocations per credential"
```

---

## Group C — Captcha on paid embed checkout (HIGH)

**Scope:** Add captcha to `/api/embed/checkout-session` (paid path). Free path (`/api/embed/free-access`) already has it. Extract shared `requireCaptcha` guard.

### Task C.1: Extract `requireCaptcha` route-level guard

- [ ] **Step 1: Write failing unit test**

```ts
// admin-panel/tests/unit/lib/captcha/route-guard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { requireCaptcha } from '@/lib/captcha/route-guard';
import * as verify from '@/lib/captcha/verify';

describe('requireCaptcha guard', () => {
  it('returns null when verification succeeds', async () => {
    vi.spyOn(verify, 'verifyCaptchaToken').mockResolvedValue({ success: true });
    expect(await requireCaptcha('token')).toBeNull();
  });

  it('returns 400 Response when verification fails', async () => {
    vi.spyOn(verify, 'verifyCaptchaToken').mockResolvedValue({ success: false, error: 'fail' });
    const res = await requireCaptcha('token');
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(400);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// admin-panel/src/lib/captcha/route-guard.ts
import { NextResponse } from 'next/server';
import { verifyCaptchaToken } from './verify';
import type { CaptchaProvider } from './types';

export async function requireCaptcha(
  token: string | null | undefined,
  providerOverride?: CaptchaProvider,
): Promise<Response | null> {
  const result = await verifyCaptchaToken(token, providerOverride);
  if (result.success) return null;
  return NextResponse.json({ error: result.error ?? 'Security verification failed' }, { status: 400 });
}
```

- [ ] **Step 3: Replace inline use in `/api/embed/free-access` with this guard** (refactor opportunity)

```ts
const captchaFail = await requireCaptcha(body.captchaToken);
if (captchaFail) return captchaFail;
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(captcha): extract requireCaptcha route guard"
```

### Task C.2: Apply guard to paid embed checkout

- [ ] **Step 1: Write failing API test**

```ts
// admin-panel/tests/api/embed-checkout-session-captcha.test.ts
import { describe, it, expect } from 'vitest';
import { publicApiRequest } from './setup';

describe('Embed paid checkout — captcha gating', () => {
  it('rejects requests without captcha token in production-like mode', async () => {
    process.env.CAPTCHA_PROVIDER = 'altcha'; // forces gate
    const res = await publicApiRequest('POST', '/api/embed/checkout-session', {
      productId: process.env.E2E_PRODUCT_ID, email: 't@e.com',
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Locate captcha read in `/api/embed/free-access` to mirror shape**

Skim file for `captchaToken` destructure + `verifyCaptchaToken` call.

- [ ] **Step 3: Add guard call to `/api/embed/checkout-session`**

After body parsing, before Stripe session creation:

```ts
const captchaFail = await requireCaptcha(body.captchaToken);
if (captchaFail) return captchaFail;
```

- [ ] **Step 4: Update embed SDK loader** (`admin-panel/src/app/embed/v1/checkout.js`) to include captcha token in paid path POST. Mirror free-access loader logic. (Check if already shares code — DRY refactor opportunity: extract shared helper.)

- [ ] **Step 5: Tests** + smoke E2E (`tests/api-product-checkout-template.spec.ts` regression)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(api/embed): require captcha on checkout session creation"
```

---

## Group D — Ownership verification helper (HIGH)

**Scope:** Extract `assertPaymentIntentOwnership` helper. Apply to `update-payment-metadata` (current gap).

### Task D.1: Implement helper

- [ ] **Step 1: Write failing test**

```ts
// admin-panel/tests/unit/api/ownership.test.ts
import { describe, it, expect } from 'vitest';
import { assertPaymentIntentOwnership } from '@/lib/api/ownership';

describe('assertPaymentIntentOwnership', () => {
  it('returns null when PI metadata user matches caller', () => {
    expect(assertPaymentIntentOwnership({ user_id: 'u1' }, 'u1')).toBeNull();
  });

  it('returns 403 Response when mismatch', () => {
    const res = assertPaymentIntentOwnership({ user_id: 'u1' }, 'u2');
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(403);
  });

  it('returns 403 when PI metadata has no user_id and caller is authenticated', () => {
    expect(assertPaymentIntentOwnership({}, 'u1')?.status).toBe(403);
  });

  it('allows guest path (no caller, no metadata user)', () => {
    expect(assertPaymentIntentOwnership({}, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// admin-panel/src/lib/api/ownership.ts
import { NextResponse } from 'next/server';

export function assertPaymentIntentOwnership(
  piMetadata: Record<string, unknown> | null | undefined,
  callerUserId: string | null,
): Response | null {
  const piUserId = (piMetadata?.user_id as string | undefined) ?? null;

  if (!callerUserId && !piUserId) return null;
  if (callerUserId && piUserId && callerUserId === piUserId) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): add payment intent ownership assertion helper"
```

### Task D.2: Apply to update-payment-metadata

- [ ] **Step 1: Write failing test**

```ts
// admin-panel/tests/api/update-payment-metadata-ownership.test.ts
it('rejects with 403 when caller user id differs from PI metadata.user_id', async () => { /* … */ });
```

- [ ] **Step 2: After `stripe.paymentIntents.retrieve(piId)` in route**

```ts
const pi = await stripe.paymentIntents.retrieve(piId);
const ownership = assertPaymentIntentOwnership(pi.metadata, sessionUserId);
if (ownership) return ownership;
```

- [ ] **Step 3: Test + commit**

```bash
git commit -m "feat(api): verify caller owns payment intent before metadata update"
```

---

## Group E — Redirect + outbound URL pre-flight (HIGH)

### Task E.1: Extract `assertSafeOutboundUrl` helper around existing webhook validator

- [ ] **Step 1: Write failing test**

```ts
// admin-panel/tests/unit/lib/security/outbound-url.test.ts
import { describe, it, expect } from 'vitest';
import { assertSafeOutboundUrl } from '@/lib/security/outbound-url';

describe('assertSafeOutboundUrl', () => {
  it('rejects loopback', async () => {
    await expect(assertSafeOutboundUrl('http://127.0.0.1/x')).rejects.toThrow();
  });
  it('rejects private IPv4', async () => {
    await expect(assertSafeOutboundUrl('http://10.0.0.5/x')).rejects.toThrow();
  });
  it('accepts public hostname', async () => {
    await expect(assertSafeOutboundUrl('https://example.com/x')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement (wrap existing `validateWebhookUrlAsync`)**

```ts
// admin-panel/src/lib/security/outbound-url.ts
import { validateWebhookUrlAsync } from '@/lib/security/webhook-validator';

export async function assertSafeOutboundUrl(url: string): Promise<void> {
  const result = await validateWebhookUrlAsync(url);
  if (!result.valid) throw new Error(`Refused outbound: ${result.reason ?? 'unsafe url'}`);
}
```

### Task E.2: Pre-flight + FB CAPI header switch in `lib/tracking/server.ts`

- [ ] **Step 1: Locate `sendToGtmSS` and FB CAPI dispatcher (~lines 211-223, 265)**

- [ ] **Step 2: Pre-flight URL**

```ts
await assertSafeOutboundUrl(url);
const res = await fetch(url, { /* existing args */ });
```

- [ ] **Step 3: FB CAPI move token to header**

Old: `?access_token=${token}` in URL.
New:
```ts
const res = await fetch(`${endpoint}?…rest_params_without_token…`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
```

- [ ] **Step 4: Tests** — mock `fetch`, assert URL has no `access_token=`, Authorization header present.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(tracking): pre-flight outbound URLs and switch FB API to bearer header"
```

### Task E.3: Audit success_url propagation in auth/product-access → payment-status

- [ ] **Step 1: Read `admin-panel/src/app/[locale]/auth/product-access/route.ts:123` and `payment-status/page.tsx`**

Document each `success_url` read site.

- [ ] **Step 2: Apply `isSafeRedirectUrl` at every consumer site**

Use existing helper from `lib/validations/redirect.ts:20-23`. Fallback to relative `/p/[slug]` path on mismatch.

- [ ] **Step 3: Add regression test**

```ts
// admin-panel/tests/api/auth-product-access-redirect.test.ts
it('rejects external success_url at auth/product-access', async () => { … });
it('rejects external success_url at payment-status page consumer', async () => { … });
```

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(auth): clamp success_url propagation to same-origin or relative paths"
```

---

## Group F — DB hardening migration bundle (MEDIUM)

**Scope:** One migration, four changes:

1. `products` SELECT policy adds temporal check (`available_from`/`available_until`) OR-ed with admin override.
2. `process_stripe_payment_completion` `ON CONFLICT DO UPDATE` when status was `pending`.
3. `claim_guest_purchases_for_user` `SELECT … FOR UPDATE SKIP LOCKED`.
4. `REVOKE SELECT ON payment_method_config FROM authenticated;` (RLS already protects rows).

**File:** `supabase/migrations/<YYYYMMDDHHMMSS>_temporal_rls_idempotent_completion_and_locks.sql`

**Constraint reminder:** previous pending migrations on prod (`20260430142135`, `20260515110000`, `20260515180000`) — verify before adding new one. If prod tracking is behind, sequence carefully or fold into existing not-yet-deployed migration (see `feedback_no_new_migrations_if_prod_behind` in memory).

### Task F.1: Write failing API/integration test for temporal product visibility

- [ ] **Step 1: New test** in `tests/api/products-public-temporal.test.ts`:

```ts
it('anon SELECT does not return product with available_from in the future', async () => {
  // insert product with available_from = now() + 1 hour, is_active=true
  // query anon /api/v1/products (or public storefront)
  // assert response array doesn't contain product
});
```

### Task F.2: Write failing test for idempotent completion

- [ ] Set up a `payment_transactions` row with `status='pending'`. Call `process_stripe_payment_completion` again with `status='completed'`. Assert final status is `'completed'` (currently stays pending).

### Task F.3: Write failing test for guest-claim concurrency

- [ ] Spawn two parallel SQL transactions calling `claim_guest_purchases_for_user` with the same `customer_email`. Expect one of them to skip the locked row, NOT throw.

### Task F.4: Migration

- [ ] **Step 1: Create file**

```sql
-- supabase/migrations/20260521000000_temporal_rls_idempotent_completion_and_locks.sql
BEGIN;

-- 1) Temporal visibility on products SELECT (anon)
DROP POLICY IF EXISTS products_public_select ON public.products;
CREATE POLICY products_public_select ON public.products
  FOR SELECT
  USING (
    is_active = true
    AND (available_from IS NULL OR available_from <= now())
    AND (available_until IS NULL OR available_until >= now())
    OR (select public.is_admin())
  );

-- 2) Idempotent payment completion
CREATE OR REPLACE FUNCTION seller_main.process_stripe_payment_completion(/* signature */)
RETURNS jsonb AS $$
…
  INSERT INTO seller_main.payment_transactions(session_id, status, …)
  VALUES (…)
  ON CONFLICT (session_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = now()
    WHERE seller_main.payment_transactions.status = 'pending'
       AND EXCLUDED.status IN ('completed','failed');
…
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion TO service_role;

-- 3) Guest claim FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION seller_main.claim_guest_purchases_for_user(p_user_id uuid)
…
  FOR purchase IN
    SELECT * FROM seller_main.guest_purchases
    WHERE customer_email = user_email
      AND claimed_by_user_id IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
…
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION seller_main.claim_guest_purchases_for_user FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seller_main.claim_guest_purchases_for_user TO service_role;

-- 4) Redundant authenticated SELECT on payment_method_config
REVOKE SELECT ON public.payment_method_config FROM authenticated;

COMMIT;
```

(Stub above — copy actual function bodies from existing migrations before editing; do NOT lose existing logic.)

- [ ] **Step 2: Run `npx supabase db reset` locally and verify all 3 tests pass**

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(db): tighten temporal visibility, idempotent completion, claim locking"
```

---

## Group G — CSV export quoting (MEDIUM)

**File:** `admin-panel/src/app/api/v1/payments/export/route.ts:177-185`

### Task G.1: Unconditional quote/escape

- [ ] **Step 1: Failing test**

```ts
// admin-panel/tests/api/payments-export-csv.test.ts
it('quotes fields with leading whitespace before formula chars', async () => {
  // mock a payment row with customer_email = " =cmd()"
  // call export endpoint, parse CSV
  // assert the cell value is "\" =cmd()\"" (quoted, not raw)
});
```

- [ ] **Step 2: Replace `sanitizeCsvField`**

```ts
function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}
```

Replace all call sites that used the previous conditional sanitizer.

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(api/payments/export): always quote csv fields"
```

---

## Group H — Public payment config DTO split (MEDIUM)

**File:** `admin-panel/src/lib/actions/payment-config.ts`

### Task H.1: Split into `getPublicPaymentConfig` and `getAdminPaymentConfig`

- [ ] **Step 1: Failing test** — `getPublicPaymentConfig` must NOT return admin-only fields (e.g., `webhook_signing_secret_enc`, raw API keys).

```ts
// admin-panel/tests/unit/actions/payment-config-public.test.ts
it('omits admin-only fields from public DTO', async () => {
  const cfg = await getPublicPaymentConfig();
  expect(cfg).not.toHaveProperty('webhook_signing_secret_enc');
  expect(cfg).not.toHaveProperty('stripe_secret_key');
});
```

- [ ] **Step 2: Refactor**

Two narrow `select('a, b, c')` calls — never `select('*')` from public path.

- [ ] **Step 3: Migrate callers**

Public checkout pages (`app/[locale]/p/[slug]/page.tsx` and helpers) → `getPublicPaymentConfig`. Admin pages → `getAdminPaymentConfig`.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(payment-config): split public and admin DTOs"
```

---

## Group I — Migration CI lint (MEDIUM)

**Scope:** Static check that every `CREATE FUNCTION` in `seller_main`/`public` schema is followed by `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` in the same migration file. Plus runtime scanner inside `seed.sql` listing functions with PUBLIC EXECUTE outside whitelist.

### Task I.1: Implement script

- [ ] **Step 1: Failing test**

```ts
// admin-panel/tests/unit/scripts/lint-migrations.test.ts
import { lintSqlForMissingRevoke } from '@/../scripts/lint-migrations';

it('flags CREATE FUNCTION without REVOKE in the same file', () => {
  const sql = "CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;";
  expect(lintSqlForMissingRevoke('test.sql', sql)).toContain('foo');
});

it('passes when matching REVOKE present', () => {
  const sql = "CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;\nREVOKE EXECUTE ON FUNCTION seller_main.foo() FROM PUBLIC, anon, authenticated;";
  expect(lintSqlForMissingRevoke('test.sql', sql)).toHaveLength(0);
});
```

- [ ] **Step 2: Implement** `scripts/lint-migrations.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

const SCHEMAS = ['seller_main', 'public'];
const CREATE_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\.(\w+)\s*\(/gi;
const REVOKE_RE = /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(\w+)\.(\w+)/gi;

export function lintSqlForMissingRevoke(file: string, sql: string): string[] {
  const created = new Set<string>();
  for (const m of sql.matchAll(CREATE_RE)) {
    if (SCHEMAS.includes(m[1])) created.add(`${m[1]}.${m[2]}`);
  }
  const revoked = new Set<string>();
  for (const m of sql.matchAll(REVOKE_RE)) revoked.add(`${m[1]}.${m[2]}`);
  return [...created].filter((fn) => !revoked.has(fn));
}

if (import.meta.main) {
  const dir = path.resolve('supabase/migrations');
  let failed = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const missing = lintSqlForMissingRevoke(file, sql);
    if (missing.length) {
      failed++;
      console.error(`✖ ${file}: missing REVOKE for ${missing.join(', ')}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}
```

- [ ] **Step 3: Add script to `package.json`**

```json
"lint:migrations": "bun run scripts/lint-migrations.ts"
```

- [ ] **Step 4: GitHub Actions workflow**

```yaml
# .github/workflows/lint-migrations.yml
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun run lint:migrations
        working-directory: admin-panel
```

- [ ] **Step 5: Run script against existing migrations, fix or whitelist findings**

For each flagged migration: either patch (add explicit REVOKE) or document the audit decision. NEVER use a generic `eslint-disable`-equivalent — fix the root cause.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(scripts): add migration lint for explicit revoke on new functions"
```

---

## Group J — Production startup assertions (MEDIUM)

**File:** new `admin-panel/src/lib/startup/production-assertions.ts`. Wire into `admin-panel/instrumentation.ts`.

### Task J.1: Consolidated assertions

- [ ] **Step 1: Failing tests**

```ts
// admin-panel/tests/unit/startup/production-assertions.test.ts
it('throws when E2E_MODE=true in production', () => {
  process.env.NODE_ENV = 'production';
  process.env.E2E_MODE = 'true';
  expect(() => assertProductionConfig()).toThrow(/E2E_MODE/);
});

it('throws when DEMO_MODE=true in production', () => { … });

it('throws when CAPTCHA_PROVIDER=none and not explicitly disabled', () => { … });

it('passes when NODE_ENV=production and all flags off', () => { … });

it('throws with helpful hint when NODE_ENV is unset', () => { … });
```

- [ ] **Step 2: Implement**

```ts
// admin-panel/src/lib/startup/production-assertions.ts
export function assertProductionConfig(): void {
  if (!process.env.NODE_ENV) {
    throw new Error('NODE_ENV must be set explicitly (production|development|test)');
  }
  if (process.env.NODE_ENV !== 'production') return;

  if (process.env.E2E_MODE === 'true') throw new Error('E2E_MODE must not be true in production');
  if (process.env.DEMO_MODE === 'true') throw new Error('DEMO_MODE must not be true in production');
  if (process.env.TRUSTED_PROXY !== 'true') throw new Error('TRUSTED_PROXY must be true in production');
  if (!process.env.CAPTCHA_PROVIDER || process.env.CAPTCHA_PROVIDER === 'none') {
    if (process.env.CAPTCHA_DISABLED_ACK !== 'true') {
      throw new Error('CAPTCHA_PROVIDER is required in production (or set CAPTCHA_DISABLED_ACK=true to opt out)');
    }
  }
}
```

- [ ] **Step 3: Wire into `instrumentation.ts`**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionConfig } = await import('@/lib/startup/production-assertions');
    assertProductionConfig();
  }
}
```

Replace existing ad-hoc `assertTrustedProxyConfig` if present — consolidate.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(startup): consolidate production environment assertions"
```

---

## Group K — Granular API scope + webhook quota (MEDIUM)

### Task K.1: `PAYMENTS_REFUND` scope

- [ ] **Step 1: Failing test**

```ts
// admin-panel/tests/api/refund-scope.test.ts
it('rejects refund with key that has payments:read but not payments:refund', async () => {
  const res = await apiRequestWithKey(scopedKeyMinusRefund, 'POST', `/api/v1/payments/${id}/refund`);
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Add scope**

```ts
// admin-panel/src/lib/api/api-keys.ts:17-54
export const API_SCOPES = {
  …existing,
  PAYMENTS_REFUND: 'payments:refund',
} as const;
```

- [ ] **Step 3: Apply in route**

```ts
// admin-panel/src/app/api/v1/payments/[id]/refund/route.ts:49
const { supabase } = await authenticate(request, [API_SCOPES.PAYMENTS_REFUND]);
```

- [ ] **Step 4: Update UI key-creation screen to expose the new scope** + documentation update.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): add granular payments:refund scope"
```

### Task K.2: Webhook quota per user

- [ ] **Step 1: Failing test**

```ts
it('rejects creation of 51st webhook for the same user', async () => { … });
```

- [ ] **Step 2: Implement in `admin-panel/src/app/api/v1/webhooks/route.ts:115-193` POST**

```ts
const { count } = await supabase
  .from('webhooks')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', userId);
if ((count ?? 0) >= 50) {
  return apiError(request, 'CONFLICT', 'Webhook quota exhausted (max 50)');
}
```

- [ ] **Step 3: Document quota in API docs.**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api/webhooks): cap webhook count per user"
```

---

## Group L — Defense-in-depth bundle (LOW)

One commit per bullet — keep churn isolated.

### Task L.1: upgrade-status `fstat` after `openSync`

- File: `admin-panel/src/app/api/v1/system/upgrade-status/route.ts:54-74`
- Add `fs.fstatSync(fd).isFile()` check before `readFileSync`. If not file → close fd, return 500 generic error.
- Test: symlink scenario in tmpdir.

### Task L.2: runtime-config `Cache-Control: private`

- File: `admin-panel/src/app/api/runtime-config/route.ts`
- Change response header from `public, max-age=…` to `private, max-age=…`.
- Test: response header assertion.

### Task L.3: `/api/v1/payments` email length cap

- File: `admin-panel/src/app/api/v1/payments/route.ts`
- Before `ILIKE` build: if `email.length > 254` → 400.
- Test: input 300 char email → 400.

### Task L.4: GUS BIR1 5s timeout

- File: `admin-panel/src/lib/services/gus-api-client.ts:53`
- Wrap `this.bir.search({ nip })` in `Promise.race` with 5s timeout.
- Test: stub bir to never resolve, expect rejection within 5.5s.

### Task L.5: CORS null reflection in `/api/status`

- File: `admin-panel/src/app/api/status/route.ts:14,68,90`
- When `siteUrl` is undefined, omit CORS headers entirely (don't write `null`).
- Test: missing SITE_URL → response has no `access-control-allow-origin` header.

Each item gets its own commit; keep messages feature-level (e.g., `chore(status): drop cors headers when origin is unset`).

---

## Group M — Supabase config trim (LOW)

### Task M.1: Remove `graphql_public` from PostgREST schemas if unused

- [ ] **Step 1: Verify sellf does not use Supabase GraphQL endpoint**

```bash
grep -rni "graphql" admin-panel/src
```

If zero hits → confirm safe to remove.

- [ ] **Step 2: Edit `supabase/config.toml`**

Locate `[api]` section, remove `graphql_public` from `schemas`. Document in `CONTRIBUTING.md` (DB Conventions section) why.

- [ ] **Step 3: Local test** — `npx supabase start && curl -sS /graphql/v1` → 404 or schema error.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(db): trim unused graphql schema from postgrest exposure"
```

---

## Out of scope (deferred to future branches)

- **#2 clientSecret binding** — requires RFC at `docs/security-rfc-checkout-binding.md` first. NOT in this branch.
- **#25 Apply pending production migrations** — ops task, separate session/runbook.
- **#28 part 3 — audit log on 5+ failed api_key_verify** — feature, deferred.
- **MED-01 documentation only** — single-line README update at the end of this branch (acceptable trailing commit).
- **#17 secondary fstat hardening for multi-tenant** — single-tenant deployment doesn't need it; revisit if Docker multi-tenant target appears.
- **mcp-server major version bumps** — separate branch, parallel work.

---

## Acceptance criteria (per group)

- [ ] **Group A:** `bun run test:unit` + `bun run test:api -- products-allowlist` + `bun run test:api -- consent-validation` all pass; `sanitizeProductData` either deleted or marked `@deprecated`.
- [ ] **Group B:** New per-code coupon test passes; rate-limit logs show `code:` identifier; api_key_verify uses `ip:` identifier; cron uses `token:`.
- [ ] **Group C:** New embed-checkout captcha test passes; `/api/embed/free-access` refactored to use shared guard.
- [ ] **Group D:** Ownership unit + API tests pass.
- [ ] **Group E:** Outbound URL test passes; FB CAPI URL no longer contains `access_token=` (network assertion); success_url cross-host test rejects.
- [ ] **Group F:** New migration applies cleanly with `npx supabase db reset`; 3 new tests pass.
- [ ] **Group G:** CSV test for leading-space formula passes.
- [ ] **Group H:** Public DTO test passes; no remaining `.select('*')` in payment-config public path.
- [ ] **Group I:** `bun run lint:migrations` exits 0; GH Action green; tests for the lint script pass.
- [ ] **Group J:** Five startup assertion tests pass; `instrumentation.ts` calls consolidated function.
- [ ] **Group K:** Scope test + quota test pass.
- [ ] **Group L:** Each of 5 sub-task tests passes; no warnings in lint.
- [ ] **Group M:** GraphQL endpoint returns 404 on local Supabase.

---

## Notes for the executor

- **Branch already created:** `worktree-chore+api-and-db-cleanup` (worktree at `.claude/worktrees/chore+api-and-db-cleanup/`). Rename to `chore/api-and-db-cleanup` before PR if desired.
- **Never** put audit/finding numbers or security words in commits, code comments, test names, branch names. Feature-level language only.
- **Run lint + typecheck before every commit:** `bun run lint && bun run typecheck`.
- **DRY watch:** if you write similar `if (rate-limit) return 429` blocks 3 times — extract `withRateLimit(actionType, max, window, identifier?)`. Defer the abstraction until you see the third instance.
- **KISS watch:** don't introduce new patterns when an existing helper covers it (e.g., `checkRateLimitForIdentifier` already exists; don't write `checkRateLimitByCode`).
- **SOLID watch:** keep `production-assertions.ts` single-responsibility (env validation). Don't put runtime checks there.
- After Groups A-F: re-audit with `/security-review` skill before opening PR.
