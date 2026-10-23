-- Coupon type, amount and currency acceptance.
BEGIN;
INSERT INTO public.coupons(code, discount_type, discount_value, currency) VALUES ('W20-PRICE30', 'set_price', 30, 'PLN'), ('W20-ZERO', 'set_price', 0, 'PLN');
DO $$
DECLARE result jsonb;
BEGIN
  result := public.verify_coupon('W20-PRICE30', gen_random_uuid(), null, 'USD');
  ASSERT NOT (result->>'valid')::boolean, 'Different currencies must be rejected';
  result := public.verify_coupon('W20-PRICE30', gen_random_uuid(), null, 'PLN');
  ASSERT (result->>'valid')::boolean AND result->>'discount_type'='set_price', 'Set price must verify';
  BEGIN
    INSERT INTO public.coupons(code, discount_type, discount_value, currency) VALUES ('W20-JPY', 'set_price', 30.5, 'JPY');
    RAISE EXCEPTION 'Fractional JPY accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.coupons(code, discount_type, discount_value, currency) VALUES ('W20-NEG', 'set_price', -1, 'PLN');
    RAISE EXCEPTION 'Negative price accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.coupons(code, discount_type, discount_value, currency) VALUES ('W20-NAN', 'set_price', 'NaN', 'PLN');
    RAISE EXCEPTION 'Non-finite price accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.coupons(code, discount_type, discount_value) VALUES ('W20-NOCURRENCY', 'set_price', 30);
    RAISE EXCEPTION 'Missing currency accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE buyer uuid := gen_random_uuid(); product uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES(buyer, 'set-price-zero@example.com');
  INSERT INTO public.products(id, name, slug, price, currency, is_active) VALUES(product, 'Zero coupon', 'set-price-zero', 49, 'PLN', true);
  INSERT INTO public.coupons(code, discount_type, discount_value, currency, allowed_product_ids)
    VALUES('W20-FREE', 'set_price', 0, 'PLN', jsonb_build_array(product));
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',buyer)::text, true);
  ASSERT public.grant_free_product_access('set-price-zero', null, 'W20-FREE'), 'Zero price grants free access';
  ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=buyer AND product_id=product);
  ASSERT (SELECT current_usage_count FROM public.coupons WHERE code='W20-FREE')=1;
END;
$$;
ROLLBACK;
