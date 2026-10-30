# Money/access HTTP acceptance

The normal browser suite does not start public tunnels. This separate acceptance config
uses API request contexts only, a real local Supabase stack, its Mailpit, and a temporary
HTTPS receiver. It requires `cloudflared`, local-only `.env.local` credentials and `CRON_SECRET`.
The configured `SITE_URL` must match the test application URL and be allowed by local Auth.

From `admin-panel`, after checking load1 < 28:

```sh
E2E_MODE=true TEST_DNS_SERVERS=1.1.1.1 \
NODE_OPTIONS=--require=./tests/helpers/public-dns.cjs \
QUIET_MODE=1 bunx playwright test --config=playwright.money-events.config.ts --workers=1
```

`TEST_DNS_SERVERS` optionally sets DNS for the isolated runner and application processes;
localhost and literal IP lookups retain their normal behavior. All endpoint validation and
signed delivery code remains enabled. The receiver verifies signatures before accepting
payloads. The test closes its tunnel/receiver and removes its own endpoint, key and fixtures.
Do not run this config with any remote database credentials. Builds and ordinary unit tests
do not load the DNS fixture or start its tunnel.
