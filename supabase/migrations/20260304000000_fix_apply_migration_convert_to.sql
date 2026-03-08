-- Fix apply_migration to use convert_to() instead of ::bytea cast.
--
-- The ::bytea cast in v1.2.0 fails when migration SQL contains backslash
-- sequences (e.g. regex patterns with literal dots) with error 22P02.
-- convert_to(text, 'UTF8') treats the string as-is without escape interpretation.
--
-- This migration re-applies the corrected apply_migration function so that
-- subsequent migrations with backslashes in their SQL can be applied.

CREATE OR REPLACE FUNCTION public.apply_migration(
  migration_version TEXT,
  migration_sql TEXT,
  content_checksum TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  start_ts TIMESTAMPTZ := clock_timestamp();
  computed_checksum TEXT;
  execution_ms INTEGER;
BEGIN
  -- Skip if already applied
  IF EXISTS (
    SELECT 1 FROM public._migration_history WHERE version = migration_version
  ) THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'success', true,
      'version', migration_version
    );
  END IF;

  -- Execute the migration SQL
  EXECUTE migration_sql;

  execution_ms := EXTRACT(EPOCH FROM (clock_timestamp() - start_ts)) * 1000;

  -- Use convert_to() to avoid 22P02 errors on SQL containing backslash sequences
  computed_checksum := encode(sha256(convert_to(migration_sql, 'UTF8')), 'hex');

  IF content_checksum IS NOT NULL AND computed_checksum IS DISTINCT FROM content_checksum THEN
    RAISE EXCEPTION 'Checksum mismatch for migration %: expected %, got %',
      migration_version, content_checksum, computed_checksum;
  END IF;

  INSERT INTO public._migration_history (version, checksum, applied_by, execution_ms)
  VALUES (
    migration_version,
    computed_checksum,
    'upgrade.sh/rpc',
    execution_ms
  );

  RETURN jsonb_build_object(
    'skipped', false,
    'success', true,
    'version', migration_version,
    'execution_ms', execution_ms
  );
END;
$$;
