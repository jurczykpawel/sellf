# Release runbook — `chore/api-and-db-cleanup`

Apply this branch to `sellf-tsa` (mikrus prod) and `sellf-demo` after merge.

## Pre-flight checklist

- [ ] Branch merged to `main` and tagged.
- [ ] Code deploy (PM2) reaches `v2026.5.3` or whatever tag this branch carries.
- [ ] `bw` CLI unlocked locally (`source ~/.zshenv` so `BW_SESSION` is loaded).
- [ ] `psql` available locally (`/opt/homebrew/Cellar/libpq/<v>/bin/psql` works).

## What changes in this release

- Adds new env var `CHECKOUT_BINDING_SECRET` (per the RFC at
  `docs/security-rfc-checkout-binding.md`). Production refuses to boot
  without it.
- Three new database migrations to apply on managed Supabase:
  - `20260520200000_check_rate_limit_per_identifier` — already on `main`
    from the prior release branch; not yet on prod.
  - `20260521000000_products_temporal_rls_and_config_grants`
  - `20260521010000_idempotent_completion_and_claim_locking`

## Step 1 — Configure new env var on every instance

Generate one secret per deployment target. Same secret across instances of
the same logical app (so failover keeps in-flight sessions valid); separate
secrets per environment.

```bash
openssl rand -base64 32
```

Add the resulting line to `.env.local` on each mikrus host:

```
CHECKOUT_BINDING_SECRET=<paste-output>
```

Hosts to update:

- mikrus `sellf-tsa` → `/opt/stacks/sellf-tsa/.env.local`
- mikrus `sellf-demo` → `/opt/stacks/sellf-demo/.env.local`
- (optional) hanna staging → `/opt/stacks/sellf-hanna/.env.local`

After editing `.env.local` use `pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>` per
`feedback_pm2_restart_env_cache` (PM2 does not pick up env changes via
`pm2 restart --update-env` on this codebase).

## Step 2 — Apply DB migrations to TSA prod

Connection string lives in Vaultwarden item **`Sellf DB - TSA prod`**. The
notes field contains the pooler URL. Project id: `grinnleqqyygznnbpjzc`,
region `eu-central-1`.

```bash
source ~/.zshenv

# Load creds from Vaultwarden — never paste them into the shell history
PROD_PASS=$(bw get password "Sellf DB - TSA prod")
PSQL=/opt/homebrew/Cellar/libpq/*/bin/psql

# 1) Check the latest applied migration as a sanity check
PGPASSWORD="$PROD_PASS" $PSQL \
  "postgresql://postgres.grinnleqqyygznnbpjzc@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
  -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"

# 2) Apply each pending migration in order. Each one is wrapped in BEGIN/COMMIT
# so a syntax error rolls back the whole file.
for f in \
  supabase/migrations/20260520200000_check_rate_limit_per_identifier.sql \
  supabase/migrations/20260521000000_products_temporal_rls_and_config_grants.sql \
  supabase/migrations/20260521010000_idempotent_completion_and_claim_locking.sql ; do
  echo "Applying $f ..."
  PGPASSWORD="$PROD_PASS" $PSQL \
    "postgresql://postgres.grinnleqqyygznnbpjzc@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
    -v ON_ERROR_STOP=1 -f "$f"
done

# 3) Record the applied migrations in the Supabase tracking table.
PGPASSWORD="$PROD_PASS" $PSQL \
  "postgresql://postgres.grinnleqqyygznnbpjzc@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES
  ('20260520200000', 'check_rate_limit_per_identifier'),
  ('20260521000000', 'products_temporal_rls_and_config_grants'),
  ('20260521010000', 'idempotent_completion_and_claim_locking')
ON CONFLICT (version) DO NOTHING;
SQL
```

## Step 3 — Apply DB migrations to demo

Same procedure with the demo creds (Vaultwarden item **`Sellf DB - demo`**,
project id `xsomtlptzcspciittsah`, region `eu-west-1`, pooler endpoint
`aws-1-eu-west-1.pooler.supabase.com:5432`).

```bash
DEMO_PASS=$(bw get password "Sellf DB - demo")
DEMO_URL="postgresql://postgres.xsomtlptzcspciittsah@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"

for f in \
  supabase/migrations/20260520200000_check_rate_limit_per_identifier.sql \
  supabase/migrations/20260521000000_products_temporal_rls_and_config_grants.sql \
  supabase/migrations/20260521010000_idempotent_completion_and_claim_locking.sql ; do
  echo "Applying $f to demo ..."
  PGPASSWORD="$DEMO_PASS" $PSQL "$DEMO_URL" -v ON_ERROR_STOP=1 -f "$f"
done

PGPASSWORD="$DEMO_PASS" $PSQL "$DEMO_URL" <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES
  ('20260520200000', 'check_rate_limit_per_identifier'),
  ('20260521000000', 'products_temporal_rls_and_config_grants'),
  ('20260521010000', 'idempotent_completion_and_claim_locking')
ON CONFLICT (version) DO NOTHING;
SQL
```

## Step 4 — Smoke checks (per instance)

```bash
# App is up and refuses anon on critical RPCs (regression on KRYT-01).
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST 'https://sellf.techskills.academy/rest/v1/rpc/process_stripe_payment_completion_with_bump' \
  -H "apikey: $(bw get item 'Sellf Supabase Cloud - TSA prod' | jq -r '.fields[]|select(.name==\"anon_key\")|.value')" \
  -H 'Content-Type: application/json' -d '{}'
# expect: 401

# Storefront listing skips coming-soon products.
curl -sS 'https://sellf.techskills.academy/api/v1/products?status=active' \
  -H "Authorization: Bearer <read-only-api-key>" | jq '.data | length'

# Update-payment-metadata refuses without bindingToken (Forbidden).
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST 'https://sellf.techskills.academy/api/update-payment-metadata' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://sellf.techskills.academy' \
  -d '{"clientSecret":"pi_test_secret_fake"}'
# expect: 403
```

## Step 5 — Rollback

If a migration fails partway:

- The transaction in each `.sql` file rolls back automatically on
  `ON_ERROR_STOP=1`. No state change.
- Reverting an applied migration requires running an inverse SQL by hand —
  there is no "downgrade" script. For the three migrations in this branch:
  - `20260520200000` — drop the new 4-arg overload and `cleanup_old_rate_limits` helper; not safe to revert if anything is already using the per-identifier bucket.
  - `20260521000000` — `DROP POLICY` + recreate the old `"SELECT policy for products"`; restore the `GRANT SELECT, UPDATE ON seller_main.payment_method_config TO authenticated`.
  - `20260521010000` — re-apply the original function bodies from `20250102000000_payment_system.sql` (block 610-1112 and 1119-1272) as `CREATE OR REPLACE`.

Document the rollback decision in `vault/personal/_db-tasks/` before
executing.

## Step 6 — Post-deploy verification

- [ ] `supabase_migrations.schema_migrations` shows all three new rows.
- [ ] Stripe webhook replay test: post a `checkout.session.completed`
      payload twice. First write inserts; second promotes `pending -> completed`
      (was `DO NOTHING`).
- [ ] Concurrent guest claim: with two browser sessions of the same email
      magic-link, only one `claim_guest_purchases_for_user` invocation
      processes each row (the other skips it via `FOR UPDATE SKIP LOCKED`).
- [ ] `update-payment-metadata` from the storefront checkout still works
      end-to-end (binding token is sent automatically by the page).
