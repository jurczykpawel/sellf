-- ============================================================================
-- SECURITY FIX: Restrict RPC function access
-- ============================================================================
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on all functions.
-- This means anon/authenticated users can call any function directly
-- via Supabase REST API (/rest/v1/rpc/function_name), even SECURITY DEFINER
-- functions that bypass RLS.
--
-- Attack vectors this fixes:
-- 1. TABLE POLLUTION: calling write functions with arbitrary data to fill DB
-- 2. RATE LIMIT EXHAUSTION: calling rate limit functions to block other users
-- 3. UNAUTHORIZED ACCESS: calling grant_product_access_service_role to give
--    free access to any product
-- 4. DATA MANIPULATION: calling cleanup/increment functions to corrupt data
-- 5. COUPON GENERATION: calling generate_oto_coupon to create unlimited coupons
--
-- Fix: revoke PUBLIC default, then grant explicitly per function.
-- Additionally: ALTER DEFAULT PRIVILEGES so future functions don't get PUBLIC.
-- ============================================================================

-- Prevent future functions from getting implicit PUBLIC EXECUTE grant.
-- Any new CREATE FUNCTION in public schema will require an explicit GRANT.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA seller_main REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- First, revoke the implicit PUBLIC grant from ALL public functions.
-- This is the nuclear option — safe because we re-grant below.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM public, anon, authenticated',
      fn.proname, fn.args
    );
  END LOOP;
END;
$$;

-- Revoke from seller_main functions too
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'seller_main' AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION seller_main.%I(%s) FROM public, anon, authenticated',
      fn.proname, fn.args
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- SERVICE_ROLE ONLY — called from webhooks, triggers, cron, admin API
-- These write data and must never be callable by end users directly.
-- ============================================================================

-- Payment processing (webhook + verify-payment.ts via service client)
GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion_with_bump TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.grant_product_access_service_role TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.generate_oto_coupon TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.increment_sale_quantity_sold TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.claim_guest_purchases_for_user TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.migrate_guest_payment_data_to_profile TO service_role;

-- Rate limiting (called from rate-limiting.ts + checkout.ts via admin client)
GRANT EXECUTE ON FUNCTION public.check_rate_limit TO service_role;
GRANT EXECUTE ON FUNCTION public.check_application_rate_limit TO service_role;

-- Cleanup / cron jobs
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_application_rate_limits TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_audit_logs TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_admin_actions TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.cleanup_old_guest_purchases TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.cleanup_old_price_history TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.cleanup_expired_oto_coupons TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.mark_expired_pending_payments TO service_role;

-- Logging (called from triggers / server-side only)
GRANT EXECUTE ON FUNCTION public.log_audit_entry TO service_role;
GRANT EXECUTE ON FUNCTION public.log_admin_action TO service_role;

-- Monitoring / system
GRANT EXECUTE ON FUNCTION public.send_monitoring_email TO service_role;
GRANT EXECUTE ON FUNCTION public.logs_monitoring_check TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_admin_cache TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cleanup_job_status TO service_role;

-- API key verification (middleware.ts via admin client)
GRANT EXECUTE ON FUNCTION public.verify_api_key TO service_role;

-- Trigger functions (don't need RPC grants, but service_role for safety)
GRANT EXECUTE ON FUNCTION public.handle_new_user_registration TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_trigger_function TO service_role;
GRANT EXECUTE ON FUNCTION public.log_admin_action_trigger TO service_role;
GRANT EXECUTE ON FUNCTION public.logs_monitoring_trigger TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.protect_payment_method_config_created_at TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.update_payment_method_config_timestamp TO service_role;
GRANT EXECUTE ON FUNCTION public.update_refund_request_timestamp TO service_role;
GRANT EXECUTE ON FUNCTION public.update_refunded_at TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.log_product_price_change TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.validate_payment_transaction TO service_role;

-- ============================================================================
-- AUTHENTICATED ONLY — require user session (auth.uid() used internally)
-- ============================================================================

-- User-facing actions
GRANT EXECUTE ON FUNCTION seller_main.grant_free_product_access TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.grant_pwyw_free_access TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.create_refund_request TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.check_refund_eligibility TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_user_payment_history TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_user_profile TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_user_purchases_with_refund_status TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.update_video_progress TO authenticated, service_role;

-- Admin functions (have internal is_admin() check, but still restrict to authenticated)
GRANT EXECUTE ON FUNCTION seller_main.admin_save_oto_offer TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.admin_delete_oto_offer TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.admin_get_product_order_bumps TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.admin_get_product_oto_offer TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_admin_refund_requests TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.process_refund_request TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_dashboard_stats TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_detailed_revenue_stats TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_hourly_revenue_stats TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_payment_statistics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_abandoned_cart_stats TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_abandoned_carts TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_sales_chart_data TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_revenue_goal TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.set_revenue_goal TO authenticated, service_role;

-- ============================================================================
-- ANON + AUTHENTICATED — public-facing (checkout, product pages, sellf.js)
-- ============================================================================

-- Access checks (sellf.js, /api/access)
GRANT EXECUTE ON FUNCTION seller_main.batch_check_user_product_access TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.check_user_product_access TO anon, authenticated, service_role;

-- Product / checkout public functions
GRANT EXECUTE ON FUNCTION seller_main.check_waitlist_config TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.find_auto_apply_coupon TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.verify_coupon TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_oto_coupon_info TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_product_order_bumps TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_public_integrations_config TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_variant_group TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seller_main.get_variant_group_by_slug TO anon, authenticated, service_role;

-- Auth / RLS helpers (used in policies and frontend)
GRANT EXECUTE ON FUNCTION public.is_admin TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_cached TO anon, authenticated, service_role;

-- Utility (used in constraints / queries)
GRANT EXECUTE ON FUNCTION seller_main.is_sale_price_active TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_email_format TO anon, authenticated, service_role;
