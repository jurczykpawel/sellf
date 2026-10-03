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
