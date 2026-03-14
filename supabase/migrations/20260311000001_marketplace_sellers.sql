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
  USING (( select public.is_admin() ));

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
  USING (user_id = (select auth.uid()));

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
  -- 5. Grant permissions to Supabase roles (Security Rule #5: explicit per-table)
  -- ==========================================
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', v_schema_name);

  -- service_role: unrestricted on all tables
  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', v_schema_name);

  -- Sequences: authenticated + service_role need usage for inserts
  EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO authenticated, service_role', v_schema_name);

  -- Functions: only service_role gets blanket execute.
  -- Individual public RPC functions are granted to anon/authenticated explicitly below.
  -- This mirrors the seller_main pattern fixed in core_schema + restrict_rpc_function_access.
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO service_role', v_schema_name);

  -- Public catalog tables: anon gets SELECT (storefront browsing).
  -- authenticated gets SELECT + mutation grants for admin CRUD (RLS is the real guard).
  EXECUTE format('GRANT SELECT ON %I.products TO anon', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.products TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.variant_groups TO anon', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.variant_groups TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.product_variant_groups TO anon', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I.product_variant_groups TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.categories TO anon, authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.product_categories TO anon', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I.product_categories TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.tags TO anon, authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.product_tags TO anon, authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.shop_config TO anon', v_schema_name);
  EXECUTE format('GRANT SELECT, UPDATE ON %I.shop_config TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.product_price_history TO anon, authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.order_bumps TO anon', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.order_bumps TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.oto_offers TO anon', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.oto_offers TO authenticated', v_schema_name);
  -- User data tables: authenticated CRUD (RLS enforced)
  EXECUTE format('GRANT SELECT, DELETE ON %I.user_product_access TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.video_progress TO authenticated', v_schema_name);
  EXECUTE format('GRANT INSERT ON %I.video_events TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT ON %I.coupon_redemptions TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I.coupon_reservations TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT ON %I.consent_logs TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT, UPDATE ON %I.profiles TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT, UPDATE ON %I.payment_transactions TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.refund_requests TO authenticated', v_schema_name);
  EXECUTE format('GRANT DELETE ON %I.guest_purchases TO authenticated', v_schema_name);
  EXECUTE format('GRANT SELECT ON %I.payment_line_items TO authenticated', v_schema_name);

  -- Default privileges for future objects: only service_role gets automatic grants
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role', v_schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE ON SEQUENCES TO authenticated, service_role', v_schema_name);
  -- Note: no blanket EXECUTE grant for functions — service_role covered above, anon/authenticated
  -- must be granted per-function explicitly (same pattern as seller_main in restrict_rpc_function_access)

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

-- Sellers table: PostgREST needs access for RLS-governed queries.
-- Principle of least privilege — anon/authenticated only need SELECT (public seller registry).
-- Mutations happen via service_role only (provision/deprovision functions).
-- HIGH-001: Revoke all privileges first so implicit defaults (INSERT/UPDATE/DELETE) are removed.
REVOKE ALL ON public.sellers FROM anon, authenticated;
GRANT SELECT ON public.sellers TO anon, authenticated;
GRANT ALL ON public.sellers TO service_role;

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

-- =====================================================
-- SECURITY: REVOKE clone_schema helpers from anon/authenticated (Security Rule #7)
-- =====================================================
-- These functions are internal tools for schema provisioning.
-- They MUST NOT be callable via PostgREST RPC by anon/authenticated users.
REVOKE EXECUTE ON FUNCTION public.clone_schema(text, text, VARIADIC public.cloneparms[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_schema(text, text, VARIADIC public.cloneparms[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.pg_get_tabledef(varchar, varchar, boolean, VARIADIC public.tabledefs[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_get_tabledef(varchar, varchar, boolean, VARIADIC public.tabledefs[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.pg_get_coldef(text, text, text, boolean) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_get_coldef(text, text, text, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_insert_stmt_ddl(text, text, text, boolean, boolean) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_insert_stmt_ddl(text, text, text, boolean, boolean) TO service_role;

-- =====================================================
-- SECURITY: Revoke default EXECUTE on new functions from anon/authenticated
-- =====================================================
-- By default, PostgreSQL grants EXECUTE on new functions to PUBLIC.
-- This means every new function created in seller_main is callable by
-- anon/authenticated via PostgREST RPC. Revoke this default and require
-- explicit GRANT per function.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA seller_main
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;

-- =====================================================
-- SECURITY: REVOKE EXECUTE from anon on seller_main functions
-- =====================================================
-- Payment-critical and admin-only functions should not be callable by
-- anonymous (unauthenticated) users. These functions have internal auth
-- checks that reject anon callers, but the EXECUTE grant is unnecessary
-- attack surface.
REVOKE EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion_with_bump FROM anon;
REVOKE EXECUTE ON FUNCTION seller_main.admin_get_product_order_bumps FROM anon;
REVOKE EXECUTE ON FUNCTION seller_main.admin_get_product_oto_offer FROM anon;
REVOKE EXECUTE ON FUNCTION seller_main.admin_save_oto_offer FROM anon;
REVOKE EXECUTE ON FUNCTION seller_main.admin_delete_oto_offer FROM anon;
REVOKE EXECUTE ON FUNCTION seller_main.claim_guest_purchases_for_user FROM anon;
