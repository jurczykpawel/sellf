-- Create initial database structure for Sellf Admin Panel
-- Migration: 20250709160000_initial_schema
-- Updated: Consolidated all admin functionality into single migration
-- Based on existing sellf_setup.sql and user_product_access_setup.sql

-- Suppress NOTICE messages during migration (e.g., "relation already exists, skipping")
SET client_min_messages = warning;

BEGIN;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create seller_main schema for shop/seller data (marketplace: schema-per-tenant)
-- seller_main is the owner's (platform operator's) seller schema
-- New sellers get a copy of this schema during provisioning
CREATE SCHEMA IF NOT EXISTS seller_main;

-- Create products table (seller schema — shop data)
CREATE TABLE IF NOT EXISTS seller_main.products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) <= 255), -- Product name limited to 255 characters
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-zA-Z0-9_-]+$' AND length(slug) BETWEEN 1 AND 100), -- URL-safe slug: alphanumeric, hyphens, underscores only
  description TEXT CHECK (length(description) <= 2000), -- Product description limited to 2000 characters (short description for listings)
  long_description TEXT, -- Detailed product description for checkout page (unlimited length)
  icon TEXT CHECK (length(icon) <= 500), -- Icon URL/path limited to 500 characters

  -- Product images for enhanced checkout experience
  image_url TEXT, -- Main product image URL (stored in Supabase Storage or external CDN)
  thumbnail_url TEXT, -- Smaller thumbnail for listings/previews

  price NUMERIC DEFAULT 0 NOT NULL CHECK (price >= 0), -- Price must be non-negative
  currency TEXT DEFAULT 'USD' NOT NULL CHECK (
    length(currency) = 3 AND
    upper(currency) ~ '^[A-Z]{3}$' AND
    upper(currency) IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RUB', 'TRY', 'BRL', 'MXN', 'INR', 'KRW', 'SGD', 'HKD', 'NZD', 'ZAR', 'ILS', 'THB', 'MYR', 'PHP', 'IDR', 'VND')
  ), -- Enhanced ISO 4217 currency codes validation

  -- VAT/Tax configuration
  vat_rate DECIMAL(5,2) DEFAULT NULL, -- VAT rate percentage (e.g., 23.00 for 23%); NULL = use shop_config.tax_rate
  price_includes_vat BOOLEAN DEFAULT true NOT NULL, -- Whether price already includes VAT

  -- Structured features for better product presentation
  features JSONB DEFAULT '[]'::jsonb, -- Array of feature sections with titles and items
  -- Example: [{"title": "What you'll get", "items": ["Feature 1", "Feature 2"]}]

  layout_template TEXT DEFAULT 'default' NOT NULL CHECK (length(layout_template) <= 100), -- Layout template name

  is_active BOOLEAN NOT NULL DEFAULT true, -- Product availability toggle
  is_featured BOOLEAN NOT NULL DEFAULT false, -- Featured product flag
  is_listed BOOLEAN NOT NULL DEFAULT true, -- Visible on store page (false = purchasable via direct link only)
  -- Temporal availability fields
  available_from TIMESTAMPTZ, -- Product becomes available from this date/time
  available_until TIMESTAMPTZ, -- Product is available until this date/time
  -- Auto-grant access duration for users
  auto_grant_duration_days INTEGER CHECK (auto_grant_duration_days > 0 AND auto_grant_duration_days <= 3650), -- Access duration: 1 day to 10 years
  -- Content delivery fields (clean implementation)
  content_delivery_type TEXT DEFAULT 'content' NOT NULL CHECK (content_delivery_type IN ('redirect', 'content')),
  content_config JSONB DEFAULT '{}' NOT NULL, -- Flexible content configuration

  -- Funnel / OTO settings
  success_redirect_url TEXT, -- URL to redirect after successful purchase/signup
  pass_params_to_redirect BOOLEAN DEFAULT false NOT NULL, -- Whether to pass email and other params to the redirect URL

  -- Refund settings
  is_refundable BOOLEAN DEFAULT false NOT NULL, -- Whether customers can request refunds for this product
  refund_period_days INTEGER CHECK (refund_period_days IS NULL OR (refund_period_days > 0 AND refund_period_days <= 365)), -- Number of days from purchase within which refund can be requested

  -- Waitlist settings (for inactive products)
  enable_waitlist BOOLEAN DEFAULT false NOT NULL, -- Show waitlist signup form when product is inactive

  -- Pay What You Want / Custom Pricing
  allow_custom_price BOOLEAN DEFAULT false NOT NULL, -- Enable customer-chosen pricing
  custom_price_min NUMERIC(10,2) DEFAULT 5.00 CHECK (custom_price_min >= 0.50), -- Minimum price (Stripe requires 0.50)
  show_price_presets BOOLEAN DEFAULT true NOT NULL, -- Show preset amount buttons
  custom_price_presets JSONB DEFAULT '[5, 10, 25]'::jsonb, -- Array of suggested amounts

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Ensure temporal availability makes sense
  CONSTRAINT check_availability_dates CHECK (available_from IS NULL OR available_until IS NULL OR available_from < available_until) -- Available from must be before available until
);

COMMENT ON TABLE seller_main.products IS 'Products catalog with sellf integration support';
COMMENT ON COLUMN seller_main.products.slug IS 'URL-safe unique identifier for sellf system';
COMMENT ON COLUMN seller_main.products.content_config IS 'JSON configuration for content delivery and sellf integration';

-- Create variant_groups table to store variant group metadata (seller schema)
CREATE TABLE IF NOT EXISTS seller_main.variant_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT CHECK (length(name) <= 200), -- Optional display name for the group (e.g., "Subscription Plans", "Size Options")
  slug TEXT UNIQUE CHECK (slug IS NULL OR (slug ~ '^[a-z0-9_-]+$' AND length(slug) BETWEEN 1 AND 100)), -- URL-friendly identifier
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE seller_main.variant_groups IS 'Variant groups for organizing products as selectable options';
COMMENT ON COLUMN seller_main.variant_groups.name IS 'Optional human-readable name for the variant group';
COMMENT ON COLUMN seller_main.variant_groups.slug IS 'URL-friendly identifier for the variant group (alternative to UUID)';

