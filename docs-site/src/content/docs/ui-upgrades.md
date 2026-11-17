---
title: "Updates from the admin UI"
description: "How Sellf selects in-place updates or deployment-specific instructions."
---

Sellf checks releases in every deployment. Settings → System and the dashboard
notification offer an in-place update only for a ready standalone PM2 installation.
Other deployments display the new version and instructions for their deployment.
The upgrade API enforces the same capability as the UI.

## Runtime selection

Set the server environment variable `SELLF_DEPLOYMENT_RUNTIME` to `pm2`, `systemd`,
`docker`, `compose`, `coolify`, `vercel`, `netlify` or `manual`. An unknown value
selects manual instructions. An override selects the instructions; it cannot turn
an incomplete or container installation into an in-place updater.

Without an override Sellf detects Vercel (`VERCEL=1`), Netlify (`NETLIFY=true`),
Coolify (`COOLIFY_RESOURCE_UUID` / `COOLIFY_CONTAINER_NAME`), container markers
(`/.dockerenv` / `/run/.containerenv`), PM2 (`pm_id`), then systemd (`INVOCATION_ID`).
An unrecognised deployment uses manual instructions. Compose uses `compose` by
default in the supplied compose file. Set `SELLF_DEPLOYMENT_RUNTIME=coolify` on
Coolify resources, including Dockerfile and Compose deployments.

In-place mode requires Linux, root, an active systemd installation, an executable
`/usr/bin/systemd-run`, a writable standalone tarball installation, its updater
and `.env.local`, and the matching PM2 process in `/root/.pm2`. The process name
must match the stack directory containing `admin-panel`. The supported working
directory is `<stack>/admin-panel/.next/standalone/admin-panel`. StackPilot's
standard PM2 installation uses this layout. Non-root, source-based, clustered or
systemd-only installs use their existing deployment procedure instead.

## Deployment steps

Back up the database, check out the target release, and apply its migrations
**before starting the new app**:

```bash
bunx supabase db push --db-url '<your-database-connection-url>'
```

Containers, Coolify, Vercel and Netlify do **not** apply migrations on startup.
The image contains SQL files for reference, but its startup command only starts
Node. Supabase is a separate service, including in the full-stack deployment.

| Runtime | Application update |
| --- | --- |
| StackPilot standalone PM2 | Use the UI when it offers the update action. The signed updater applies migrations through the service-role RPC, replaces the persisted build, restarts PM2 and saves its configuration. |
| Plain PM2 from source | Check out the release; `cd admin-panel`; `bun install --frozen-lockfile`; `bun run build`; `pm2 reload ecosystem.config.js` (single process: `pm2 restart ecosystem.config.js`). Use your existing ecosystem file. |
| systemd only | Build the release as above, then `sudo systemctl restart <your-sellf-service>` using your unit's working directory and service name. |
| `docker run` | Pull `ghcr.io/jurczykpawel/sellf:<version>` and recreate the container with the new image, preserving environment, ports and networks. Restart alone retains the old image. |
| Compose: docker-simple / full-stack | Set `SELLF_VERSION=<version>` in `.env`; `docker compose pull sellf`; `docker compose up -d --force-recreate sellf`. |
| Coolify | Set the image tag, or the release commit for a Dockerfile build, and Redeploy. For a Compose resource, set `SELLF_VERSION` and redeploy the resource. |
| Vercel | Deploy the release source with the existing project environment; wait for Ready and promote to production. |
| Netlify | Deploy the release source with the existing site environment; wait for Published. |

After deploying, use Check for updates to verify the running version. The UI
verifies the live version after an in-place restart and retains script failures.
An unavailable launcher is returned as a failed API request, not an accepted
update. Inspect the instance upgrade log when an in-place update fails.

## Two-stage standalone updater

Updater 2 authenticates the manifest with the installed release key, checks the
signed `min_updater_version`, validates the archive and extracts into a private
temporary directory. It then executes the downloaded release's `scripts/upgrade.sh`
(stage 2) with the same token, installation, progress/log paths and instance lock.
The panel shows the same steps. Packages without stage 2 use the installed fallback.

Since 2026.11.1 the runner sends all pending migrations of a release in one RPC
call, so PostgreSQL applies them in one transaction. If any file fails, none of
them and none of their registry entries remain; the panel names the failing file
and the database error, and the previous code is restored before it starts.
The updater checks every answer to a migration request it sent, an error message
included, against the migration registry (`supabase_migrations.schema_migrations`).
The answer may have been lost, or may have come from a proxy after the changes were
committed. Without asking the database, the previous code is restored only when the
request never left the server.

