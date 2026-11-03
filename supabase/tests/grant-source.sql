-- Every access grant path records where the access came from (grant_source), without guessing by price.
-- Run: docker exec -i supabase_db_<project> psql -U postgres -f - < supabase/tests/grant-source.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  buyer uuid := gen_random_uuid(); paid uuid := gen_random_uuid(); free_p uuid := gen_random_uuid();
  bundle uuid := gen_random_uuid(); part uuid := gen_random_uuid(); manual_p uuid := gen_random_uuid();
  coupon_p uuid := gen_random_uuid(); sub_p uuid := gen_random_uuid(); sub_id uuid;
  src text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES(buyer, 'grant-source@example.com', now());
  INSERT INTO public.products(id, name, slug, price, currency, is_active, is_bundle) VALUES
    (paid, 'GS paid', 'gs-paid', 49, 'PLN', true, false), (free_p, 'GS free', 'gs-free', 0, 'PLN', true, false),
    (bundle, 'GS bundle', 'gs-bundle', 99, 'PLN', true, true), (part, 'GS part', 'gs-part', 49, 'PLN', true, false),
    (manual_p, 'GS manual', 'gs-manual', 49, 'PLN', true, false), (coupon_p, 'GS coupon', 'gs-coupon', 49, 'PLN', true, false),
    (sub_p, 'GS sub', 'gs-sub', 0, 'PLN', true, false);
  INSERT INTO public.bundle_items(bundle_product_id, component_product_id, display_order) VALUES(bundle, part, 0);
  INSERT INTO public.coupons(code, discount_type, discount_value, currency, allowed_product_ids)
    VALUES('GS-FREE', 'set_price', 0, 'PLN', jsonb_build_array(coupon_p));

  -- Purchase (service role completion path) and bundle components granted with it.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.grant_product_access_service_role(buyer, paid);
  PERFORM public.grant_product_and_bundle_components(buyer, bundle);
  -- Manual admin grant.
  PERFORM public.mutate_access('grant', buyer, manual_p, NULL, '{"access_duration_days":30}', jsonb_build_object('type','user','id',buyer));

  -- Free claims by the signed-in buyer: a free product and a paid product with a 100% coupon.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',buyer)::text, true);
  ASSERT public.grant_free_product_access('gs-free'), 'free product claim';
  ASSERT public.grant_free_product_access('gs-coupon', null, 'GS-FREE'), 'zero-price coupon claim';
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Subscription access (inserted by the Stripe subscription handler with subscription_id).
  INSERT INTO public.subscriptions(id, user_id, product_id, stripe_subscription_id, stripe_customer_id, status)
    VALUES(gen_random_uuid(), buyer, sub_p, 'sub_gs_' || replace(buyer::text, '-', ''), 'cus_gs', 'active') RETURNING id INTO sub_id;
  INSERT INTO public.user_product_access(user_id, product_id, subscription_id) VALUES(buyer, sub_p, sub_id);

  FOR src IN SELECT p.slug || '=' || a.grant_source FROM public.user_product_access a JOIN public.products p ON p.id = a.product_id
    WHERE a.user_id = buyer ORDER BY p.slug LOOP RAISE NOTICE '%', src; END LOOP;
  ASSERT (SELECT grant_source FROM public.user_product_access WHERE user_id=buyer AND product_id=paid) = 'purchase', 'purchase';
  ASSERT (SELECT grant_source FROM public.user_product_access WHERE user_id=buyer AND product_id=bundle) = 'purchase', 'bundle itself';
  ASSERT (SELECT grant_source FROM public.user_product_access WHERE user_id=buyer AND product_id=part) = 'bundle', 'bundle component';
  ASSERT (SELECT grant_source FROM public.user_product_access WHERE user_id=buyer AND product_id=manual_p) = 'manual', 'manual';
  ASSERT (SELECT grant_source FROM public.user_product_access WHERE user_id=buyer AND product_id=free_p) = 'free', 'free product';
  ASSERT (SELECT grant_source FROM public.user_product_access WHERE user_id=buyer AND product_id=coupon_p) = 'free', 'coupon claim on a paid product is free, not manual';
  ASSERT (SELECT grant_source FROM public.user_product_access WHERE user_id=buyer AND product_id=sub_p) = 'subscription', 'subscription';
  RAISE NOTICE 'PASS grant sources';
END;
$$;
-- Column contract: constrained vocabulary, not writable by buyers.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.user_product_access(user_id, product_id, grant_source)
      SELECT u.id, p.id, 'guess' FROM auth.users u, public.products p LIMIT 1;
    RAISE EXCEPTION 'invalid grant_source accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS vocabulary'; END;
END $$;
ROLLBACK;
