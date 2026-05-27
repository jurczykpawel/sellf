-- ============================================================================
-- Security guards: REVOKE EXECUTE from anon/authenticated on admin-only RPCs.
-- (Proxy function thunks removed after schema unification — public.X no longer
--  proxies public.X, so the thunks would self-recurse.)
-- ============================================================================

-- Security: Revoke EXECUTE from anon and authenticated on admin-only functions.
-- Supabase auto-grants EXECUTE to anon/authenticated on all new public functions.
-- These proxy functions mirror the permissions of their public originals.
-- ============================================================================

-- Admin-only functions: only callable via service_role
REVOKE ALL ON FUNCTION public.admin_delete_oto_offer FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_product_order_bumps FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_product_oto_offer FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_oto_offer FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_guest_purchases_for_user FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_oto_coupons FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_guest_purchases FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_abandoned_cart_stats FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_abandoned_carts FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_product_access_service_role FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_coupon_usage FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_expired_pending_payments FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.migrate_guest_payment_data_to_profile FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.process_stripe_payment_completion FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.process_stripe_payment_completion_with_bump FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_payment_transaction FROM anon, authenticated;

-- Functions callable by authenticated users only (not anon)
REVOKE ALL ON FUNCTION public.create_refund_request FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_refund_requests FROM anon;
REVOKE ALL ON FUNCTION public.get_dashboard_stats FROM anon;
REVOKE ALL ON FUNCTION public.get_detailed_revenue_stats FROM anon;
REVOKE ALL ON FUNCTION public.get_hourly_revenue_stats FROM anon;
REVOKE ALL ON FUNCTION public.get_payment_statistics FROM anon;
REVOKE ALL ON FUNCTION public.get_revenue_goal FROM anon;
REVOKE ALL ON FUNCTION public.get_sales_chart_data FROM anon;
REVOKE ALL ON FUNCTION public.get_user_payment_history FROM anon;
REVOKE ALL ON FUNCTION public.get_user_profile FROM anon;
REVOKE ALL ON FUNCTION public.get_user_purchases_with_refund_status FROM anon;
REVOKE ALL ON FUNCTION public.grant_free_product_access FROM anon;
REVOKE ALL ON FUNCTION public.process_refund_request FROM anon;
REVOKE ALL ON FUNCTION public.set_revenue_goal FROM anon;
REVOKE ALL ON FUNCTION public.update_video_progress FROM anon;

-- increment_sale_quantity_sold modifies data — restrict to service_role + authenticated only
REVOKE ALL ON FUNCTION public.increment_sale_quantity_sold FROM anon;

-- Functions callable by anon (public-facing)
-- batch_check_user_product_access, check_user_product_access, check_waitlist_config,
-- find_auto_apply_coupon, generate_oto_coupon, get_oto_coupon_info,
-- get_product_order_bumps, get_public_integrations_config, get_variant_group,
-- get_variant_group_by_slug, is_sale_price_active,
-- verify_coupon, check_refund_eligibility
-- → These keep default EXECUTE for both anon and authenticated (no revoke needed).

-- ===== VIEW: seller_customer_stats =====
-- Shows customers who have product access or payment transactions.
-- Used by /api/v1/users to list shop customers.

CREATE OR REPLACE VIEW public.seller_customer_stats WITH (security_invoker = on) AS
SELECT
  u.id AS user_id,
  u.email,
  u.created_at AS user_created_at,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.raw_user_meta_data,
  COALESCE(access_stats.total_products, 0) AS total_products,
  COALESCE(access_stats.total_value, 0) AS total_value,
  access_stats.last_access_granted_at,
  access_stats.first_access_granted_at
FROM (
  SELECT user_id FROM public.user_product_access
  UNION
  SELECT user_id FROM public.payment_transactions WHERE user_id IS NOT NULL
) customers
JOIN auth.users u ON u.id = customers.user_id
LEFT JOIN (
  SELECT
    upa.user_id,
    COUNT(upa.id) AS total_products,
    COALESCE(SUM(p.price), 0) AS total_value,
    MAX(upa.created_at) AS last_access_granted_at,
    MIN(upa.created_at) AS first_access_granted_at
  FROM public.user_product_access upa
  JOIN public.products p ON upa.product_id = p.id
  GROUP BY upa.user_id
) access_stats ON access_stats.user_id = u.id;

REVOKE ALL ON public.seller_customer_stats FROM anon, authenticated;
GRANT SELECT ON public.seller_customer_stats TO service_role;