-- Create junction table for Product <-> Variant Group (Many-to-Many) (seller schema)
-- A product can belong to multiple variant groups
CREATE TABLE IF NOT EXISTS seller_main.product_variant_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  group_id UUID REFERENCES seller_main.variant_groups(id) ON DELETE CASCADE NOT NULL,
  variant_name VARCHAR(100), -- Display name in selector (e.g., "1 Year", "Lifetime", "Small", "Large")
  display_order INTEGER DEFAULT 0 NOT NULL, -- Order in variant selector (lower = first)
  is_featured BOOLEAN DEFAULT false NOT NULL, -- Featured/highlighted product in this group
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (product_id, group_id) -- A product can only be in a group once
);

COMMENT ON TABLE seller_main.product_variant_groups IS 'Junction table linking products to variant groups with display metadata';
COMMENT ON COLUMN seller_main.product_variant_groups.variant_name IS 'Display name for this product in the variant selector';
COMMENT ON COLUMN seller_main.product_variant_groups.display_order IS 'Order in variant selector (lower numbers appear first)';
COMMENT ON COLUMN seller_main.product_variant_groups.is_featured IS 'Whether this product is the featured/highlighted option in the group';

-- Create categories table for product organization (seller schema)
CREATE TABLE IF NOT EXISTS seller_main.categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) <= 100),
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-zA-Z0-9_-]+$' AND length(slug) BETWEEN 1 AND 100),
  description TEXT CHECK (length(description) <= 500),
  parent_id UUID REFERENCES seller_main.categories(id) ON DELETE SET NULL, -- Hierarchy support
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create junction table for Product <-> Category (Many-to-Many) (seller schema)
CREATE TABLE IF NOT EXISTS seller_main.product_categories (
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  category_id UUID REFERENCES seller_main.categories(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (product_id, category_id)
);

-- Create tags table for flexible product filtering (seller schema)
CREATE TABLE IF NOT EXISTS seller_main.tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) <= 50),
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-zA-Z0-9_-]+$' AND length(slug) BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create junction table for Product <-> Tag (Many-to-Many) (seller schema)
CREATE TABLE IF NOT EXISTS seller_main.product_tags (
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  tag_id UUID REFERENCES seller_main.tags(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (product_id, tag_id)
);

-- Create user_product_access table with product_id reference for better data integrity (seller schema)
CREATE TABLE IF NOT EXISTS seller_main.user_product_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL, -- Improved data integrity
  -- Temporal access fields
  access_granted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  access_expires_at TIMESTAMPTZ, -- NULL means permanent access
  access_duration_days INTEGER CHECK (access_duration_days IS NULL OR (access_duration_days > 0 AND access_duration_days <= 3650)), -- For tracking access duration in days
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  UNIQUE (user_id, product_id), -- Ensure a user can only have one access entry per product
  
  -- Ensure temporal access makes sense
  CONSTRAINT check_access_expiration CHECK (access_expires_at IS NULL OR access_expires_at > access_granted_at)
);

-- Create a view for user access statistics (seller schema)
CREATE OR REPLACE VIEW seller_main.user_access_stats WITH (security_invoker = on) AS
SELECT 
    u.id as user_id,
    u.email,
    u.created_at as user_created_at,
    u.email_confirmed_at,
    u.last_sign_in_at,
    u.raw_user_meta_data,
    COUNT(upa.id) as total_products,
    COALESCE(SUM(p.price), 0) as total_value,
    MAX(upa.created_at) as last_access_granted_at,
    MIN(upa.created_at) as first_access_granted_at
FROM auth.users u
LEFT JOIN seller_main.user_product_access upa ON u.id = upa.user_id
LEFT JOIN seller_main.products p ON upa.product_id = p.id
GROUP BY u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at, u.raw_user_meta_data;

-- Create a more detailed user product access view for admin panels (seller schema)
CREATE OR REPLACE VIEW seller_main.user_product_access_detailed WITH (security_invoker = on) AS
SELECT 
    upa.id,
    upa.user_id,
    upa.product_id,
    p.slug as product_slug,
    p.name as product_name,
    p.description as product_description,
    p.price as product_price,
    p.currency as product_currency,
    p.icon as product_icon,
    p.is_active as product_is_active,
    upa.access_granted_at,
    upa.access_expires_at,
    upa.access_duration_days,
    upa.created_at as access_created_at,
    p.created_at as product_created_at,
    p.updated_at as product_updated_at
FROM seller_main.user_product_access upa
JOIN seller_main.products p ON upa.product_id = p.id;

-- Create rate limiting function to prevent abuse
-- CRITICAL SECURITY: Multi-layer protection against spoofing and bypass attempts
CREATE OR REPLACE FUNCTION check_rate_limit(
    function_name_param TEXT,
    max_calls INTEGER DEFAULT 100,
    time_window_seconds INTEGER DEFAULT 3600
) RETURNS BOOLEAN AS $$
DECLARE
    current_user_id UUID;
    window_start_param TIMESTAMPTZ;
    current_count INTEGER;
    client_ip TEXT;
    rate_limit_key TEXT;
    backup_rate_limit_key TEXT;
    backup_count INTEGER;
