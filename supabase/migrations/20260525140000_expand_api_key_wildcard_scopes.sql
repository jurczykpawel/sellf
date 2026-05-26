-- Replace the wildcard scope marker on existing public.api_keys rows with the
-- explicit snapshot of every scope known at this version.
--
-- After this migration, application code expands "*" to a concrete list
-- at key-creation time. Stored rows never contain the marker again — the
-- DEFAULT is also tightened to the explicit list.
--
-- Idempotent: rows without "*" are left untouched. The CASE clause copies
-- through any concrete scopes that may already be present alongside "*"
-- and the SELECT DISTINCT/ORDER BY in the source dedupes the result.

-- NOTE: no top-level BEGIN/COMMIT — the upgrade.sh deploy path applies
-- migrations via the apply_migration RPC, which executes each migration
-- inside its own EXECUTE-wrapped transaction and rejects nested
-- BEGIN/COMMIT/ROLLBACK with SQLSTATE 0A000. Each statement below is
-- independently safe to retry; the file is idempotent.

SET client_min_messages = warning;

WITH scope_snapshot AS (
  SELECT jsonb_agg(scope ORDER BY scope) AS scopes
  FROM (
    SELECT unnest(ARRAY[
      'products:read',
      'products:write',
      'users:read',
      'users:write',
      'coupons:read',
      'coupons:write',
      'analytics:read',
      'payments:read',
      'payments:write',
      'payments:refund',
      'webhooks:read',
      'webhooks:write',
      'integrations:write',
      'refund-requests:read',
      'refund-requests:write',
      'system:read',
      'system:write'
    ]) AS scope
  ) s
)
UPDATE public.api_keys k
SET scopes = (
  SELECT jsonb_agg(DISTINCT s ORDER BY s)
  FROM (
    SELECT jsonb_array_elements_text(snapshot.scopes) AS s
    FROM scope_snapshot snapshot
    UNION
    SELECT jsonb_array_elements_text(k.scopes) AS s
    WHERE jsonb_typeof(k.scopes) = 'array'
  ) merged
  WHERE merged.s <> '*'
)
FROM scope_snapshot snapshot
WHERE jsonb_typeof(k.scopes) = 'array'
  AND k.scopes ? '*';

-- Tighten the column default so new INSERTs that omit `scopes` no longer
-- write the marker. Application code calls expandScopes() before INSERT,
-- so this is a belt-and-braces guard against direct SQL.
ALTER TABLE public.api_keys
  ALTER COLUMN scopes SET DEFAULT jsonb_build_array(
    'products:read',
    'products:write',
    'users:read',
    'users:write',
    'coupons:read',
    'coupons:write',
    'analytics:read',
    'payments:read',
    'payments:write',
    'payments:refund',
    'webhooks:read',
    'webhooks:write',
    'integrations:write',
    'refund-requests:read',
    'refund-requests:write',
    'system:read',
    'system:write'
  );

-- Replace the stale column comment that still documents wildcard semantics.
COMMENT ON COLUMN public.api_keys.scopes IS
  'JSONB array of explicit scope strings. The "*" wildcard is never persisted: it is expanded to the current scope snapshot at key-creation time (see expandScopes in admin-panel/src/lib/api/api-keys.ts).';
