# Custom Security Scan Instructions — Sellf

Focus on the following high-priority areas specific to this codebase:

## Critical — Always Flag

1. **Open Redirect** — any use of `redirect()`, `NextResponse.redirect()`, or `router.push()` with user-controlled input not validated by `isSafeRedirectUrl()` from `@/lib/validations/redirect`

2. **SSRF** — any `fetch()` call with a URL derived from user input or database values, without SSRF protection. Pay special attention to webhook delivery in `lib/services/` and API key validation endpoints.

3. **RLS Bypass** — any Supabase query using `createAdminClient()` (service role) that is not preceded by an explicit admin check (`requireAdminApi()` or `is_admin` RPC call). Admin client bypasses all Row Level Security.

4. **Stripe Webhook Verification** — any handler in `api/webhooks/stripe/` that calls `stripe.checkout.sessions.retrieve()` or processes payment data without first verifying the webhook signature via `stripe.webhooks.constructEvent()`.

5. **Server Action Authorization** — server actions in `lib/actions/` that mutate data (products, users, payments) without calling `createClient()` and verifying the session. Look for missing auth checks before Supabase mutations.

6. **Prompt Injection** — any place where user-supplied strings are interpolated directly into an AI prompt system message rather than passed as a separate `messages[].content` item.

## High — Flag if Present

7. **AES-256-GCM IV reuse** — in `lib/encryption.ts`, verify that a fresh random IV is generated for every encryption call and never reused or hardcoded.

8. **Rate limit bypass** — new public API routes (`/api/public/`, `/api/waitlist/`, `/api/consent/`) missing `checkRateLimit()` from `@/lib/rate-limiting`.

9. **Payment session ownership** — any call to `verifyPaymentSession()` that does not check `session.metadata.user_id === user.id`. Empty string and 'null' string checks are required.

10. **Cookie flags** — new cookies set without `HttpOnly` and `Secure` flags in production (check `lib/supabase/server.ts` and middleware).

## Noise Reduction — Do NOT Flag

- `console.log` / `console.error` statements (intentional logging)
- Missing input validation on internal server-to-server API calls (not public-facing)
- `any` TypeScript types in test files
- The `isDemoMode()` pattern blocking mutations — this is intentional
- Hardcoded strings like `'disposable_email'` or `'DEMO_MODE'` — these are known constants, not secrets
