-- ============================================================================
-- Proxy functions: public → seller_main
-- 
-- Same pattern as proxy views for tables. These thin wrappers allow PostgREST
-- clients using the default `public` schema to call functions that live in
-- `seller_main`. Each proxy is SECURITY INVOKER — the underlying seller_main
-- function (which is SECURITY DEFINER) handles the security context.
--
-- Why needed: supabase-js defaults to `public` schema when db.schema is not
-- specified. Most app code (createClient from server.ts, createPublicClient,
-- browser client) and all E2E tests use the default schema.
-- ============================================================================

-- ===== admin_delete_oto_offer =====
CREATE OR REPLACE FUNCTION public.admin_delete_oto_offer(source_product_id_param uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.admin_delete_oto_offer(source_product_id_param);
$$;

-- ===== admin_get_product_order_bumps =====
CREATE OR REPLACE FUNCTION public.admin_get_product_order_bumps(product_id_param uuid)
RETURNS TABLE(bump_id uuid, bump_product_id uuid, bump_product_name text, bump_price numeric, bump_title text, bump_description text, is_active boolean, display_order integer, access_duration_days integer, urgency_duration_minutes integer, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.admin_get_product_order_bumps(product_id_param);
$$;

-- ===== admin_get_product_oto_offer =====
CREATE OR REPLACE FUNCTION public.admin_get_product_oto_offer(product_id_param uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.admin_get_product_oto_offer(product_id_param);
$$;

-- ===== admin_save_oto_offer =====
CREATE OR REPLACE FUNCTION public.admin_save_oto_offer(source_product_id_param uuid, oto_product_id_param uuid, discount_type_param text, discount_value_param numeric, duration_minutes_param integer DEFAULT 15, is_active_param boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.admin_save_oto_offer(source_product_id_param, oto_product_id_param, discount_type_param, discount_value_param, duration_minutes_param, is_active_param);
$$;

-- ===== batch_check_user_product_access =====
CREATE OR REPLACE FUNCTION public.batch_check_user_product_access(product_slugs_param text[])
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.batch_check_user_product_access(product_slugs_param);
$$;

-- ===== check_refund_eligibility =====
CREATE OR REPLACE FUNCTION public.check_refund_eligibility(transaction_id_param uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.check_refund_eligibility(transaction_id_param);
$$;

-- ===== check_user_product_access =====
CREATE OR REPLACE FUNCTION public.check_user_product_access(product_slug_param text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.check_user_product_access(product_slug_param);
$$;

-- ===== check_waitlist_config =====
CREATE OR REPLACE FUNCTION public.check_waitlist_config()
RETURNS json
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.check_waitlist_config();
$$;

-- ===== claim_guest_purchases_for_user =====
CREATE OR REPLACE FUNCTION public.claim_guest_purchases_for_user(p_user_id uuid)
RETURNS json
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.claim_guest_purchases_for_user(p_user_id);
$$;

-- ===== cleanup_expired_oto_coupons =====
CREATE OR REPLACE FUNCTION public.cleanup_expired_oto_coupons()
RETURNS integer
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.cleanup_expired_oto_coupons();
$$;

-- ===== cleanup_old_guest_purchases =====
CREATE OR REPLACE FUNCTION public.cleanup_old_guest_purchases(retention_days integer DEFAULT 365)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.cleanup_old_guest_purchases(retention_days);
$$;

-- ===== create_refund_request =====
CREATE OR REPLACE FUNCTION public.create_refund_request(transaction_id_param uuid, reason_param text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.create_refund_request(transaction_id_param, reason_param);
$$;

-- ===== find_auto_apply_coupon =====
CREATE OR REPLACE FUNCTION public.find_auto_apply_coupon(customer_email_param text, product_id_param uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.find_auto_apply_coupon(customer_email_param, product_id_param);
$$;

-- ===== generate_oto_coupon =====
CREATE OR REPLACE FUNCTION public.generate_oto_coupon(source_product_id_param uuid, customer_email_param text, transaction_id_param uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.generate_oto_coupon(source_product_id_param, customer_email_param, transaction_id_param);
$$;

-- ===== get_abandoned_cart_stats =====
CREATE OR REPLACE FUNCTION public.get_abandoned_cart_stats(days_ago integer DEFAULT 7)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.get_abandoned_cart_stats(days_ago);
$$;

-- ===== get_abandoned_carts =====
CREATE OR REPLACE FUNCTION public.get_abandoned_carts(days_ago integer DEFAULT 7, limit_count integer DEFAULT 100)
RETURNS TABLE(id uuid, customer_email text, product_id uuid, product_name text, amount numeric, currency text, created_at timestamp with time zone, abandoned_at timestamp with time zone, expires_at timestamp with time zone, metadata jsonb)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_abandoned_carts(days_ago, limit_count);
$$;

-- ===== get_admin_refund_requests =====
CREATE OR REPLACE FUNCTION public.get_admin_refund_requests(status_filter text DEFAULT NULL::text, limit_param integer DEFAULT 50, offset_param integer DEFAULT 0)
RETURNS TABLE(request_id uuid, transaction_id uuid, user_id uuid, customer_email text, product_id uuid, product_name text, reason text, status text, requested_amount numeric, currency text, admin_id uuid, admin_response text, processed_at timestamp with time zone, created_at timestamp with time zone, purchase_date timestamp with time zone, stripe_payment_intent_id text)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_admin_refund_requests(status_filter, limit_param, offset_param);
$$;

-- ===== get_dashboard_stats =====
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.get_dashboard_stats();
$$;

-- ===== get_detailed_revenue_stats =====
CREATE OR REPLACE FUNCTION public.get_detailed_revenue_stats(p_product_id uuid DEFAULT NULL::uuid, p_goal_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.get_detailed_revenue_stats(p_product_id, p_goal_start_date);
$$;

-- ===== get_hourly_revenue_stats =====
CREATE OR REPLACE FUNCTION public.get_hourly_revenue_stats(p_target_date date DEFAULT CURRENT_DATE, p_product_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(hour integer, amount_by_currency jsonb, orders integer)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_hourly_revenue_stats(p_target_date, p_product_id);
$$;

-- ===== get_oto_coupon_info =====
CREATE OR REPLACE FUNCTION public.get_oto_coupon_info(coupon_code_param text, email_param text)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.get_oto_coupon_info(coupon_code_param, email_param);
$$;

-- ===== get_payment_statistics =====
CREATE OR REPLACE FUNCTION public.get_payment_statistics(start_date timestamp with time zone DEFAULT (now() - '30 days'::interval), end_date timestamp with time zone DEFAULT now())
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.get_payment_statistics(start_date, end_date);
$$;

-- ===== get_product_order_bumps =====
CREATE OR REPLACE FUNCTION public.get_product_order_bumps(product_id_param uuid)
RETURNS TABLE(bump_id uuid, bump_product_id uuid, bump_product_name text, bump_product_description text, bump_product_icon text, bump_price numeric, original_price numeric, bump_access_duration integer, bump_currency text, bump_title text, bump_description text, display_order integer, urgency_duration_minutes integer)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_product_order_bumps(product_id_param);
$$;

-- ===== get_public_integrations_config =====
CREATE OR REPLACE FUNCTION public.get_public_integrations_config()
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.get_public_integrations_config();
$$;

-- ===== get_revenue_goal =====
CREATE OR REPLACE FUNCTION public.get_revenue_goal(p_product_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(goal_amount bigint, start_date timestamp with time zone)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_revenue_goal(p_product_id);
$$;

-- ===== get_sales_chart_data =====
CREATE OR REPLACE FUNCTION public.get_sales_chart_data(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_product_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(date text, amount_by_currency jsonb, orders integer)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_sales_chart_data(p_start_date, p_end_date, p_product_id);
$$;

-- ===== get_user_payment_history =====
CREATE OR REPLACE FUNCTION public.get_user_payment_history(user_id_param uuid)
RETURNS TABLE(transaction_id uuid, product_name text, product_slug text, amount numeric, currency text, payment_date timestamp with time zone, status text, refunded_amount numeric)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_user_payment_history(user_id_param);
$$;

-- ===== get_user_profile =====
CREATE OR REPLACE FUNCTION public.get_user_profile(user_id_param uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.get_user_profile(user_id_param);
$$;

-- ===== get_user_purchases_with_refund_status =====
CREATE OR REPLACE FUNCTION public.get_user_purchases_with_refund_status(user_id_param uuid DEFAULT NULL::uuid)
RETURNS TABLE(transaction_id uuid, product_id uuid, product_name text, product_slug text, product_icon text, amount numeric, currency text, purchase_date timestamp with time zone, status text, refunded_amount numeric, is_refundable boolean, refund_period_days integer, days_since_purchase integer, refund_eligible boolean, refund_request_status text, refund_request_id uuid)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_user_purchases_with_refund_status(user_id_param);
$$;

-- ===== get_variant_group =====
CREATE OR REPLACE FUNCTION public.get_variant_group(p_group_id uuid)
RETURNS TABLE(id uuid, name text, slug text, variant_name character varying, display_order integer, is_featured boolean, price numeric, currency text, description text, image_url text, icon text, is_active boolean, allow_custom_price boolean, custom_price_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_variant_group(p_group_id);
$$;

-- ===== get_variant_group_by_slug =====
CREATE OR REPLACE FUNCTION public.get_variant_group_by_slug(p_slug text)
RETURNS TABLE(id uuid, name text, slug text, variant_name character varying, display_order integer, is_featured boolean, price numeric, currency text, description text, image_url text, icon text, is_active boolean, allow_custom_price boolean, custom_price_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM seller_main.get_variant_group_by_slug(p_slug);
$$;

-- ===== grant_free_product_access =====
CREATE OR REPLACE FUNCTION public.grant_free_product_access(product_slug_param text, access_duration_days_param integer DEFAULT NULL::integer)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.grant_free_product_access(product_slug_param, access_duration_days_param);
$$;

-- ===== grant_product_access_service_role =====
CREATE OR REPLACE FUNCTION public.grant_product_access_service_role(user_id_param uuid, product_id_param uuid, max_retries integer DEFAULT 3)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.grant_product_access_service_role(user_id_param, product_id_param, max_retries);
$$;

-- ===== grant_pwyw_free_access =====
CREATE OR REPLACE FUNCTION public.grant_pwyw_free_access(product_slug_param text, access_duration_days_param integer DEFAULT NULL::integer)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.grant_pwyw_free_access(product_slug_param, access_duration_days_param);
$$;

-- ===== increment_sale_quantity_sold =====
CREATE OR REPLACE FUNCTION public.increment_sale_quantity_sold(p_product_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.increment_sale_quantity_sold(p_product_id);
$$;

-- ===== is_sale_price_active =====
CREATE OR REPLACE FUNCTION public.is_sale_price_active(p_sale_price numeric, p_sale_price_until timestamp with time zone, p_sale_quantity_limit integer, p_sale_quantity_sold integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.is_sale_price_active(p_sale_price, p_sale_price_until, p_sale_quantity_limit, p_sale_quantity_sold);
$$;

-- ===== mark_expired_pending_payments =====
CREATE OR REPLACE FUNCTION public.mark_expired_pending_payments()
RETURNS integer
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.mark_expired_pending_payments();
$$;

-- ===== migrate_guest_payment_data_to_profile =====
CREATE OR REPLACE FUNCTION public.migrate_guest_payment_data_to_profile(p_user_id uuid)
RETURNS json
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.migrate_guest_payment_data_to_profile(p_user_id);
$$;

-- ===== process_refund_request =====
CREATE OR REPLACE FUNCTION public.process_refund_request(request_id_param uuid, action_param text, admin_response_param text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.process_refund_request(request_id_param, action_param, admin_response_param);
$$;

-- ===== process_stripe_payment_completion =====
CREATE OR REPLACE FUNCTION public.process_stripe_payment_completion(session_id_param text, product_id_param uuid, customer_email_param text, amount_total numeric, currency_param text, stripe_payment_intent_id text DEFAULT NULL::text, user_id_param uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.process_stripe_payment_completion(session_id_param, product_id_param, customer_email_param, amount_total, currency_param, stripe_payment_intent_id, user_id_param);
$$;

-- ===== process_stripe_payment_completion_with_bump =====
CREATE OR REPLACE FUNCTION public.process_stripe_payment_completion_with_bump(session_id_param text, product_id_param uuid, customer_email_param text, amount_total numeric, currency_param text, stripe_payment_intent_id text DEFAULT NULL::text, user_id_param uuid DEFAULT NULL::uuid, bump_product_ids_param uuid[] DEFAULT NULL::uuid[], coupon_id_param uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.process_stripe_payment_completion_with_bump(session_id_param, product_id_param, customer_email_param, amount_total, currency_param, stripe_payment_intent_id, user_id_param, bump_product_ids_param, coupon_id_param);
$$;

-- ===== set_revenue_goal =====
CREATE OR REPLACE FUNCTION public.set_revenue_goal(p_goal_amount bigint, p_start_date timestamp with time zone, p_product_id uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.set_revenue_goal(p_goal_amount, p_start_date, p_product_id);
$$;

-- ===== update_video_progress =====
CREATE OR REPLACE FUNCTION public.update_video_progress(product_id_param uuid, video_id_param text, position_param integer, duration_param integer DEFAULT NULL::integer, completed_param boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.update_video_progress(product_id_param, video_id_param, position_param, duration_param, completed_param);
$$;

-- ===== validate_payment_transaction =====
CREATE OR REPLACE FUNCTION public.validate_payment_transaction(transaction_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.validate_payment_transaction(transaction_id);
$$;

-- ===== verify_coupon =====
CREATE OR REPLACE FUNCTION public.verify_coupon(code_param text, product_id_param uuid, customer_email_param text DEFAULT NULL::text, currency_param text DEFAULT 'USD'::text)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.verify_coupon(code_param, product_id_param, customer_email_param, currency_param);
$$;

-- ============================================================================
-- ===== increment_coupon_usage =====
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(coupon_id_param uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT seller_main.increment_coupon_usage(coupon_id_param);
$$;

-- Security: Revoke EXECUTE from anon and authenticated on admin-only functions.
-- Supabase auto-grants EXECUTE to anon/authenticated on all new public functions.
-- These proxy functions mirror the permissions of their seller_main originals.
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
REVOKE ALL ON FUNCTION public.grant_pwyw_free_access FROM anon;
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
