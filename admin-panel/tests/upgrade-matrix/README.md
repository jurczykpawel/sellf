# Deployment upgrade suite

Run `bun run test:upgrade-matrix` from admin-panel. Requires Docker, Supabase CLI,
Node, Bun and Playwright Chromium (`bunx playwright install chromium`). Builds two
local images; no releases, image pushes or production credentials are used.

The runner copies Supabase to a temporary project (`sellf-upgrade-matrix`), uses
55320–55329 (not the shared 543xx stack), and removes its containers and volumes
at the end. Never run two copies concurrently. Application ports: 55331–55332.

It checks authenticated status/update-check and rejected upgrade POSTs in Docker,
Compose and the Coolify container contract, a real dashboard notification with a
local release metadata server, image recreation and restart persistence, and
explicit CLI migrations against the isolated database. Container startup does
not apply migrations. Native Coolify/Vercel/Netlify control planes are outside
this local suite.

The PM2 test uses a disposable Linux container with a real Node/PM2 daemon and the
complete installed updater. Published signed release assets are downloaded once;
a local curl transport serves these unchanged files to the script, including its
original pinned public key. It verifies download, signature, swap, RPC migration,
process restart, health, and saved PM2 configuration. For a designated disposable Linux test host, add `--ssh=<alias>` to the same
command. It checks the real capability resolver under root PM2 and a transient
systemd service that restarts only its own fixture process. The script requires
Node, Python, curl, systemd and `/root/.bun/bin/pm2`; it never saves or replaces
other PM2 processes. It removes its process and `/tmp/sellf-ui-upgrade-matrix`.
This checks native launcher acknowledgement and restart; a full signed upgrade
under the owner's PM2 service cgroup is still a separate deployment check.

For repeat development runs against the suite's own already-running stack only,
use `--stack=/path/to/matrix-stack`. The runner verifies its project ID and API
ports, and leaves that explicitly supplied stack running for further checks.

## Populated v2026.10.6 upgrade

Run `bash scripts/upgrade-data-test.sh` from admin-panel with Bun, Python 3,
Supabase CLI, Docker, and Playwright Chromium installed (verified with Bun 1.3.14
and Node 22). The gate reserves
`sellf-upg` (55570–55579) and application port 55581. It refuses an existing
`sellf-upg` stack or a third database. Do not run two copies concurrently.

It extracts the released migrations and seed from the local `v2026.10.6` tag,
loads `supabase/tests/upgrade-fixture-2026-10-6.sql`, records counts and financial
sums, and applies every candidate migration from 20261016000000 over the same
service-role HTTP RPC as `upgrade.sh`, including checksum and repeat checks.
SQL checks cover historical order references, VAT units, optional checkout
profiles and completion of a historical pending order through the legacy path.
The candidate app then runs browser smoke for the shop, product, admin session,
historical payment list and new checkout payment form (local payment transport).
No Stripe payment is performed. Any assertion or browser failure returns nonzero.
The runner stops its stack without backup even on failure; diagnostic start logs
remain in the printed temporary directory. Playwright shuts down its dev server.
