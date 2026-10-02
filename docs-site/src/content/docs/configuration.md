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
