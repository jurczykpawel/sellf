-- ============================================================================
-- Restrict pg_graphql schema to the public-facing API surface
-- ============================================================================
--
-- Sellf's product surface is REST-only via supabase-js; pg_graphql's auto-
-- generated schema is not used by any client. This migration scopes the
-- generated schema to the small allow-list of RPCs that are intentionally
-- public, and trims the Postgres default EXECUTE grants on the rest.
-- ============================================================================

-- 1. EXECUTE grants for non-public RPCs (Postgres' default-to-PUBLIC behaviour
--    needs to be made explicit per function for the introspection layer to
--    omit them).

REVOKE EXECUTE ON FUNCTION public.admin_delete_oto_offer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_product_order_bumps(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_product_oto_offer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_save_oto_offer(uuid, uuid, text, numeric, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_refund_requests(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_sale_price_active(numeric, timestamptz, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_email_format(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_oto_coupons() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_guest_purchases(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.migrate_guest_payment_data_to_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.migrate_guest_purchases(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion(text, uuid, text, numeric, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text, uuid, text, numeric, text, text, uuid, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_payment_transaction(uuid) FROM PUBLIC;

-- Helpers used internally only — keep authenticated/service_role.
REVOKE EXECUTE ON FUNCTION public.is_sale_price_active(numeric, timestamptz, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_email_format(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_abandoned_cart_stats(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_abandoned_carts(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_detailed_revenue_stats(uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_hourly_revenue_stats(date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_payment_statistics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_revenue_goal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_chart_data(timestamptz, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_payment_history(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_purchases_with_refund_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_free_product_access(text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_coupon_usage(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_sale_quantity_sold(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_expired_pending_payments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_refund_request(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_revenue_goal(bigint, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_video_progress(uuid, text, integer, integer, boolean) FROM PUBLIC;

-- 1b. Hide admin-only tables from anon GraphQL — pg_graphql has no exclude
--     directive (supabase/pg_graphql#470), only REVOKE SELECT works.
REVOKE SELECT ON public.consent_logs FROM anon, authenticated;
REVOKE SELECT ON public.coupon_redemptions FROM anon, authenticated;
REVOKE SELECT ON public.coupon_reservations FROM anon, authenticated;
REVOKE SELECT ON public.profiles FROM anon, authenticated;
REVOKE SELECT ON public.user_product_access FROM anon, authenticated;
REVOKE SELECT ON public.video_events FROM anon, authenticated;
REVOKE SELECT ON public.video_progress FROM anon, authenticated;

GRANT SELECT ON public.consent_logs TO service_role;
GRANT SELECT ON public.coupon_redemptions TO service_role;
GRANT SELECT ON public.coupon_reservations TO service_role;
GRANT SELECT ON public.profiles TO authenticated, service_role;
GRANT SELECT ON public.user_product_access TO authenticated, service_role;
GRANT SELECT ON public.video_events TO authenticated, service_role;
GRANT SELECT ON public.video_progress TO authenticated, service_role;

-- 1c. Drop anon/authenticated write grants on service-role-only tables.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'consent_logs','coupon_redemptions','coupon_reservations',
    'profiles','user_product_access','video_events','video_progress',
    'shop_config'
  ]) LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t
    );
  END LOOP;
END;
$$;

-- 1d. is_admin/is_admin_cached: anon MUST keep EXECUTE — RLS policies on
--     storefront tables (products, order_bumps, variant_groups, …) call
--     is_admin() in their qualifier. Without EXECUTE for anon, every anon
--     SELECT raises 42501 before RLS can even evaluate. The recon concern
--     raised in audit is real but is the cost of using is_admin() in RLS.

-- 2. pg_graphql `@graphql({"include": false})` directive on functions that
--    are not part of the public API (admin, helpers, internal upserts).
--    See https://supabase.github.io/pg_graphql/configuration/ for syntax.

COMMENT ON FUNCTION public.admin_delete_oto_offer(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.admin_get_product_order_bumps(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.admin_get_product_oto_offer(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.admin_save_oto_offer(uuid, uuid, text, numeric, integer, boolean)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_admin_refund_requests(text, integer, integer)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.is_sale_price_active(numeric, timestamptz, integer, integer)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.validate_email_format(text)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.cleanup_expired_oto_coupons()
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.cleanup_old_guest_purchases(integer)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.migrate_guest_payment_data_to_profile(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.migrate_guest_purchases(uuid, text)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.process_stripe_payment_completion(text, uuid, text, numeric, text, text, uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.process_stripe_payment_completion_with_bump(text, uuid, text, numeric, text, text, uuid, uuid[], uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.validate_payment_transaction(uuid)
  IS E'@graphql({"include": false})';

-- Additional internal functions.
COMMENT ON FUNCTION public.claim_guest_purchases_for_user(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_abandoned_cart_stats(integer)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_abandoned_carts(integer, integer)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_dashboard_stats()
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_detailed_revenue_stats(uuid, timestamptz)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_hourly_revenue_stats(date, uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_payment_statistics(timestamptz, timestamptz)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_revenue_goal(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_sales_chart_data(timestamptz, timestamptz, uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_user_payment_history(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.get_user_purchases_with_refund_status(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.grant_free_product_access(text, integer, text)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.increment_coupon_usage(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.increment_sale_quantity_sold(uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.mark_expired_pending_payments()
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.process_refund_request(uuid, text, text)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.set_revenue_goal(bigint, timestamptz, uuid)
  IS E'@graphql({"include": false})';
COMMENT ON FUNCTION public.update_video_progress(uuid, text, integer, integer, boolean)
  IS E'@graphql({"include": false})';
