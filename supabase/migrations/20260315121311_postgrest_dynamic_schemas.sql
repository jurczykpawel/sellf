-- =====================================================
-- PostgREST dynamic schema configuration
-- =====================================================
-- PostgREST needs to know which schemas to expose via the API.
-- With multi-tenant marketplace, new seller schemas are created dynamically
-- by provision_seller_schema(). This pre-config function builds the schema
-- list from the sellers table on every PostgREST config reload (triggered
-- by NOTIFY pgrst, 'reload config' inside provision/deprovision functions).
--
-- @see https://docs.postgrest.org/en/v14/references/configuration.html#in-database-configuration

-- Dedicated schema for PostgREST config (hidden from API)
CREATE SCHEMA IF NOT EXISTS postgrest;
GRANT USAGE ON SCHEMA postgrest TO authenticator;

-- Pre-config function: dynamically sets db_schemas from sellers table
-- COALESCE handles the case when no active sellers exist (string_agg returns NULL)
CREATE OR REPLACE FUNCTION postgrest.pre_config()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT set_config(
    'pgrst.db_schemas',
    COALESCE(
      string_agg(s.schema_name, ', ' ORDER BY s.schema_name) || ', ',
      ''
    ) || 'public, storage, graphql_public',
    true  -- local to transaction
  )
  FROM public.sellers s
  WHERE s.status = 'active';
$$;

-- Only authenticator needs to call this (PostgREST runs it internally)
REVOKE EXECUTE ON FUNCTION postgrest.pre_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION postgrest.pre_config() TO authenticator;

-- Tell PostgREST to use pre_config on every config reload.
-- This survives db reset (role-level setting, not session-level).
ALTER ROLE authenticator SET pgrst.db_pre_config = 'postgrest.pre_config';

-- Trigger initial config + schema reload so PostgREST picks up existing sellers
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
