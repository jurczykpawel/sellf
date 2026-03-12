-- =============================================================================
-- Migration: Marketplace Sellers (Krok 2)
-- Purpose: public.sellers table + provision/deprovision functions
-- Depends on: 20260311000000_pg_clone_schema.sql (clone_schema function)
-- =============================================================================

-- =====================================================
-- SELLERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  stripe_account_id TEXT,
  stripe_onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'deprovisioned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.sellers IS 'Marketplace sellers registry. Each seller has a dedicated PostgreSQL schema cloned from seller_main.';
COMMENT ON COLUMN public.sellers.schema_name IS 'PostgreSQL schema name for this seller (e.g., seller_nick). Must match ^seller_[a-z0-9_]+$';
COMMENT ON COLUMN public.sellers.platform_fee_percent IS 'Platform fee as percentage of transaction amount. Owner (seller_main) has 0%.';
COMMENT ON COLUMN public.sellers.status IS 'pending=awaiting setup, active=operational, suspended=temporarily disabled, deprovisioned=schema dropped';

-- Indexes
CREATE UNIQUE INDEX idx_sellers_slug ON public.sellers (slug);
CREATE UNIQUE INDEX idx_sellers_schema_name ON public.sellers (schema_name);
CREATE UNIQUE INDEX idx_sellers_user_id ON public.sellers (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_sellers_status ON public.sellers (status);
CREATE INDEX idx_sellers_stripe_account ON public.sellers (stripe_account_id) WHERE stripe_account_id IS NOT NULL;

-- Updated_at trigger (reuse shared trigger from public)
CREATE TRIGGER update_sellers_updated_at
  BEFORE UPDATE ON public.sellers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- RLS POLICIES
-- =====================================================

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "sellers_admin_all" ON public.sellers
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

-- Public: read active sellers (for storefront listing)
CREATE POLICY "sellers_public_read_active" ON public.sellers
  FOR SELECT
  USING (status = 'active');

-- Service role: full access (for provisioning)
CREATE POLICY "sellers_service_role_all" ON public.sellers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seller: read own record
CREATE POLICY "sellers_own_read" ON public.sellers
  FOR SELECT
  USING (user_id = auth.uid());

-- =====================================================
-- PROVISION SELLER SCHEMA
-- =====================================================

-- SECURITY DEFINER: runs as postgres (owner) so it can CREATE SCHEMA and
-- execute clone_schema which requires superuser-level privileges.
-- NOACL parameter prevents clone_schema from using SET ROLE (incompatible
-- with SECURITY DEFINER). Our own GRANTs in step 4 handle permissions.
-- Access is restricted via REVOKE/GRANT (only service_role can call this).
CREATE OR REPLACE FUNCTION public.provision_seller_schema(
  p_slug TEXT,
  p_display_name TEXT,
  p_owner_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_schema_name TEXT;
  v_clean_slug TEXT;
  v_seller_id UUID;
  v_clone_result INTEGER;
BEGIN
  -- ==========================================
  -- 1. Validate and sanitize slug
  -- ==========================================
  IF p_slug IS NULL OR length(trim(p_slug)) = 0 THEN
    RAISE EXCEPTION 'Seller slug cannot be empty';
  END IF;

  -- Sanitize: lowercase, replace non-alnum with underscore, collapse multiples
  v_clean_slug := lower(trim(p_slug));
  v_clean_slug := regexp_replace(v_clean_slug, '[^a-z0-9]', '_', 'g');
  v_clean_slug := regexp_replace(v_clean_slug, '_+', '_', 'g');
  v_clean_slug := trim(BOTH '_' FROM v_clean_slug);

  IF length(v_clean_slug) < 2 OR length(v_clean_slug) > 50 THEN
    RAISE EXCEPTION 'Seller slug must be 2-50 characters after sanitization. Got: "%"', v_clean_slug;
  END IF;

  -- Reserved slugs (expanded — includes Supabase internal schemas + common names)
  IF v_clean_slug IN (
    'admin', 'api', 'auth', 'public', 'main', 'test', 'demo',
    'system', 'platform', 'seller', 'sellers',
    -- Supabase internal schemas
    'storage', 'graphql', 'graphql_public', 'realtime', 'pgsodium',
    'pgsodium_masks', 'pgsodium_keyiduser', 'supabase_functions',
    'supabase_migrations', 'extensions', 'vault', 'pgbouncer',
    -- Common reserved names
    'www', 'app', 'mail', 'smtp', 'ftp', 'root', 'support', 'help',
    'billing', 'checkout', 'login', 'signup', 'register', 'dashboard',
    'settings', 'config', 'webhook', 'webhooks', 'stripe', 'payment',
    'payments', 'status', 'health', 'monitor', 'internal'
  ) THEN
    RAISE EXCEPTION 'Slug "%" is reserved', v_clean_slug;
  END IF;

  v_schema_name := 'seller_' || v_clean_slug;

  -- ==========================================
  -- 2. Acquire advisory lock to prevent TOCTOU race condition
  -- Serializes all provisioning attempts for the same slug
  -- ==========================================
  PERFORM pg_advisory_xact_lock(hashtext(v_clean_slug));

  -- ==========================================
  -- 3. Check for duplicates (now safe under lock)
  -- ==========================================
  IF EXISTS (SELECT 1 FROM public.sellers WHERE slug = v_clean_slug) THEN
    RAISE EXCEPTION 'Seller with slug "%" already exists', v_clean_slug;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema_name) THEN
    RAISE EXCEPTION 'Schema "%" already exists in database', v_schema_name;
  END IF;

  -- ==========================================
  -- 4. Clone seller_main schema
  -- ==========================================
  -- Fix for pg-clone-schema $user search_path bug:
  -- Set search_path to 'public' before calling clone_schema
  PERFORM set_config('search_path', 'public', true);

  SELECT public.clone_schema('seller_main', v_schema_name, 'NODATA', 'NOACL')
    INTO v_clone_result;

  IF v_clone_result != 0 THEN
    RAISE EXCEPTION 'clone_schema failed with code %. Schema: %', v_clone_result, v_schema_name;
  END IF;

  -- ==========================================
  -- 5. Grant permissions to Supabase roles (O2: restricted grants)
  -- ==========================================
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', v_schema_name);

  -- anon: read-only access to tables (needed for public product pages)
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon', v_schema_name);
  -- authenticated: full CRUD (RLS policies control actual access)
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema_name);
  -- service_role: unrestricted
  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', v_schema_name);

  -- Sequences: authenticated + service_role need usage for inserts
  EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO authenticated, service_role', v_schema_name);

  -- Functions: all roles can execute (individual function permissions handle auth)
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO anon, authenticated, service_role', v_schema_name);

  -- Default privileges for future objects
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO anon', v_schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated', v_schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role', v_schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE ON SEQUENCES TO authenticated, service_role', v_schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role', v_schema_name);

  -- ==========================================
  -- 6. Insert seller record
  -- ==========================================
  INSERT INTO public.sellers (
    slug, schema_name, display_name, user_id, status
  ) VALUES (
    v_clean_slug, v_schema_name, p_display_name, p_owner_user_id, 'active'
  )
  RETURNING id INTO v_seller_id;

  -- ==========================================
  -- 7. Notify PostgREST to reload schemas
  -- ==========================================
  NOTIFY pgrst, 'reload config';
  NOTIFY pgrst, 'reload schema';

  RETURN v_seller_id;
