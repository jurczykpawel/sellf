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
Migration failures restore old code before it starts; committed database migrations
are not reversed (the RPC transaction is still per file).

2026.11.0 requires updater 1 (the unversioned 10.6 script). CI publishes a signed
three-line V2 manifest alongside the legacy two-line manifest for that bridge.
The old script cannot delegate on its first hop, and its self-copy may leave a
trailing shell error even after reporting success. Use an up-to-date Stackpilot
checkout to use the downloaded runner during that first hop. If the panel reports
an old updater or cannot verify the signed requirement, retry the check or run
from your local Stackpilot checkout, replacing `<server>` with your SSH alias:

```bash
./local/deploy.sh sellf --ssh=<server> --update
```

## Release metadata source

`SELLF_UPDATE_CHECK_URL` optionally points the **server** to a release metadata
mirror or local test fixture, using the GitHub release JSON format. The default
is GitHub's latest-release API. The request has a five-second timeout and does not
follow redirects. This setting only changes notification metadata: `upgrade.sh`
still fetches official release assets and verifies the installed signing key.
Do not configure a mirror advertising a release absent from GitHub.

## Regression checks

Run `cd admin-panel && bun run test:upgrade-matrix`. See
[the suite README](https://github.com/jurczykpawel/sellf/blob/main/admin-panel/tests/upgrade-matrix/README.md)
for prerequisites, disposable ports, evidence and remaining platform limits.
