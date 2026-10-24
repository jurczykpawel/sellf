-- Shared coupon limits and reservation for selection and paid order completion.
CREATE FUNCTION public._reserve_coupon(
  coupon_id_param uuid, product_id_param uuid, customer_email_param text, currency_param text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  coupon_record RECORD;
  user_usage_count INTEGER; reserved_count INTEGER; available_slots INTEGER;
  existing_reservation_id UUID;
  clean_email TEXT;
BEGIN
  IF customer_email_param IS NOT NULL THEN
    clean_email := lower(trim(customer_email_param));
    IF clean_email ~ '[^[:print:]]' THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invalid email format');
    END IF;
    IF clean_email = '' OR clean_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invalid email');
    END IF;
  ELSE
    clean_email := NULL;
  END IF;
  SELECT * INTO coupon_record
  FROM public.coupons
  WHERE id = coupon_id_param
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid code');
  END IF;
  DELETE FROM public.coupon_reservations
  WHERE coupon_id = coupon_id_param AND expires_at < NOW();
  IF coupon_record.discount_type IN ('fixed', 'set_price') AND coupon_record.currency IS NOT NULL AND upper(coupon_record.currency) != upper(currency_param) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code invalid for this currency');
  END IF;
  IF jsonb_array_length(coupon_record.allowed_product_ids) > 0 THEN
    IF NOT (coupon_record.allowed_product_ids @> to_jsonb(product_id_param)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not valid for this product');
    END IF;
  END IF;
  IF jsonb_array_length(coupon_record.allowed_emails) > 0 THEN
    IF clean_email IS NULL OR NOT (coupon_record.allowed_emails @> to_jsonb(clean_email)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not authorized for this email');
    END IF;
  END IF;
  IF clean_email IS NOT NULL THEN
    SELECT COUNT(*) INTO user_usage_count
    FROM public.coupon_redemptions
    WHERE coupon_id = coupon_record.id AND customer_email = clean_email;
    IF user_usage_count >= coupon_record.usage_limit_per_user THEN
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this code');
    END IF;
  END IF;
  IF clean_email IS NOT NULL THEN
    SELECT id INTO existing_reservation_id
    FROM public.coupon_reservations
    WHERE coupon_id = coupon_record.id
      AND customer_email = clean_email
      AND expires_at > NOW();
    IF existing_reservation_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'valid', true, 'id', coupon_record.id,
        'code', coupon_record.code, 'discount_type', coupon_record.discount_type,
        'discount_value', coupon_record.discount_value, 'exclude_order_bumps', coupon_record.exclude_order_bumps,
        'allowed_product_ids', coupon_record.allowed_product_ids, 'already_reserved', true,
        'reservation_id', existing_reservation_id
      );
    END IF;
  END IF;
  IF coupon_record.usage_limit_global IS NOT NULL THEN
    SELECT COUNT(*) INTO reserved_count
    FROM public.coupon_reservations
    WHERE coupon_id = coupon_record.id AND expires_at > NOW();
    available_slots := coupon_record.usage_limit_global
                     - coupon_record.current_usage_count
                     - reserved_count;
    IF available_slots <= 0 THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code usage limit reached');
    END IF;
  END IF;
  IF clean_email IS NOT NULL THEN
    INSERT INTO public.coupon_reservations (coupon_id, customer_email, expires_at)
    VALUES (coupon_record.id, clean_email, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (coupon_id, customer_email) DO UPDATE
    SET expires_at = NOW() + INTERVAL '15 minutes',
        reserved_at = NOW();
  END IF;
  RETURN jsonb_build_object(
    'valid', true, 'id', coupon_record.id,
    'code', coupon_record.code, 'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value, 'exclude_order_bumps', coupon_record.exclude_order_bumps,
    'allowed_product_ids', coupon_record.allowed_product_ids, 'reserved', true,
    'expires_in_minutes', 15
  );
END;
$$;

REVOKE ALL ON FUNCTION public._reserve_coupon(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reserve_coupon(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_coupon(
  code_param TEXT, product_id_param UUID,
  customer_email_param TEXT DEFAULT NULL, currency_param TEXT DEFAULT 'USD'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  coupon_record public.coupons%ROWTYPE;
  clean_email text := lower(trim(customer_email_param));
BEGIN
  IF code_param IS NOT NULL AND length(code_param) > 0 THEN
    IF NOT public.check_rate_limit(
      'verify_coupon', 5, 60,
      'code:' || lower(left(code_param, 80)) || ':' ||
        COALESCE((select auth.uid())::text, clean_email, 'anonymous')
    ) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
    END IF;
  END IF;
  IF NOT public.check_rate_limit('verify_coupon', 100, 60) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
  END IF;
  SELECT * INTO coupon_record
  FROM public.coupons
  WHERE code = code_param AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid code');
  END IF;
  IF coupon_record.expires_at IS NOT NULL AND coupon_record.expires_at < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code expired');
  END IF;
  IF coupon_record.starts_at > NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code not active yet');
  END IF;
  RETURN public._reserve_coupon(coupon_record.id, product_id_param, customer_email_param, currency_param);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_coupon(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_coupon(text,uuid,text,text) TO anon, authenticated, service_role;

-- Keep existing reservations and complete paid Stripe orders independently of selection availability.
CREATE OR REPLACE FUNCTION public._redeem_coupon_for_order(
  coupon_id_param uuid, current_user_id uuid, existing_user_id uuid,
  customer_email_param text, transaction_id_var uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  reservation jsonb;
BEGIN
    IF coupon_id_param IS NOT NULL THEN
      SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id = transaction_id_var;
      PERFORM 1 FROM public.coupons WHERE id = coupon_id_param FOR UPDATE;
      IF tx.payment_provider = 'stripe' AND NOT EXISTS (
        SELECT 1 FROM public.coupon_reservations
        WHERE coupon_id = coupon_id_param AND customer_email = customer_email_param AND expires_at > now()
      ) THEN
        reservation := public._reserve_coupon(coupon_id_param, tx.product_id, customer_email_param, tx.currency);
        IF NOT coalesce((reservation->>'valid')::boolean, false)
          OR (reservation->>'id')::uuid IS DISTINCT FROM coupon_id_param THEN
          RAISE EXCEPTION 'Coupon is not available for this order';
        END IF;
      END IF;

      DELETE FROM public.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      UPDATE public.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND (tx.payment_provider = 'stripe' OR is_active = true)
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      INSERT INTO public.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

END;
$$;
REVOKE ALL ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) TO service_role;