BEGIN
    -- Input validation
    IF function_name_param IS NULL OR length(function_name_param) = 0 OR length(function_name_param) > 100 THEN
        RETURN FALSE;
    END IF;
    
    -- Get current user ID
    current_user_id := auth.uid();
    
    -- Calculate window start (round down to nearest window) - moved here to avoid conflicts
    window_start_param := date_trunc('hour', NOW()) + 
                   INTERVAL '1 second' * (FLOOR(EXTRACT(EPOCH FROM NOW() - date_trunc('hour', NOW())) / time_window_seconds) * time_window_seconds);
    
    -- For anonymous users, use SECURE rate limiting to prevent bypass attacks (CRITICAL SECURITY FIX)
    IF current_user_id IS NULL THEN
        -- SECURITY: Never trust client headers - they can be easily spoofed!
        -- Use only server-side reliable sources for rate limiting
        client_ip := COALESCE(
            -- Only use inet_client_addr() which comes from actual TCP connection
            inet_client_addr()::text,
            -- Fallback to connection-based identifier that can't be spoofed
            'conn_' || pg_backend_pid()::text || '_' || extract(epoch from NOW())::bigint::text
        );
        
        -- Enhanced protection: Multiple layers of rate limiting for anonymous users
        -- Layer 1: Connection-based (primary)
        rate_limit_key := 'anon_conn_' || 
                         regexp_replace(client_ip, '[^0-9.]', '', 'g') || '_' || 
                         function_name_param;
        
        -- Layer 2: Add session entropy to prevent easy bypass
        -- Use JWT sub claim if available (can't be spoofed easily)
        IF current_setting('request.jwt.claims', true) != '' THEN
            rate_limit_key := rate_limit_key || '_' || 
                             COALESCE(
                                 current_setting('request.jwt.claims', true)::jsonb->>'sub',
                                 current_setting('request.jwt.claims', true)::jsonb->>'aud',
                                 'no_jwt'
                             );
        ELSE
            -- No JWT available - use time-based bucket to prevent complete bypass
            rate_limit_key := rate_limit_key || '_bucket_' || 
                             FLOOR(extract(epoch from NOW()) / 300)::text; -- 5-minute buckets
        END IF;
        
        -- Create deterministic UUID from rate_limit_key using MD5 hash
        current_user_id := (md5(rate_limit_key)::uuid);
        
        -- BACKUP RATE LIMITING: Global anonymous protection (CRITICAL)
        -- This prevents mass attacks even if primary rate limiting is bypassed
        backup_rate_limit_key := 'global_anon_' || function_name_param;
        
        -- Check global anonymous rate limit (stricter limits)
        INSERT INTO public.rate_limits (user_id, function_name, window_start, call_count)
        VALUES (
            (md5(backup_rate_limit_key)::uuid), -- Deterministic UUID from backup key
            'global_' || function_name_param, 
            window_start_param, -- Use the calculated window_start_param variable
            1
        )
        ON CONFLICT (user_id, function_name, window_start)
        DO UPDATE SET 
            call_count = rate_limits.call_count + 1,
            updated_at = NOW()
        RETURNING rate_limits.call_count INTO backup_count;
        IF backup_count > GREATEST(10, max_calls * 2) THEN -- Global limit is 200% of individual limit, minimum 10
            RETURN FALSE;
        END IF;
    END IF;
    
    -- Try to increment existing record or insert new one
    INSERT INTO public.rate_limits (user_id, function_name, window_start, call_count)
    VALUES (current_user_id, function_name_param, window_start_param, 1)
    ON CONFLICT (user_id, function_name, window_start)
    DO UPDATE SET 
        call_count = rate_limits.call_count + 1,
        updated_at = NOW()
    RETURNING rate_limits.call_count INTO current_count;
    
    -- Check if we're over the limit
    RETURN current_count <= max_calls;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

COMMENT ON FUNCTION check_rate_limit IS 'SECURE rate limiting function with anti-spoofing protection. CRITICAL: Never trust client headers like x-forwarded-for as they can be easily spoofed by attackers to bypass rate limits. Uses only server-side reliable sources.';

-- Create application_rate_limits table for Next.js API routes
-- Separate from internal rate_limits table used by RPC functions
CREATE TABLE IF NOT EXISTS application_rate_limits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  identifier TEXT NOT NULL, -- format: "user:UUID" or "ip:xxx.xxx.xxx.xxx"
  action_type TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (identifier, action_type, window_start)
);

-- Enable RLS - only service_role should access this table (via API routes)
ALTER TABLE application_rate_limits ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by Next.js API routes)
CREATE POLICY "Service role has full access to rate limits"
  ON application_rate_limits
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

