---
title: Environment configuration
description: Runtime URL and service configuration for Sellf.
---

Set `SITE_URL=https://your-store.example` in Sellf's runtime environment (for example,
`admin-panel/.env.local`). Use the public origin without a path. Emails, checkout,
metadata and sitemap use this URL even in prebuilt releases. Restart the application
to apply changes; rebuilding is unnecessary.

Resolution order is `SITE_URL`, then `MAIN_DOMAIN` (HTTPS; localhost uses HTTP), then
legacy `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL` read at
runtime. Release installations do not need the `NEXT_PUBLIC_*` URL variables.
Placeholders are rejected; production refuses to boot without a usable public origin.
Browsers receive configuration through `/api/runtime-config`; browser redirect checks
compare against the current page's origin.

Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and Stripe keys
at runtime. If the server reaches Supabase over an internal network, set
`PUBLIC_SUPABASE_URL` to its browser-reachable URL. Missing runtime configuration
produces an authentication error rather than a connection to a dummy host.

In Supabase Auth, add `https://your-store.example/auth/callback` or
`https://your-store.example/**` to **Redirect URLs**. Sellf guarantees an absolute
callback with a query because email templates append `&token_hash`. Keep that template
format. Supabase's redirect allowlist is independent of Sellf; the application cannot
cheaply inspect it at startup. Verify the actual delivered email after configuration.
Supabase substitutes its Site URL when rejecting a redirect, which can break the link.

CI scans the release artifact for placeholders before packaging and signing.
Run `node scripts/run-runtime-url-tests.mjs` from `admin-panel/` for the production
regression. It builds with placeholders, starts on 3777 with real runtime settings,
and checks Mailpit login/free-access emails, Stripe embed return URLs, sitemap and
metadata. It requires running local Supabase with the 3777 Auth redirect allowlist and
a test-mode Stripe key; it never resets the database.

## Price display

Prices follow the selected page language in the storefront, checkout and admin panel.
For example, PLN 49 appears as `49,00 zł` on Polish pages and `PLN 49.00` on English
pages. This also applies to sale prices, previous prices, subscriptions, discounts
and Pay What You Want presets. Currency formatting does not convert amounts.
Embedded checkout buttons use the host page's HTML `lang` attribute, falling back
to the browser language when it is missing.

## Product discovery

Submit `/sitemap.xml` for your installation to search engines. It links to chunks
of up to 1,000 products. Only active, listed products whose availability window
is currently open are included. Unlisted products remain accessible by direct link.
English URLs use `/p/slug`; Polish URLs use `/pl/p/slug`, with language alternates.
The sitemap uses each product's last modification date.

Visitors without access see the existing purchase view directly on a listed
product's `/p/slug` page. Buyers still see their content. Links containing `email`,
`coupon`, or `oto` retain the checkout redirect and its context. Checkout URLs
remain excluded from indexing.

Product pages provide canonical URLs and schema.org Product data. Fixed-price
Offers use the displayed price, including active sales and recurring subscription
prices. Customer-chosen pricing has Product data without a fixed-price Offer.
No personalized coupons or buyer content are included in structured data.

## Demo authentication

With `DEMO_MODE=true`, Sellf declines magic-link requests (including free-product
and post-checkout links) and auth callbacks on the server. Subscription webhooks
can use existing accounts but cannot create accounts. Password login remains
available. Login and checkout forms explain the demo restriction in English and Polish.

Sellf has no password reset, password/email change, or password sign-up endpoint.
Supabase Auth is a separate service: its direct API must be configured separately
for a shared demo installation. `DEMO_MODE` alone does not restrict direct Supabase
requests. Disable sign-up and configure account-change restrictions there before
making a shared demo available.

## Abandoned checkout funnel

The admin dashboard shows recorded payment attempts for the last 7, 30 or 90 days,
with a per-product breakdown. The dashboard product filter applies. The period uses
record creation time; counts reflect current statuses. `abandoned` means marked
abandoned after session expiration or closure. `pending` stays separate, including
records past their expiry time. Paid includes completed, refunded, partially refunded
and disputed payments; paid share divides these by all records in the period.

These are payment records, not unique buyers or a complete visit/session funnel.
Repeated attempts, additional order rows and subscription payments may be included;
missing records cannot be counted. Guest emails can be unknown. This view sends no
reminders, adds no tracking and requires no new configuration.

The table shows up to 100 products with the most recorded attempts; totals include all products. Aggregation runs in the database in one request.

## Affiliate commission worker

After enabling affiliates, schedule the durable worker every minute. Set `SELLF_URL`
to the public application origin and supply the server's `CRON_SECRET` securely to
the scheduler environment (do not put a real secret in a shared crontab example).

```cron
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$SELLF_URL/api/cron?job=affiliate-sync" > /dev/null
```

This is a separate job from `webhook-deliveries-retry`; configure both if you use
both features. The worker processes paid coupon orders and later refunds; it does
not send bank transfers. Interrupted leases are recovered by later runs.

In **Dashboard → Affiliates → Commission processing**, pending work overdue by more than
15 minutes triggers a warning. Check the scheduler and its HTTP results first.
Failed orders show a remedy and a **Retry** action: resolve the Stripe configuration,
session lookup or missing net/tax snapshot, enter what was fixed, then retry. Each
retry records the session administrator and reason. Refresh after a conflict, since
the order may have changed. Technical references are inside **Technical details**.
A retry queues work; it does not run tax capture or settle a payout.

Products with unlimited refunds create permanently held commissions: these cannot
be paid out, even through manual adjustments. Set a finite refund period before
future sales if commissions should become payable; existing snapshots retain the
original policy. Test-mode commissions are visible but excluded from real payouts.

For StackPilot installations and upgrades, add this schedule explicitly to your
host or external scheduler and verify a successful call after restarting Sellf.
Deploying the app alone does not install the affiliate scheduler.
