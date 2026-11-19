---
title: Maintenance mode
description: Pause the shop and new payments for a planned break or an update, while the admin panel and Stripe webhooks keep working.
---

Maintenance mode puts the shop on a break. While it is on:

- the shop home page, product pages, the checkout, embedded checkout and the login wall show
  **“Down for maintenance, we’ll be back soon”** in Polish or English (from the URL, the language
  cookie or the browser), with your optional note and expected end. The page answers HTTP `503`
  with a `Retry-After` header, so search engines and browsers come back later;
- no new payment can start: `/api/create-payment-intent`, `/api/embed/*`, `/api/orders/bank-transfer`,
  `/api/orders/{id}/pay`, free product claims, coupons and order bumps answer `503` with
  `{ "code": "MAINTENANCE", "maintenance": { "message", "expected_end_at" } }`;
- nothing new is taken without a payment either: free access is not granted (also from the magic
  link or the payment return page), and lead forms (`/api/leads/*`), waitlist signups and free-product
  sign-up links answer `503`. A request the buyer made before the break still completes: the link
  from the free-product email and the lead confirmation link grant access as usual. While the database
  switch is on, the database itself also refuses a new free grant requested directly through its API.

Nothing else changes. Products and settings stay as they are, you can sign in to the admin panel,
API v1 works, buyers can open their accounts, and Stripe webhooks are accepted: a payment the buyer
made before the break (or finishes in an already open Stripe form) is completed as usual, and the
payment return page still works.

## Two sources

Maintenance mode is on when **either** source is on. The server source wins.

| Source | Switched by | Works when the database is down | Ends when |
|---|---|---|---|
| Server file `MAINTENANCE` (or `SELLF_MAINTENANCE=true`) | the update script, or you on the server | yes | the file is deleted (or the variable removed and the app restarted) |
| Database switch | Settings → System → Maintenance mode, or API v1 | no | you turn it off |

**Server file.** Sellf looks for a file named `MAINTENANCE` next to `.env.local` in a standalone
installation (`<stack>/admin-panel/MAINTENANCE`, e.g. `/opt/stacks/sellf-tsa/admin-panel/MAINTENANCE`),
otherwise in the app's working directory. `SELLF_MAINTENANCE_FILE` sets another path: put it in
`.env.local` (an environment variable of the process wins over `.env.local`). A relative path is
relative to the installation directory, the one with `.env.local`. The update started from the panel
receives the path the running app uses and passes it on to the version it starts, so the same file
holds the shop before the stop and after the start. A changed setting takes effect after the app
restarts with a fresh environment (for example a Stackpilot update or restart); an update from the
panel keeps the path the app was running with. It is checked
before any database request, so it also works while the database is down, an update runs or a backup
is restored. The file may be empty, hold a plain-text note for visitors, or JSON
`{ "message": "…", "expected_end_at": "2026-11-17T14:00:00Z" }`.

```bash
touch /opt/stacks/sellf-tsa/admin-panel/MAINTENANCE   # on
rm /opt/stacks/sellf-tsa/admin-panel/MAINTENANCE      # off
```

For Docker and other deployments without a file you can reach, set `SELLF_MAINTENANCE=true` and
restart the app.

**Database switch.** In **Settings → System → Maintenance mode** write an optional note (at most 500
characters) and expected end, then **Turn on maintenance mode**. The section shows which source is on;
for the server file it names the file and the command that removes it. Every change is written to the
audit log together with the change, in one database transaction.

In the panel, a past expected end shows an error beside that field. Focus moves to the field and screen readers receive its invalid state; maintenance stays unchanged. Choose a future time or clear the optional field.

## During an update

The in-place update (Settings → System) creates the server file right before it stops the running
version and deletes it when the new version is up, or when it restores the previous version or stops
early. The file it writes carries a random token of that update run, and the update deletes or
rewrites the file only while it still holds exactly that content. A file you created yourself, before
or during the update, is left as it is, also JSON that looks like the update's file.

When the update cannot tell whether the database migrations were applied (`migration_state_unknown`),
the file stays: the shop takes no orders even if someone starts the application, until the database
is checked. The update message names the file. A re-run of the update keeps it during the run and
removes it only after the new version is up; if the re-run fails, it stays. Otherwise delete it
yourself.

## API v1

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/system/maintenance` | `system:read` | Effective state, its source (`file`, `env`, `database`), the server file path |
| PATCH | `/api/v1/system/maintenance` | `system:write` | `{ "enabled": true, "message": "…", "expected_end_at": "…" }` switches the database source; `{ "enabled": false }` turns it off and clears the note |

The expected end must be in the future (`400` otherwise). A server-side source cannot be switched
through the API; the response says it is on (`source: "file"`) and where the file is.