CREATE INDEX IF NOT EXISTS idx_application_rate_limits_lookup
  ON application_rate_limits(identifier, action_type, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_application_rate_limits_window_start
  ON application_rate_limits(window_start);

COMMENT ON TABLE application_rate_limits IS
  'Rate limiting for application-level API routes (Next.js) - separate from internal RPC rate limiting';

-- Create application-level check_rate_limit function
-- This function has a DIFFERENT signature than the internal check_rate_limit(function_name_param, max_calls, time_window_seconds)
-- Used by Next.js API routes via /lib/rate-limiting.ts
CREATE OR REPLACE FUNCTION check_application_rate_limit(
  identifier_param TEXT,
  action_type_param TEXT,
  max_requests INTEGER,
  window_minutes INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  window_start_param TIMESTAMPTZ;
  current_count INTEGER;
BEGIN
  -- Input validation
  IF identifier_param IS NULL OR length(identifier_param) = 0 OR length(identifier_param) > 200 THEN
    RETURN FALSE;
  END IF;

  IF action_type_param IS NULL OR length(action_type_param) = 0 OR length(action_type_param) > 100 THEN
    RETURN FALSE;
  END IF;

  -- Calculate window start (round down to window boundary)
  window_start_param := date_trunc('hour', NOW()) +
                       INTERVAL '1 minute' * (FLOOR(EXTRACT(EPOCH FROM (NOW() - date_trunc('hour', NOW()))) / 60 / window_minutes) * window_minutes);

  -- Try to increment existing record or insert new one
  INSERT INTO public.application_rate_limits (identifier, action_type, window_start, call_count)
  VALUES (identifier_param, action_type_param, window_start_param, 1)
  ON CONFLICT (identifier, action_type, window_start)
  DO UPDATE SET
    call_count = public.application_rate_limits.call_count + 1,
    updated_at = NOW()
  RETURNING public.application_rate_limits.call_count INTO current_count;

  -- Check if we're over the limit
  RETURN current_count <= max_requests;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION check_application_rate_limit IS
  'Application-level rate limiting for Next.js API routes. Use this from /lib/rate-limiting.ts';

-- Create cleanup function for application rate limits
CREATE OR REPLACE FUNCTION cleanup_application_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete entries older than 24 hours
  DELETE FROM public.application_rate_limits
  WHERE window_start < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION cleanup_application_rate_limits IS
  'Cleanup old application rate limit entries (run via cron job)';

-- Create cleanup function for rate limits
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete rate limit records older than 24 hours
    DELETE FROM public.rate_limits
    WHERE window_start < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION cleanup_rate_limits IS 'Cleanup old rate limit records. Should be called periodically (e.g., daily cron job).';

-- Create function to cleanup old audit logs (optional - for data retention)
CREATE OR REPLACE FUNCTION cleanup_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Input validation
    IF retention_days < 1 OR retention_days > 3650 THEN
        RAISE EXCEPTION 'Retention days must be between 1 and 3650';
    END IF;
    
    -- Delete audit log records older than retention period
    DELETE FROM public.audit_log
    WHERE performed_at < NOW() - INTERVAL '1 day' * retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION cleanup_audit_logs IS 'Cleanup old audit log records based on retention policy. Default is 90 days.';

-- Create function to view cron job status
CREATE OR REPLACE FUNCTION get_cleanup_job_status()
RETURNS TABLE(
    jobname TEXT,
    schedule TEXT,
    command TEXT,
    active BOOLEAN,
    last_run TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cron.jobname,
        cron.schedule,
        cron.command,
        cron.active,
        cron.last_run_started_at as last_run
    FROM cron.job cron
    WHERE cron.jobname LIKE '%cleanup%'
    ORDER BY cron.jobname;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION get_cleanup_job_status IS 'Get status of cleanup cron jobs for monitoring purposes';

-- Enable pg_cron extension for scheduled cleanup
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule automatic cleanup of rate limits every hour
-- This runs at the start of every hour to remove old rate limit records
SELECT cron.schedule(
    'cleanup-rate-limits', 
    '0 * * * *',  -- Every hour at minute 0
    'SELECT cleanup_rate_limits();'
);

-- Optional: Schedule weekly audit log cleanup (commented out by default)
-- Uncomment and adjust retention period as needed for your use case
-- SELECT cron.schedule(
--     'cleanup-audit-logs', 
--     '0 2 * * 0',  -- Every Sunday at 2 AM
--     'SELECT cleanup_audit_logs(90);'  -- Keep 90 days of audit logs
-- );

COMMENT ON EXTENSION pg_cron IS 'Used for automated cleanup of rate limiting data and optional audit log retention';

-- Create secure function to check user access for a single product (seller schema)
-- Uses auth.uid() to get the current authenticated user (SECURITY FIX)
CREATE OR REPLACE FUNCTION seller_main.check_user_product_access(
    product_slug_param TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    clean_slug TEXT;
BEGIN
    -- Rate limiting: 1000 calls per hour per user (increased for checkout)
    IF NOT public.check_rate_limit('check_user_product_access'::TEXT, 1000, 3600) THEN
        RAISE EXCEPTION 'Rate limit exceeded for check_user_product_access';
    END IF;

    -- Input validation and sanitization
    IF product_slug_param IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Sanitize slug: only allow alphanumeric, hyphens, and underscores
    clean_slug := regexp_replace(product_slug_param, '[^a-zA-Z0-9_-]', '', 'g');
    
    -- Validate sanitized slug
    IF clean_slug IS NULL OR length(clean_slug) = 0 OR length(clean_slug) > 100 THEN
        RETURN FALSE;
    END IF;
    
    -- Get current authenticated user ID
    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- NOTE: is_active controls product visibility for NEW purchases only
    -- Users who already have access keep it regardless of is_active status
    -- Access is revoked only when: product is deleted OR access_expires_at passes
    RETURN EXISTS (
        SELECT 1
        FROM seller_main.user_product_access upa
        JOIN seller_main.products p ON upa.product_id = p.id
        WHERE upa.user_id = auth.uid()  -- Use authenticated user ID
          AND p.slug = clean_slug       -- Use sanitized slug
          -- Check temporal access for user (only condition that revokes access)
          AND (upa.access_expires_at IS NULL OR upa.access_expires_at >= NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

COMMENT ON FUNCTION seller_main.check_user_product_access IS 'Check if authenticated user has access to a specific product by slug. Includes rate limiting and input sanitization.';

-- Create secure function to batch check user access for multiple products (seller schema)
-- Uses auth.uid() to get the current authenticated user (SECURITY FIX)
CREATE OR REPLACE FUNCTION seller_main.batch_check_user_product_access(
    product_slugs_param TEXT[]
) RETURNS JSONB AS $$
DECLARE
    result JSONB := '{}';
    slug TEXT;
    has_access BOOLEAN;
    current_user_id UUID;
    clean_slug TEXT;
    safe_key TEXT;
BEGIN
    -- Rate limiting: 200 calls per hour per user (increased for checkout)
    IF NOT public.check_rate_limit('batch_check_user_product_access'::TEXT, 200, 3600) THEN
        RAISE EXCEPTION 'Rate limit exceeded for batch_check_user_product_access';
    END IF;

    -- Input validation
    IF product_slugs_param IS NULL OR array_length(product_slugs_param, 1) IS NULL THEN
        RETURN result;
    END IF;
    
    -- Limit array size to prevent DoS attacks (reduced from 50 to 20)
    IF array_length(product_slugs_param, 1) > 20 THEN
        RAISE EXCEPTION 'Too many product slugs requested (maximum 20)';
    END IF;
    
    -- Get current authenticated user ID
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN result;
    END IF;
    
    -- Check access for each product slug with proper sanitization
    FOREACH slug IN ARRAY product_slugs_param
    LOOP
        -- Validate input length first
        IF slug IS NULL OR length(slug) = 0 OR length(slug) > 100 THEN
            CONTINUE; -- Skip invalid slugs completely
        END IF;
        
        -- Sanitize slug: only allow alphanumeric, hyphens, and underscores
        clean_slug := regexp_replace(slug, '[^a-zA-Z0-9_-]', '', 'g');
        
        -- Skip empty or invalid slugs after sanitization
        IF clean_slug IS NULL OR length(clean_slug) = 0 THEN
            CONTINUE;
        END IF;
        
        -- Create safe JSON key (use clean_slug for both query and key)
        safe_key := clean_slug;
        
        -- Use parameterized query to prevent SQL injection
        -- NOTE: is_active controls product visibility for NEW purchases only
        -- Users who already have access keep it regardless of is_active status
        SELECT EXISTS (
            SELECT 1
            FROM seller_main.user_product_access upa
            JOIN seller_main.products p ON upa.product_id = p.id
            WHERE upa.user_id = current_user_id
              AND p.slug = clean_slug
              -- Check temporal access for user (only condition that revokes access)
              AND (upa.access_expires_at IS NULL OR upa.access_expires_at >= NOW())
        ) INTO has_access;
        
        -- Use sanitized key for JSON to prevent injection
        result := result || jsonb_build_object(safe_key, has_access);
    END LOOP;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s'; -- Reduced timeout to prevent DoS

COMMENT ON FUNCTION seller_main.batch_check_user_product_access IS 'Batch check user access for multiple products. Limited to 20 products per call with rate limiting.';

-- Create secure function to grant product access (seller schema)
-- Uses auth.uid() to get the current authenticated user (SECURITY FIX)
CREATE OR REPLACE FUNCTION seller_main.grant_free_product_access(
    product_slug_param TEXT,
    access_duration_days_param INTEGER DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    product_record RECORD;
    current_user_id UUID;
    access_expires_at TIMESTAMPTZ;
    clean_slug TEXT;
BEGIN
    -- Input validation and sanitization
    IF product_slug_param IS NULL OR length(product_slug_param) = 0 OR length(product_slug_param) > 100 THEN
        RETURN FALSE;
    END IF;
    
    -- Validate access duration
    IF access_duration_days_param IS NOT NULL AND (access_duration_days_param < 0 OR access_duration_days_param > 3650) THEN
        RETURN FALSE; -- Max 10 years
    END IF;
    
    -- Sanitize slug
    clean_slug := regexp_replace(product_slug_param, '[^a-zA-Z0-9_-]', '', 'g');
    IF clean_slug IS NULL OR length(clean_slug) = 0 THEN
        RETURN FALSE;
    END IF;
    
    -- Get current authenticated user ID
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Get product by slug (use sanitized slug)
    SELECT id, auto_grant_duration_days INTO product_record
    FROM seller_main.products 
    WHERE slug = clean_slug AND is_active = true AND price = 0; -- Only allow free products
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Calculate access expiration
    IF access_duration_days_param IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * access_duration_days_param;
    ELSIF product_record.auto_grant_duration_days IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * product_record.auto_grant_duration_days;
    ELSE
        access_expires_at := NULL; -- Permanent access
    END IF;
    
    -- Insert or update user access
    INSERT INTO seller_main.user_product_access (user_id, product_id, access_expires_at, access_duration_days)
    VALUES (current_user_id, product_record.id, access_expires_at, COALESCE(access_duration_days_param, product_record.auto_grant_duration_days))
    ON CONFLICT (user_id, product_id) 
    DO UPDATE SET 
        access_expires_at = EXCLUDED.access_expires_at,
        access_duration_days = EXCLUDED.access_duration_days,
        access_granted_at = NOW();
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

COMMENT ON FUNCTION seller_main.grant_free_product_access IS 'Grant access to free products for authenticated users. Includes input validation and sanitization.';

-- Create function to get complete user profile with statistics (seller schema)
CREATE OR REPLACE FUNCTION seller_main.get_user_profile(user_id_param UUID)
RETURNS JSONB AS $$
DECLARE
    user_info JSONB;
    user_stats JSONB;
    user_access JSONB;
    current_user_id UUID;
BEGIN
    -- Input validation
    IF user_id_param IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Get current authenticated user
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Security check: only allow users to view their own profile or admins to view any profile
    IF user_id_param != current_user_id THEN
        IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = current_user_id) THEN -- admin_users is in public (platform)
            RAISE EXCEPTION 'Unauthorized: Can only view your own profile';
        END IF;
    END IF;
    
    -- Get user info from auth.users
    SELECT jsonb_build_object(
        'id', id,
        'email', email,
        'created_at', created_at,
        'email_confirmed_at', email_confirmed_at,
        'last_sign_in_at', last_sign_in_at,
        'user_metadata', raw_user_meta_data
    ) INTO user_info
    FROM auth.users
    WHERE id = user_id_param;
    
    -- Return null if user not found
    IF user_info IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Get user statistics
    SELECT jsonb_build_object(
        'total_products', total_products,
        'total_value', total_value,
        'last_access_granted_at', last_access_granted_at,
        'first_access_granted_at', first_access_granted_at
    ) INTO user_stats
    FROM seller_main.user_access_stats
    WHERE user_id = user_id_param;
    
    -- Get user access details
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', id,
            'product_id', product_id,
            'product_name', product_name,
            'product_slug', product_slug,
            'product_price', product_price,
            'product_currency', product_currency,
            'product_icon', product_icon,
            'product_is_active', product_is_active,
            'granted_at', access_created_at
        )
    ) INTO user_access
    FROM seller_main.user_product_access_detailed
    WHERE user_id = user_id_param;
    
    -- Return the combined user profile
    RETURN jsonb_build_object(
        'user', user_info,
        'stats', user_stats,
        'access', COALESCE(user_access, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s';

COMMENT ON FUNCTION seller_main.get_user_profile IS 'Get complete user profile with access statistics. Users can only view their own profile, admins can view any profile.';

-- Create admin_users table to track who is an admin
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create audit table for security monitoring
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values JSONB,
  new_values JSONB,
  user_id UUID REFERENCES auth.users(id),
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  ip_address INET,
  user_agent TEXT
);

-- Create rate limiting table for persistent rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id UUID NOT NULL,
  function_name TEXT NOT NULL CHECK (length(function_name) <= 100),
  window_start TIMESTAMPTZ NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 1 CHECK (call_count > 0),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, function_name, window_start)
);

-- Create indexes for better performance (seller schema tables)
CREATE INDEX IF NOT EXISTS idx_products_slug ON seller_main.products(slug);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON seller_main.products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON seller_main.products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_is_listed ON seller_main.products(is_listed);
CREATE INDEX IF NOT EXISTS idx_products_price ON seller_main.products(price);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON seller_main.products(created_at);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON seller_main.categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON seller_main.categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_product_id ON seller_main.product_categories(product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category_id ON seller_main.product_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_tags_slug ON seller_main.tags(slug);
CREATE INDEX IF NOT EXISTS idx_product_tags_product_id ON seller_main.product_tags(product_id);
CREATE INDEX IF NOT EXISTS idx_product_tags_tag_id ON seller_main.product_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_user_product_access_user_id ON seller_main.user_product_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_product_access_product_id ON seller_main.user_product_access(product_id);
CREATE INDEX IF NOT EXISTS idx_user_product_access_unique ON seller_main.user_product_access(user_id, product_id);
-- Platform table indexes (public)
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);

-- Variant groups indexes (M:N relationship, seller schema)
CREATE INDEX IF NOT EXISTS idx_product_variant_groups_product_id ON seller_main.product_variant_groups(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variant_groups_group_id ON seller_main.product_variant_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_product_variant_groups_display_order ON seller_main.product_variant_groups(group_id, display_order);
CREATE INDEX IF NOT EXISTS idx_product_variant_groups_featured ON seller_main.product_variant_groups(group_id, is_featured) WHERE is_featured = true;

-- Optimization indexes for user access (seller schema)
CREATE INDEX IF NOT EXISTS idx_user_product_access_expires_at ON seller_main.user_product_access(access_expires_at) WHERE access_expires_at IS NOT NULL;

-- Rate limiting indexes
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_function ON rate_limits(user_id, function_name);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON audit_log(performed_at DESC);


-- =============================================================================
-- ADMIN CHECK FUNCTIONS (must be defined before RLS policies that reference them)
-- =============================================================================

-- Check if user is admin (optimized)
CREATE OR REPLACE FUNCTION is_admin(user_id_param UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    current_user_id UUID;
    target_user_id UUID;
BEGIN
    -- Get current authenticated user (cache result)
    current_user_id := (SELECT auth.uid());
    
    -- Early return if no authenticated user
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Use provided user_id or current authenticated user
    target_user_id := COALESCE(user_id_param, current_user_id);
    
    -- Security: Only allow users to check their own admin status
    -- Early return if trying to check another user's status
    IF user_id_param IS NOT NULL AND user_id_param != current_user_id THEN
        RETURN FALSE;
    END IF;
    
    -- Direct EXISTS check with index usage
    RETURN EXISTS (
        SELECT 1 FROM public.admin_users 
        WHERE user_id = target_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Create cached version for better performance when called repeatedly
CREATE OR REPLACE FUNCTION is_admin_cached()
RETURNS BOOLEAN AS $$
DECLARE
    current_user_id UUID;
    user_is_admin BOOLEAN;
    cache_key TEXT;
BEGIN
    -- Get current authenticated user
    current_user_id := (SELECT auth.uid());
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Create session-specific cache key
    cache_key := 'app.user_is_admin_' || replace(current_user_id::TEXT, '-', '_');
    
    -- Try to get from session cache first
    BEGIN
        user_is_admin := current_setting(cache_key, true)::boolean;
        IF user_is_admin IS NOT NULL THEN
            RETURN user_is_admin;
        END IF;
    EXCEPTION 
        WHEN OTHERS THEN
            -- Cache miss, continue to DB lookup
            NULL;
    END;
    
    -- Check admin status from database
    SELECT EXISTS(
        SELECT 1 FROM public.admin_users 
        WHERE user_id = current_user_id
    ) INTO user_is_admin;
    
    -- Set session cache (expires with session)
    PERFORM set_config(cache_key, user_is_admin::TEXT, false);
    
    RETURN user_is_admin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Enable Row Level Security (seller schema tables)
ALTER TABLE seller_main.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.product_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.product_variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.user_product_access ENABLE ROW LEVEL SECURITY;
-- Platform tables (public)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for products table (seller schema)
CREATE POLICY "SELECT policy for products" ON seller_main.products
  FOR SELECT
  USING (
    -- Admin users see everything
    ( select public.is_admin() ) OR
    -- Public users see active products
    is_active = true OR
    -- Public users see inactive products with waitlist enabled (for waitlist form)
    (is_active = false AND enable_waitlist = true)
  );

-- Polityki dla adminów - osobno dla każdej akcji
CREATE POLICY "Allow admin users to insert products" ON seller_main.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ( select public.is_admin() )
  );

CREATE POLICY "Allow admin users to update products" ON seller_main.products
  FOR UPDATE
  TO authenticated
  USING (
    ( select public.is_admin() )
  )
  WITH CHECK (
    ( select public.is_admin() )
  );

CREATE POLICY "Allow admin users to delete products" ON seller_main.products
  FOR DELETE
  TO authenticated
  USING (
    ( select public.is_admin() )
  );

-- RLS Policies for categories (seller schema)
CREATE POLICY "Public read access for categories" ON seller_main.categories
  FOR SELECT USING (true);

CREATE POLICY "Admins full access for categories" ON seller_main.categories
  FOR ALL
  USING (( select public.is_admin() ))
  WITH CHECK (( select public.is_admin() ));

-- RLS Policies for product_categories (seller schema)
CREATE POLICY "Public read access for product_categories" ON seller_main.product_categories
  FOR SELECT USING (true);

CREATE POLICY "Admins full access for product_categories" ON seller_main.product_categories
  FOR ALL
  USING (( select public.is_admin() ))
  WITH CHECK (( select public.is_admin() ));

-- RLS Policies for tags (seller schema)
CREATE POLICY "Public read access for tags" ON seller_main.tags
  FOR SELECT USING (true);

CREATE POLICY "Admins full access for tags" ON seller_main.tags
  FOR ALL
  USING (( select public.is_admin() ))
  WITH CHECK (( select public.is_admin() ));

-- RLS Policies for product_tags (seller schema)
CREATE POLICY "Public read access for product_tags" ON seller_main.product_tags
  FOR SELECT USING (true);

CREATE POLICY "Admins full access for product_tags" ON seller_main.product_tags
  FOR ALL
  USING (( select public.is_admin() ))
  WITH CHECK (( select public.is_admin() ));

-- RLS Policies for variant_groups (seller schema)
CREATE POLICY "Public read access for variant_groups" ON seller_main.variant_groups
  FOR SELECT USING (true);

CREATE POLICY "Admins full access for variant_groups" ON seller_main.variant_groups
  FOR ALL
  USING (( select public.is_admin() ))
  WITH CHECK (( select public.is_admin() ));

-- RLS Policies for product_variant_groups (seller schema)
CREATE POLICY "Public read access for product_variant_groups" ON seller_main.product_variant_groups
  FOR SELECT USING (true);

CREATE POLICY "Admins full access for product_variant_groups" ON seller_main.product_variant_groups
  FOR ALL
  USING (( select public.is_admin() ))
  WITH CHECK (( select public.is_admin() ));


-- RLS Policies for user_product_access table (seller schema)
-- Allow users to read their own access records
CREATE POLICY "Allow users to read their own product access" ON seller_main.user_product_access
  FOR SELECT
  USING (
    (SELECT auth.uid()) = user_id OR
    ( select public.is_admin() )
  );

-- Allow service role to insert access records
CREATE POLICY "Allow service role to insert product access" ON seller_main.user_product_access
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Combined INSERT policy for authenticated users
CREATE POLICY "Combined INSERT policy for user_product_access" ON seller_main.user_product_access
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Admin users can insert anything
    ( select public.is_admin() ) OR
    -- Regular users can insert access for FREE products for themselves
    ((SELECT auth.uid()) = user_id AND
     EXISTS (SELECT 1 FROM seller_main.products WHERE id = product_id AND price = 0))
  );

-- Admin UPDATE policy
CREATE POLICY "Allow admin users to update access" ON seller_main.user_product_access
  FOR UPDATE
  TO authenticated
  USING (
    ( select public.is_admin() )
  )
  WITH CHECK (
    ( select public.is_admin() )
  );

-- Admin DELETE policy
CREATE POLICY "Allow admin users to delete access" ON seller_main.user_product_access
  FOR DELETE
  TO authenticated
  USING (
    ( select public.is_admin() )
  );


-- RLS Policies for admin_users table
-- Allow users to check only their own admin status
CREATE POLICY "Allow users to read their own admin status" ON admin_users
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- RLS Policies for audit_log table
-- Only allow admin users to read audit logs
CREATE POLICY "Allow admin users to read audit logs" ON audit_log
  FOR SELECT
  TO authenticated
  USING (
    ( select public.is_admin() )
  );

-- Allow system to insert audit logs (for triggers and functions)
-- SECURITY FIX (V-CRITICAL-09): Restricted to service_role only to prevent audit log forgery
-- The log_audit_entry() function uses SECURITY DEFINER which bypasses RLS,
-- so legitimate audit logging from triggers and functions still works.
CREATE POLICY "Allow system to insert audit logs" ON audit_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Combined SELECT policy for rate limits
CREATE POLICY "Combined SELECT policy for rate limits" ON rate_limits
    FOR SELECT 
    USING (
        -- Admins can view all rate limits
        ( select public.is_admin() ) OR
        -- Users can read their own rate limits
        (SELECT auth.uid()) = user_id
    );

-- System policies for modifications
CREATE POLICY "Allow system to insert rate limits" ON rate_limits
    FOR INSERT 
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow system to update rate limits" ON rate_limits
    FOR UPDATE 
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow system to delete rate limits" ON rate_limits
    FOR DELETE 
    TO service_role
    USING (true);


-- Create function to clear admin cache (useful for logout)
CREATE OR REPLACE FUNCTION clear_admin_cache()
RETURNS VOID AS $$
DECLARE
    current_user_id UUID;
    cache_key TEXT;
BEGIN
    -- Get current authenticated user
    current_user_id := (SELECT auth.uid());
    IF current_user_id IS NOT NULL THEN
        -- Clear the session-specific cache
        cache_key := 'app.user_is_admin_' || replace(current_user_id::TEXT, '-', '_');
        PERFORM set_config(cache_key, NULL, false);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Create function to handle all new user registration logic
CREATE OR REPLACE FUNCTION handle_new_user_registration()
RETURNS TRIGGER
SET search_path = public, auth
AS $$
DECLARE
  claim_result JSON;
  admin_count INTEGER;
  lock_acquired BOOLEAN;
BEGIN
  -- Use advisory lock with timeout to prevent race condition
  SELECT pg_try_advisory_lock(hashtext('handle_new_user_registration')) INTO lock_acquired;
  
  IF NOT lock_acquired THEN
    RAISE EXCEPTION 'Could not acquire lock for user registration - try again';
  END IF;
  
  BEGIN
    -- 1. First User Admin: Atomic check and insert to prevent race condition
    INSERT INTO public.admin_users (user_id) 
    SELECT NEW.id 
    WHERE NOT EXISTS (SELECT 1 FROM public.admin_users LIMIT 1)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- 2. Guest Purchase Claims: Claim guest purchases for this user (if function exists)
    -- This will be available after the payment system migration (lives in seller_main)
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE p.proname = 'claim_guest_purchases_for_user' AND n.nspname = 'seller_main') THEN
      SELECT seller_main.claim_guest_purchases_for_user(NEW.id) INTO claim_result;
      
      -- Log the guest purchase claim result
      IF claim_result->>'success' = 'true' AND (claim_result->>'claimed_count')::INTEGER > 0 THEN
        PERFORM public.log_audit_entry(
          'guest_purchases',
          'UPDATE',
          NULL,
          jsonb_build_object(
            'user_id', NEW.id,
            'email', NEW.email, 
            'claimed_count', claim_result->>'claimed_count',
            'message', claim_result->>'message'
          ),
          NEW.id
        );
      END IF;
    END IF;
    
    -- 3. Audit Logging: Log registration event for security monitoring
    PERFORM public.log_audit_entry(
      'auth.users',
      'INSERT',
      NULL,
      jsonb_build_object('email', NEW.email, 'id', NEW.id),
      NEW.id
    );

  EXCEPTION
    WHEN OTHERS THEN
      -- Release lock on error
      PERFORM pg_advisory_unlock(hashtext('handle_new_user_registration'));
      RAISE;
  END;
  
  -- Release advisory lock
  PERFORM pg_advisory_unlock(hashtext('handle_new_user_registration'));
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Create trigger for comprehensive user registration handling
CREATE TRIGGER user_registration_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_registration();

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ language plpgsql
SET search_path = '';

-- Create simple audit function for critical tables
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (table_name, operation, old_values, user_id)
    VALUES (TG_TABLE_NAME, TG_OP, row_to_json(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (table_name, operation, old_values, new_values, user_id)
    VALUES (TG_TABLE_NAME, TG_OP, row_to_json(OLD), row_to_json(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (table_name, operation, new_values, user_id)
    VALUES (TG_TABLE_NAME, TG_OP, row_to_json(NEW), auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Secure function to log audit entries with proper validation
CREATE OR REPLACE FUNCTION log_audit_entry(
    table_name_param TEXT,
    operation_param TEXT,
    old_values_param JSONB DEFAULT NULL,
    new_values_param JSONB DEFAULT NULL,
    user_id_param UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    -- Input validation
    IF table_name_param IS NULL OR length(table_name_param) = 0 OR length(table_name_param) > 100 THEN
        RAISE EXCEPTION 'Invalid table name: must be 1-100 characters';
    END IF;
    
    IF operation_param IS NULL OR operation_param NOT IN ('INSERT', 'UPDATE', 'DELETE') THEN
        RAISE EXCEPTION 'Invalid operation: must be INSERT, UPDATE, or DELETE';
    END IF;
    
    -- Validate JSONB size (prevent DoS)
    IF pg_column_size(old_values_param) > 65536 THEN -- 64KB limit
        RAISE EXCEPTION 'Old values too large (max 64KB)';
    END IF;
    
    IF pg_column_size(new_values_param) > 65536 THEN -- 64KB limit
        RAISE EXCEPTION 'New values too large (max 64KB)';
    END IF;
    
    -- Insert audit entry
    INSERT INTO public.audit_log (
        table_name, 
        operation, 
        old_values, 
        new_values, 
        user_id,
        performed_at
    ) VALUES (
        table_name_param,
        operation_param,
        old_values_param,
        new_values_param,
        COALESCE(user_id_param, auth.uid()),
        NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

-- Grant execute permissions to the service role and authenticated users
GRANT EXECUTE ON FUNCTION log_audit_entry TO service_role, authenticated;

-- Create trigger for products table (seller schema)
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON seller_main.products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON seller_main.categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_variant_groups_updated_at
  BEFORE UPDATE ON seller_main.variant_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create audit triggers for critical tables
CREATE TRIGGER audit_admin_users
  AFTER INSERT OR UPDATE OR DELETE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_user_product_access
  AFTER INSERT OR UPDATE OR DELETE ON seller_main.user_product_access
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_function();

-- 
-- SCHEMA PERMISSIONS
--
-- Grant usage on seller_main to Supabase roles so PostgREST can access tables/functions
GRANT USAGE ON SCHEMA seller_main TO anon, authenticated, service_role;

-- Principle of least privilege: explicit per-table grants instead of blanket access.
-- service_role gets ALL on everything; anon/authenticated get minimum required per table.
-- RLS is the primary guard, but defence-in-depth requires minimal grants
-- (if RLS is accidentally disabled, damage is limited).
GRANT ALL ON ALL TABLES IN SCHEMA seller_main TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA seller_main TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA seller_main TO service_role;

-- Public catalog tables: anon gets SELECT (storefront browsing).
-- authenticated gets SELECT + mutation grants needed by admin CRUD routes
-- (RLS policies are the real guard — grants just allow operations to reach RLS evaluation).
GRANT SELECT ON seller_main.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.products TO authenticated;
GRANT SELECT ON seller_main.variant_groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.variant_groups TO authenticated;
GRANT SELECT ON seller_main.product_variant_groups TO anon;
GRANT SELECT, INSERT, DELETE ON seller_main.product_variant_groups TO authenticated;
GRANT SELECT ON seller_main.categories TO anon, authenticated;
GRANT SELECT ON seller_main.product_categories TO anon;
GRANT SELECT, INSERT, DELETE ON seller_main.product_categories TO authenticated;
GRANT SELECT ON seller_main.tags TO anon, authenticated;
GRANT SELECT ON seller_main.product_tags TO anon, authenticated;
GRANT SELECT, DELETE ON seller_main.user_product_access TO authenticated;

-- Default privileges for future objects: only service_role gets automatic grants.
-- New tables for anon/authenticated MUST be granted explicitly (see Security Rule #5).
ALTER DEFAULT PRIVILEGES IN SCHEMA seller_main GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA seller_main GRANT USAGE ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA seller_main GRANT EXECUTE ON FUNCTIONS TO service_role;

--
-- PROXY VIEWS: public -> seller_main (backward compatibility for standalone mode)
-- These allow existing code and PostgREST to access seller_main tables via public schema
--
CREATE OR REPLACE VIEW public.products WITH (security_invoker = on) AS SELECT * FROM seller_main.products;
CREATE OR REPLACE VIEW public.variant_groups WITH (security_invoker = on) AS SELECT * FROM seller_main.variant_groups;
CREATE OR REPLACE VIEW public.product_variant_groups WITH (security_invoker = on) AS SELECT * FROM seller_main.product_variant_groups;
CREATE OR REPLACE VIEW public.categories WITH (security_invoker = on) AS SELECT * FROM seller_main.categories;
CREATE OR REPLACE VIEW public.product_categories WITH (security_invoker = on) AS SELECT * FROM seller_main.product_categories;
CREATE OR REPLACE VIEW public.tags WITH (security_invoker = on) AS SELECT * FROM seller_main.tags;
CREATE OR REPLACE VIEW public.product_tags WITH (security_invoker = on) AS SELECT * FROM seller_main.product_tags;
CREATE OR REPLACE VIEW public.user_product_access WITH (security_invoker = on) AS SELECT * FROM seller_main.user_product_access;
CREATE OR REPLACE VIEW public.user_access_stats WITH (security_invoker = on) AS SELECT * FROM seller_main.user_access_stats;
CREATE OR REPLACE VIEW public.user_product_access_detailed WITH (security_invoker = on) AS SELECT * FROM seller_main.user_product_access_detailed;

-- 
-- CRON JOB MANAGEMENT
-- 
-- The following cron jobs are automatically scheduled:
-- 1. cleanup-rate-limits: Runs every hour to clean old rate limit records
-- 
-- To view job status: SELECT * FROM get_cleanup_job_status();
-- To manually run cleanup: SELECT cleanup_rate_limits();
-- To unschedule job: SELECT cron.unschedule('cleanup-rate-limits');
-- 
-- For audit log cleanup (optional):
-- To enable: SELECT cron.schedule('cleanup-audit-logs', '0 2 * * 0', 'SELECT cleanup_audit_logs(90);');
-- To manually run: SELECT cleanup_audit_logs(90);
--

-- =====================================================
-- PUBLIC SCHEMA TABLE GRANTS (SECURITY HARDENING)
-- =====================================================
-- Supabase grants ALL privileges to anon/authenticated by default.
-- Explicitly revoke and re-grant with principle of least privilege.

-- admin_users: only service_role manages, authenticated can SELECT own row (for admin checks)
REVOKE ALL ON public.admin_users FROM anon, authenticated;
GRANT SELECT ON public.admin_users TO authenticated;
GRANT ALL ON public.admin_users TO service_role;

-- audit_log: service_role only (written via SECURITY DEFINER functions)
-- Note: admin_actions grants are in 20250102000000_payment_system.sql (table defined there)
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT ALL ON public.audit_log TO service_role;

-- rate_limits / application_rate_limits: SECURITY DEFINER functions write to these;
-- authenticated needs INSERT/UPDATE via those functions, but not direct table access
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

REVOKE ALL ON public.application_rate_limits FROM anon, authenticated;
GRANT ALL ON public.application_rate_limits TO service_role;

COMMIT;

