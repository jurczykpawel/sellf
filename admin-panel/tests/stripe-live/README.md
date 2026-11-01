# Real Stripe test-mode end-to-end suite

From `admin-panel/`, run:

```bash
scripts/run-stripe-live-e2e.sh
```

Prerequisites: Bun dependencies and Playwright Chromium installed, Stripe CLI,
`cloudflared`, Docker with disposable local Supabase running and migrations applied,
and free ports 3777 (app), 3778 (receiver), 3779 (exchange-rate stub).
`.env.local` must contain the local Supabase URL/keys and matching Stripe **test**
secret and publishable keys. The runner refuses a live secret key or remote
Supabase. Reset disposable Supabase if an active database Stripe configuration
exists: the app gives database credentials precedence over environment variables.
Never run this suite against a production database.

The runner obtains the CLI signing secret with `stripe listen --print-secret`,
passes it only in the app process environment, and starts `stripe listen` forwarding
actual Stripe network events to `/api/webhooks/stripe`. It reuses the Playwright
server commands, including the fixed exchange-rate stub and captcha test setting.
Stripe itself creates and confirms the payments through its real Elements UI;
there are no Stripe script, API, or event mocks. Official test cards exercise
normal approval, 3D Secure approval and decline. Test-mode payments move no funds
and have no payment cost. See [Stripe test cards](https://docs.stripe.com/testing).

A tiny HTTP receiver records each delivery's headers, raw body and parsed JSON in
`test-runs/stripe-live-<timestamp>/deliveries.jsonl`. A temporary Cloudflare quick
tunnel gives it a public HTTPS URL accepted by the normal outbound dispatcher.
The receiving path includes a random per-run component. Each test registers a
product-scoped endpoint in local Supabase; one-time purchases subscribe to
`purchase.completed`, subscription purchases subscribe to `invoice.paid` (the
billing handler's fulfillment event).

The twelve payment runs cover guest and signed-in buyers, required license-domain input,
one order bump, 3D Secure, decline, initial subscription payment, and five fresh
guest repetitions, a percentage coupon with a bump, and a net-priced product with
local VAT. One-time orders require pricing snapshot version 1, an order number,
and discounted line totals matching the charge after exclusive tax. Assertions
require one completed transaction, no pending
transaction, expired superseded sessions with abandoned history rows, both line
items with correct amounts, guest access after registration, preserved domain and exactly one matching license,
access records and one outbound delivery with its envelope ID in the header.
The decline run requires an actual failed Stripe attempt and no completed order,
license or delivery. Subscription cleanup cancels Stripe billing before deleting
local data; created recurring prices/products are archived. Products, users,
keys, endpoints and associated test rows are removed after each run.

`server.jsonl` timestamps stdout/stderr receipt, including the existing Stripe
`Received` log and the payment-status GET request. `timing.jsonl` correlates actual
Stripe event IDs to each session/payment intent and records their observed order
against the success page. The fallback browser navigation timestamp is explicitly
used if Next does not print a matching GET. These are local observations, not
Stripe event creation timestamps. Five natural repetitions may still produce
only one arrival order; read the output before claiming order diversity.

The console prints `scenario | runs | pass | event order observed`, with per-run
results in `summary.jsonl`. Logs and Playwright failure traces remain in ignored
local output directories; API/signing keys are redacted from process logs. The
receiver file intentionally contains test license tokens for assertions: keep
these artifacts local.

The `stripe-live` Playwright project is registered only with
`STRIPE_LIVE_E2E=1`, and its specs are ignored by the default Chromium project.
Ordinary `bun run test` does not run it. The runner enables it, stops at the first
failure, disables payment-test retries, and cleans up its listener, tunnel and server process
groups on success, failure or interruption. Additional Playwright arguments can
be passed to the runner, for example `--grep 'guest license'`.

`tests/api/subscription-first-mail-live.test.ts` provides an opt-in HTTP companion.
Against the same disposable local stack and a running app on port 3777, run:

```sh
STRIPE_LIVE_API=1 bun --env-file=.env.local x vitest run --config vitest.config.api.ts tests/api/subscription-first-mail-live.test.ts
```

It completes genuine test-mode sessions using Stripe's CLI fixture protocol,
fetches real provider events, sends those events to the local webhook with its
configured test signing secret, reads the first Mailpit message and follows its
unaltered callback. It covers subscriptions, trials, variants, bundles, events,
full-discount invitations and transfer instructions. It does not launch a browser.
Recurring billing is canceled and its customers/prices/products cleaned up;
Stripe's immutable automatic one-time product records remain in test history.

If a scenario reveals an application bug, preserve the failure evidence and
report it. Do not change application behavior or relax assertions to obtain a
green run.

A recognized Next.js one-shot upgrade notice permits one repeat of the same local
server command. Other startup exits and a second notice stop the runner.

The focused `refund-invoice-contract.spec.ts` uses real test-mode PaymentIntents,
refunds, disputes (won/lost), and a test-clock renewal through Stripe API. The
runner's Stripe listener feeds the local handler; the public receiver checks the
actual outgoing body and HMAC signature, purchase bindings, access effects and
repeat-delivery behavior. It creates products without issued licenses. Run it
through the same runner, with an allocated disposable stack and browser/test slot:

```sh
scripts/run-stripe-live-e2e.sh tests/stripe-live/refund-invoice-contract.spec.ts --workers=1
```

Sanitized recordings in `tests/fixtures/stripe/` exercise missing optional fields,
pending and failed refunds, paid periods and dispute outcomes in unit tests.

Trial disclosure coverage (both locales, first mail and real zero invoice) is tagged
`@J148`. After the local build, run the sequential trial/accessibility gate:

```sh
scripts/run-stripe-live-e2e.sh --config=playwright.trial.config.ts --project=accessibility --grep '@J148|accessibility' --workers=1
```

The `public-hydration` project in that config validates document response headers
and must run against the production build (`PW_PRODUCTION=1`), using the normal
local production test environment. Next's development server replaces document
cache-control headers, so it cannot prove that response contract.
