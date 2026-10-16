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
