-- ============================================================================
-- Self-Upgrade Migration System
-- ============================================================================
--
-- Enables upgrade.sh to apply SQL migrations via Supabase REST API (PostgREST)
-- using the existing SUPABASE_SERVICE_ROLE_KEY — no DATABASE_URL needed.
--
-- Tracking source of truth: supabase_migrations.schema_migrations (built-in
-- Supabase table). Both `supabase db push` (Supabase CLI) and the RPC below
-- write to the same table, eliminating the dual-tracking desync that caused
-- KRYT-01 to slip through (custom _migration_history was bypassed when
-- migrations were pushed via Supabase CLI).
--
-- Security model:
--   1. PostgreSQL GRANT/REVOKE: only service_role can call apply_migration()
--   2. Internal role check: defense-in-depth verification of auth.role()
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
--
-- @see admin-panel/scripts/upgrade.sh (consumer)
-- ============================================================================


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
  v_version_ts TEXT;
  v_version_name TEXT;
BEGIN
  -- LAYER 1: Role check
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: only service_role can apply migrations'
      USING ERRCODE = '42501';
  END IF;

  -- LAYER 2: Rate limit
  IF NOT public.check_rate_limit('apply_migration', 50, 600) THEN
    RAISE EXCEPTION 'Rate limited: too many migration attempts'
      USING ERRCODE = '54000';
  END IF;

  -- LAYER 3: Validate version format (YYYYMMDDHHMMSS_lowercase_with_underscores)
  IF migration_version !~ '^[0-9]{14}_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid migration version format: %', migration_version
      USING ERRCODE = '22023';
  END IF;

  -- Split version into timestamp + name parts (schema_migrations stores them separately)
  v_version_ts := substring(migration_version from 1 for 14);
  v_version_name := substring(migration_version from 16);

  -- LAYER 4: Idempotency — check by timestamp (the actual PK of schema_migrations)
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = v_version_ts
  ) THEN
    RETURN jsonb_build_object(
      'version', migration_version,
      'success', true,
      'skipped', true,
      'message', 'Already applied'
    );
  END IF;

  -- LAYER 5: Advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('sellf_apply_migration'));

  -- Re-check after lock
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = v_version_ts
  ) THEN
    RETURN jsonb_build_object(
      'version', migration_version,
      'success', true,
      'skipped', true,
      'message', 'Already applied (concurrent)'
    );
  END IF;

  -- LAYER 6: Checksum verify
  IF encode(sha256(convert_to(migration_sql, 'UTF8')), 'hex') IS DISTINCT FROM content_checksum THEN
    RAISE EXCEPTION 'Checksum mismatch for migration %: expected %, got %',
      migration_version,
      content_checksum,
      encode(sha256(convert_to(migration_sql, 'UTF8')), 'hex')
      USING ERRCODE = '22023';
  END IF;

  -- LAYER 7: Execute
  v_start := clock_timestamp();
  EXECUTE migration_sql;
  v_elapsed_ms := extract(milliseconds FROM clock_timestamp() - v_start)::INTEGER;

  -- Record into the single source of truth
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES (v_version_ts, v_version_name)
  ON CONFLICT (version) DO NOTHING;

  RETURN jsonb_build_object(
    'version', migration_version,
    'success', true,
    'skipped', false,
    'execution_ms', v_elapsed_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_migration(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_migration(TEXT, TEXT, TEXT) TO service_role;


-- ===== GET MIGRATION STATUS FUNCTION =====
-- Returns versions in the YYYYMMDDHHMMSS_name format expected by upgrade.sh
-- (matches the basename of files in supabase/migrations/).

-- SECURITY DEFINER required: service_role does not have USAGE on the
-- supabase_migrations schema, but the function owner (postgres) does.
-- Only service_role can call (REVOKE/GRANT below), so this is safe.
CREATE OR REPLACE FUNCTION public.get_migration_status()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'version', sm.version || COALESCE('_' || sm.name, '')
    ) ORDER BY sm.version),
    '[]'::jsonb
  )
  FROM supabase_migrations.schema_migrations sm;
$$;

REVOKE ALL ON FUNCTION public.get_migration_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_migration_status() TO service_role;