| What the registry shows | What the updater does |
|---|---|
| every migration of the release | starts the new version |
| none of them, read twice 15 s apart | restores the previous code |
| only some of them, or an answer that cannot be read as a list of entries | leaves the application stopped with the code `migration_state_unknown` |

In the last case nobody knows whether the migrations went in, so neither the old
nor the new version starts. The panel says so in your language and lists what to
check in the registry and what to do next; the exact range of versions and the
folder with the previous code are in the update log. An empty or unreadable registry answer does not prove
that the database is unchanged.

From the moment the running version stops until the new one is up, the shop shows the maintenance
page: the updater creates `<stack>/admin-panel/MAINTENANCE` and deletes it on success, on a restore
of the previous code and on an early stop. After `migration_state_unknown` the file stays, so the
shop takes no orders even if the application is started; see [Maintenance mode](/maintenance/).

Limitation: two reads 15 s apart do not catch a transaction that commits more than
15 s after the connection broke. The updater would then assume nothing changed and
restore the previous code. If the shop misbehaves after such a failure, check the
migration registry.

Before replacing files, the updater waits for PM2 to confirm that the application
stopped. If PM2 does not confirm it, the update ends before any file or the database
changes. If the failed stop attempt still took the application down, the updater
starts it again. The shop keeps running the installed version only when PM2
confirms the process is running. If it does not, the panel says so plainly: files
and the database are unchanged, but it is not known whether the shop is running.
Check it on the server with `pm2 status <process name>` and start a stopped process
with `pm2 start <process name>`.

The latest release is found through the `github.com/<repo>/releases/latest`
redirect and release files are downloaded from `releases/download/<tag>/`. Neither
counts towards the GitHub API limit of 60 requests per hour per address, which
servers behind a shared NAT exhaust. When GitHub refuses or cannot be reached, the
panel shows GitHub's message, the HTTP status, that nothing was changed and the
version still running, and when to retry (from `Retry-After` or the rate-limit
reset time when GitHub sends them). A missing release file and an invalid
signature are reported separately.

You can retry immediately after a failed attempt. The panel refuses a new attempt
only while an update holds the instance lock, or within a few seconds of a launch
(double click), unless that launch has already failed.

These changes take effect from the update that follows installing 2026.11.1: the
first hop still runs the previously installed updater.

## Updating from 2026.10.6 or earlier

2026.11.1 requires updater 2, installed by 2026.11.0. For an existing PM2
installation on 2026.10.6 or earlier, first install the **2026.11.0 package**
from an up-to-date local Stackpilot checkout. Replace `<server>` with your SSH
alias; for multiple shops, add `--instance=<instance>` to select the shop:

```bash
curl -fL -o ./sellf-build-2026.11.0.tar.gz \
  https://github.com/jurczykpawel/sellf/releases/download/v2026.11.0/sellf-build.tar.gz
./local/deploy.sh sellf --ssh=<server> --update --build-file=./sellf-build-2026.11.0.tar.gz
```

After 2026.11.0 is running, use the normal update in the admin panel to install
2026.11.1. Pin the first package as above: `--update` without `--build-file`
downloads the latest release, which may already be 2026.11.1.

On 2026.10.6, “No sellf-build.manifest asset found in latest release…” is expected
when the latest release requires updater 2. The old updater stops before changing
code or the database. Use the pinned 2026.11.0 package above rather than retrying
the same panel update.

## Release metadata source

`SELLF_UPDATE_CHECK_URL` optionally points the **server** to a release metadata
mirror or local test fixture, using the GitHub release JSON format. By default the
version comes from the github.com latest-release redirect; release notes are added
when the GitHub API answers and are omitted otherwise. The requests have a
five-second timeout. This setting only changes notification metadata: `upgrade.sh`
still fetches official release assets and verifies the installed signing key.
Do not configure a mirror advertising a release absent from GitHub.

## Regression checks

Run `cd admin-panel && bun run test:upgrade-matrix`. See
[the suite README](https://github.com/jurczykpawel/sellf/blob/main/admin-panel/tests/upgrade-matrix/README.md)
for prerequisites, disposable ports, evidence and remaining platform limits.
