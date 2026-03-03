-- ============================================================================
-- Self-Upgrade Migration System
-- ============================================================================
--
-- Enables upgrade.sh to apply SQL migrations via Supabase REST API (PostgREST)
-- using the existing SUPABASE_SERVICE_ROLE_KEY — no DATABASE_URL needed.
--
-- Security model:
--   1. PostgreSQL GRANT/REVOKE: only service_role can call apply_migration()
--      (enforced by the PG engine BEFORE function body runs)
--   2. Internal role check: defense-in-depth verification of current_setting('role')
--   3. Advisory lock: prevents concurrent migration execution
--   4. SHA-256 checksum: verifies migration SQL content hasn't been tampered with
--   5. Rate limiting: max 50 migration calls per 10 minutes
--   6. Version format validation: only YYYYMMDDHHMMSS_snake_case accepted
--   7. Idempotency: skip already-applied migrations
--   8. SET search_path = '': prevents CVE-2018-1058 schema poisoning
--
-- Attack surface:
--   Service role key holders can execute arbitrary DDL — this is intentional.
--   The service role key already grants full data access (bypasses RLS).
--   DDL access is a marginal increase on an already-powerful credential.
--   The key is stored in .env.local with chmod 600 on the server.
--
-- @see admin-panel/scripts/upgrade.sh (consumer)
-- @see 20260302000000_fix_rate_limit_grants.sql (REVOKE pattern)
-- ============================================================================


-- ===== MIGRATION HISTORY TABLE =====

CREATE TABLE IF NOT EXISTS public._migration_history (
  version       TEXT PRIMARY KEY,                      -- e.g. "20260302000000_fix_rate_limit_grants"
  checksum      TEXT,                                  -- SHA-256 of SQL content (NULL for seed entries)
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by    TEXT NOT NULL DEFAULT 'upgrade.sh',
  execution_ms  INTEGER                                -- NULL for seed entries
);

-- RLS enabled but no policies = no access via PostgREST tables endpoint.
-- Only accessible through SECURITY DEFINER functions or service_role direct grants.
ALTER TABLE public._migration_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._migration_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public._migration_history TO service_role;


-- ===== APPLY MIGRATION FUNCTION =====

CREATE OR REPLACE FUNCTION public.apply_migration(
  migration_version TEXT,
  migration_sql TEXT,
  content_checksum TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_elapsed_ms INTEGER;
BEGIN
  -- LAYER 1: Role check (defense-in-depth, primary protection is GRANT/REVOKE below)
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: only service_role can apply migrations'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- LAYER 2: Rate limit (max 50 migrations per 10 minutes — enough for a full upgrade)
  IF NOT public.check_rate_limit('apply_migration', 50, 600) THEN
    RAISE EXCEPTION 'Rate limited: too many migration attempts'
      USING ERRCODE = '54000';  -- program_limit_exceeded
  END IF;

  -- LAYER 3: Validate version format (YYYYMMDDHHMMSS_lowercase_with_underscores)
  IF migration_version !~ '^[0-9]{14}_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid migration version format: %', migration_version
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- LAYER 4: Idempotency — skip if already applied (fast path, no lock needed)
  IF EXISTS (
    SELECT 1 FROM public._migration_history WHERE version = migration_version
  ) THEN
    RETURN jsonb_build_object(
      'version', migration_version,
      'success', true,
      'skipped', true,
      'message', 'Already applied'
    );
  END IF;

  -- LAYER 5: Prevent concurrent migrations (transaction-scoped advisory lock)
  PERFORM pg_advisory_xact_lock(hashtext('sellf_apply_migration'));

  -- Re-check after acquiring lock (another process may have applied it)
  IF EXISTS (
    SELECT 1 FROM public._migration_history WHERE version = migration_version
  ) THEN
    RETURN jsonb_build_object(
      'version', migration_version,
      'success', true,
      'skipped', true,
      'message', 'Already applied (concurrent)'
    );
  END IF;

  -- LAYER 6: Verify checksum — ensures SQL content matches what was shipped in the release
  -- Use convert_to() instead of ::bytea cast to avoid "invalid input syntax for type bytea"
  -- errors when migration SQL contains backslash sequences (e.g. E'\n' in string literals).
  IF encode(sha256(convert_to(migration_sql, 'UTF8')), 'hex') IS DISTINCT FROM content_checksum THEN
    RAISE EXCEPTION 'Checksum mismatch for migration %: expected %, got %',
      migration_version,
      content_checksum,
      encode(sha256(convert_to(migration_sql, 'UTF8')), 'hex')
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- LAYER 7: Execute the migration SQL
  v_start := clock_timestamp();
  EXECUTE migration_sql;
  v_elapsed_ms := extract(milliseconds FROM clock_timestamp() - v_start)::INTEGER;

  -- Record successful application
  INSERT INTO public._migration_history (version, checksum, applied_by, execution_ms)
  VALUES (migration_version, content_checksum, 'upgrade.sh/rpc', v_elapsed_ms);

  RETURN jsonb_build_object(
    'version', migration_version,
    'success', true,
    'skipped', false,
    'execution_ms', v_elapsed_ms
  );
END;
$$;

-- Primary security layer: PostgreSQL access control
REVOKE ALL ON FUNCTION public.apply_migration(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_migration(TEXT, TEXT, TEXT) TO service_role;


-- ===== GET MIGRATION STATUS FUNCTION =====
-- Read-only function for upgrade.sh to check which migrations are already applied.

CREATE OR REPLACE FUNCTION public.get_migration_status()
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'version', h.version,
      'applied_at', h.applied_at
    ) ORDER BY h.version),
    '[]'::jsonb
  )
  FROM public._migration_history h;
$$;

REVOKE ALL ON FUNCTION public.get_migration_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_migration_status() TO service_role;


-- ===== SEED EXISTING MIGRATIONS =====
-- Mark all previously-applied migrations so upgrade.sh doesn't try to re-run them.

INSERT INTO public._migration_history (version, checksum, applied_by, execution_ms)
VALUES
  ('20250101000000_core_schema',                NULL, 'initial_setup', NULL),
  ('20250102000000_payment_system',             NULL, 'initial_setup', NULL),
  ('20250103000000_features',                   NULL, 'initial_setup', NULL),
  ('20251228152500_gus_api_integration',        NULL, 'initial_setup', NULL),
  ('20251229120000_omnibus_directive',           NULL, 'initial_setup', NULL),
  ('20251230000000_oto_system',                 NULL, 'initial_setup', NULL),
  ('20260108000000_api_keys',                   NULL, 'initial_setup', NULL),
  ('20260115163547_abandoned_cart_recovery',     NULL, 'initial_setup', NULL),
  ('20260116000000_payment_method_configuration', NULL, 'initial_setup', NULL),
  ('20260218000000_vat_rate_default_null',      NULL, 'initial_setup', NULL),
  ('20260225131105_allow_pwyw_free',            NULL, 'initial_setup', NULL),
  ('20260226000000_tracking_logs',              NULL, 'initial_setup', NULL),
  ('20260302000000_fix_rate_limit_grants',      NULL, 'initial_setup', NULL),
  ('20260303000000_migration_rpc',              NULL, 'self', NULL)
ON CONFLICT (version) DO NOTHING;