END;
$$;

COMMENT ON FUNCTION public.provision_seller_schema IS 'Creates a new seller: clones seller_main schema, sets up permissions, inserts seller record. Returns seller UUID.';

-- =====================================================
-- DEPROVISION SELLER SCHEMA
-- =====================================================

-- SECURITY DEFINER: runs as postgres (owner) so it can DROP SCHEMA CASCADE.
-- Access restricted via REVOKE/GRANT (only service_role can call this).
CREATE OR REPLACE FUNCTION public.deprovision_seller_schema(
  p_seller_id UUID,
  p_hard_delete BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seller RECORD;
BEGIN
  -- Get seller record with row lock to prevent concurrent deprovision
  SELECT * INTO v_seller
  FROM public.sellers
  WHERE id = p_seller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller with id "%" not found', p_seller_id;
  END IF;

  IF v_seller.schema_name = 'seller_main' THEN
    RAISE EXCEPTION 'Cannot deprovision the owner schema (seller_main)';
  END IF;

  IF v_seller.status = 'deprovisioned' AND NOT p_hard_delete THEN
    RAISE EXCEPTION 'Seller "%" is already deprovisioned', v_seller.slug;
  END IF;

  IF p_hard_delete THEN
    -- ==========================================
    -- Hard delete: DROP schema + DELETE seller row
    -- ==========================================
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_seller.schema_name) THEN
      EXECUTE format('DROP SCHEMA %I CASCADE', v_seller.schema_name);
    END IF;

    DELETE FROM public.sellers WHERE id = p_seller_id;

    NOTIFY pgrst, 'reload config';
    NOTIFY pgrst, 'reload schema';
  ELSE
    -- ==========================================
    -- Soft delete: mark as deprovisioned
    -- ==========================================
    UPDATE public.sellers
    SET status = 'deprovisioned', updated_at = NOW()
    WHERE id = p_seller_id;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.deprovision_seller_schema IS 'Soft-deletes seller (status=deprovisioned) or hard-deletes (DROP SCHEMA CASCADE + DELETE row).';

-- =====================================================
-- GRANTs
-- =====================================================

-- Revoke all access (including default ACLs granted to anon/authenticated by Supabase)
REVOKE ALL ON FUNCTION public.provision_seller_schema FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deprovision_seller_schema FROM PUBLIC, anon, authenticated, service_role;

-- Only service_role can provision/deprovision (called from API routes, not directly by users)
GRANT EXECUTE ON FUNCTION public.provision_seller_schema TO service_role;
GRANT EXECUTE ON FUNCTION public.deprovision_seller_schema TO service_role;

-- Sellers table: PostgREST needs access for RLS-governed queries
GRANT ALL ON public.sellers TO anon, authenticated, service_role;

-- =====================================================
-- OWNER SELLER (seller_main)
-- =====================================================
-- The platform owner uses seller_main schema directly.
-- Inserted with 0% fee (owner doesn't pay platform fee to themselves).

INSERT INTO public.sellers (
  slug, schema_name, display_name, platform_fee_percent, status
) VALUES (
  'main', 'seller_main', 'Platform Owner', 0.00, 'active'
)
ON CONFLICT (slug) DO NOTHING;
