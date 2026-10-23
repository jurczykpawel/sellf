-- Set-price coupons keep the product's list-price history unchanged.
ALTER TABLE public.coupons DROP CONSTRAINT coupons_discount_type_check,
  DROP CONSTRAINT coupons_discount_value_check, DROP CONSTRAINT coupons_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_discount_type_check CHECK (discount_type IN ('percentage','fixed','set_price')),
  ADD CONSTRAINT coupons_discount_value_check CHECK ((discount_value > 0 OR (discount_type = 'set_price' AND discount_value = 0)) AND (discount_type <> 'set_price' OR discount_value < 'Infinity'::numeric)),
  ADD CONSTRAINT coupons_check CHECK (
    (discount_type = 'fixed' AND (currency IS NULL OR length(currency) = 3)) OR
    (discount_type = 'percentage' AND currency IS NULL) OR
    (discount_type = 'set_price' AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$')),
  ADD CONSTRAINT coupons_set_price_whole CHECK (discount_type <> 'set_price'
    OR public.currency_minor_factor(currency) <> 1 OR discount_value = trunc(discount_value));
CREATE OR REPLACE FUNCTION public.verify_coupon(
  code_param TEXT, product_id_param UUID,
  customer_email_param TEXT DEFAULT NULL, currency_param TEXT DEFAULT 'USD'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  DELETE FROM public.coupon_reservations WHERE expires_at < NOW();
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
CREATE OR REPLACE FUNCTION public.grant_free_product_access(product_slug_param text, access_duration_days_param integer DEFAULT NULL::integer, coupon_code_param text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
 SET statement_timeout TO '2s'
AS $$
DECLARE
    product_record RECORD;
    current_user_id UUID;
    v_access_expires_at TIMESTAMPTZ;
    v_capped_duration INTEGER;
    clean_slug TEXT; clean_coupon TEXT;
    coupon_result JSONB; v_coupon_id UUID;
    v_discount_type TEXT; v_discount_value NUMERIC; v_user_email TEXT;
    eligible BOOLEAN := FALSE;
    v_component_id UUID;
BEGIN
    IF product_slug_param IS NULL OR length(product_slug_param) = 0 OR length(product_slug_param) > 100 THEN
        RETURN FALSE;
    END IF;
    IF access_duration_days_param IS NOT NULL AND (access_duration_days_param < 0 OR access_duration_days_param > 3650) THEN
        RETURN FALSE;
    END IF;
    clean_slug := regexp_replace(product_slug_param, '[^a-zA-Z0-9_-]', '', 'g');
    IF clean_slug IS NULL OR length(clean_slug) = 0 THEN
        RETURN FALSE;
    END IF;
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    SELECT email INTO v_user_email FROM auth.users WHERE id = current_user_id;
    SELECT id, price, currency, allow_custom_price, custom_price_min, auto_grant_duration_days, is_active,
           product_type, available_from, available_until, is_bundle
      INTO product_record
      FROM public.products
      WHERE slug = clean_slug;
    IF NOT FOUND OR NOT product_record.is_active THEN
        RETURN FALSE;
    END IF;
    IF NOT public.is_free_grantable_now(product_record.product_type, product_record.available_from, product_record.available_until)
       AND NOT EXISTS (
         SELECT 1 FROM public.user_product_access upa
         WHERE upa.user_id = current_user_id
           AND upa.product_id = product_record.id
           AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW())
       ) THEN
        RETURN FALSE;
    END IF;
    IF coupon_code_param IS NOT NULL THEN
        clean_coupon := regexp_replace(upper(coupon_code_param), '[^A-Z0-9_-]', '', 'g');
        IF length(clean_coupon) = 0 THEN
            RETURN FALSE;
        END IF;
        coupon_result := public.verify_coupon(
            code_param := clean_coupon,
            product_id_param := product_record.id,
            customer_email_param := v_user_email,
            currency_param := product_record.currency
        );
        IF (coupon_result ->> 'valid')::BOOLEAN IS DISTINCT FROM TRUE THEN
            RETURN FALSE;
        END IF;
        v_coupon_id := (coupon_result ->> 'id')::UUID;
        v_discount_type := coupon_result ->> 'discount_type';
        v_discount_value := (coupon_result ->> 'discount_value')::NUMERIC;
        IF v_discount_type = 'set_price' AND v_discount_value = 0 THEN
            eligible := TRUE;
        ELSIF v_discount_type = 'percentage' AND v_discount_value >= 100 THEN
            eligible := TRUE;
        ELSIF v_discount_type = 'fixed' AND v_discount_value >= product_record.price THEN
            eligible := TRUE;
        ELSE
            RETURN FALSE;
        END IF;
    ELSIF product_record.price = 0 THEN
        eligible := TRUE;
    ELSIF product_record.allow_custom_price AND product_record.custom_price_min = 0 THEN
        eligible := TRUE;
    END IF;
    IF NOT eligible THEN
        RETURN FALSE;
    END IF;
    PERFORM 1 FROM public.user_product_access upa
    WHERE upa.user_id = current_user_id
      AND upa.product_id = product_record.id
      AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW());
    IF FOUND THEN
        RETURN TRUE;
    END IF;
    IF NOT public.check_rate_limit('grant_free_product_access'::TEXT, 20, 3600) THEN
        RETURN FALSE;
    END IF;
    v_capped_duration := access_duration_days_param;
    IF v_capped_duration IS NOT NULL AND product_record.auto_grant_duration_days IS NOT NULL THEN
        v_capped_duration := LEAST(v_capped_duration, product_record.auto_grant_duration_days);
    END IF;
    IF v_capped_duration IS NOT NULL THEN
        v_access_expires_at := NOW() + INTERVAL '1 day' * v_capped_duration;
    ELSIF product_record.auto_grant_duration_days IS NOT NULL THEN
        v_access_expires_at := NOW() + INTERVAL '1 day' * product_record.auto_grant_duration_days;
    ELSE
        v_access_expires_at := NULL;
    END IF;
    INSERT INTO public.user_product_access (user_id, product_id, access_expires_at, access_duration_days)
    VALUES (
        current_user_id,
        product_record.id,
        v_access_expires_at,
        COALESCE(v_capped_duration, product_record.auto_grant_duration_days)
    )
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET
        access_expires_at = EXCLUDED.access_expires_at,
        access_duration_days = EXCLUDED.access_duration_days,
        access_granted_at = NOW();
    IF product_record.is_bundle THEN
        FOR v_component_id IN
            SELECT bi.component_product_id FROM public.bundle_items bi
            WHERE bi.bundle_product_id = product_record.id
            ORDER BY bi.display_order
        LOOP
            PERFORM public.grant_bundle_component_access(current_user_id, v_component_id);
        END LOOP;
    END IF;
    IF coupon_code_param IS NOT NULL AND v_coupon_id IS NOT NULL THEN
        INSERT INTO public.coupon_redemptions (
            coupon_id, customer_email, user_id, discount_amount, transaction_id
        )
        VALUES (
            v_coupon_id,
            v_user_email,
            current_user_id,
            product_record.price,  -- full-discount path: discount equals list price
            NULL
        );
        UPDATE public.coupons
           SET current_usage_count = current_usage_count + 1
         WHERE id = v_coupon_id;
        DELETE FROM public.coupon_reservations
         WHERE coupon_id = v_coupon_id
           AND customer_email = v_user_email;
    END IF;
    RETURN TRUE;
END;
$$;
