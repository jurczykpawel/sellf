-- ============================================================================
-- verify_coupon: per-code + global rate limits (M2 from blind pentest 2026-05-20)
-- ============================================================================
--
-- Previously: check_rate_limit('verify_coupon', 20, 60) — one global counter.
-- A single attacker hitting 20 req/min could block legitimate verification
-- of ALL coupons for the whole site (DoS via shared counter).
--
-- Now:
--   Layer 1 — per-code (5/min/code, normalized lowercase):
--     Spam on coupon "WELCOME10" does not affect "BLACKFRIDAY".
--   Layer 2 — global gard (100/min total):
--     Caps brute-force discovery of unique codes; one attacker can't
--     enumerate the namespace by cycling new codes per request.
--
-- check_rate_limit's function_name_param has a length(.) <= 100 constraint;
-- 'verify_coupon:' prefix (14 chars) + lower(code_param) typically <= 30
-- chars stays well under the limit.
-- ============================================================================

CREATE OR REPLACE FUNCTION seller_main.verify_coupon(
  code_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT DEFAULT NULL,
  currency_param TEXT DEFAULT 'USD'
) RETURNS JSONB AS $$
DECLARE
  coupon_record RECORD;
  user_usage_count INTEGER;
  reserved_count INTEGER;
  available_slots INTEGER;
  existing_reservation_id UUID;
  clean_email TEXT;
BEGIN
  -- Layer 1: per-code rate limit (defense against single-code spam)
  IF code_param IS NOT NULL AND length(code_param) > 0 THEN
    IF NOT public.check_rate_limit(
      ('verify_coupon:' || lower(left(code_param, 80)))::TEXT, 5, 60
    ) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
    END IF;
  END IF;

  -- Layer 2: global gard (defense against code-namespace enumeration)
  IF NOT public.check_rate_limit('verify_coupon'::TEXT, 100, 60) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
  END IF;

  -- Validate email: reject non-ASCII chars to prevent homoglyph bypass (e.g. Cyrillic e U+0435)
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

  -- STEP 1: Self-cleaning - remove expired reservations
  DELETE FROM seller_main.coupon_reservations WHERE expires_at < NOW();

  -- STEP 2: Lock coupon row (must use FOR UPDATE to ensure atomicity)
  SELECT * INTO coupon_record
  FROM seller_main.coupons
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

  IF coupon_record.discount_type = 'fixed' AND coupon_record.currency IS NOT NULL AND coupon_record.currency != currency_param THEN
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

  -- STEP 3: Check per-user limit (actual redemptions)
  IF clean_email IS NOT NULL THEN
    SELECT COUNT(*) INTO user_usage_count
    FROM seller_main.coupon_redemptions
    WHERE coupon_id = coupon_record.id AND customer_email = clean_email;

    IF user_usage_count >= coupon_record.usage_limit_per_user THEN
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this code');
    END IF;
  END IF;

  -- STEP 4: Check if user already has an active reservation
  IF clean_email IS NOT NULL THEN
    SELECT id INTO existing_reservation_id
    FROM seller_main.coupon_reservations
    WHERE coupon_id = coupon_record.id
      AND customer_email = clean_email
      AND expires_at > NOW();

    IF existing_reservation_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'valid', true,
        'id', coupon_record.id,
        'code', coupon_record.code,
        'discount_type', coupon_record.discount_type,
        'discount_value', coupon_record.discount_value,
        'exclude_order_bumps', coupon_record.exclude_order_bumps,
        'allowed_product_ids', coupon_record.allowed_product_ids,
        'already_reserved', true,
        'reservation_id', existing_reservation_id
      );
    END IF;
  END IF;

  -- STEP 5: Calculate available slots (global limit with reservations)
  IF coupon_record.usage_limit_global IS NOT NULL THEN
    SELECT COUNT(*) INTO reserved_count
    FROM seller_main.coupon_reservations
    WHERE coupon_id = coupon_record.id AND expires_at > NOW();

    available_slots := coupon_record.usage_limit_global
                     - coupon_record.current_usage_count
                     - reserved_count;

    IF available_slots <= 0 THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code usage limit reached');
    END IF;
  END IF;

  -- STEP 6: CREATE RESERVATION (15 minute expiry)
  IF clean_email IS NOT NULL THEN
    INSERT INTO seller_main.coupon_reservations (
      coupon_id,
      customer_email,
      expires_at
    ) VALUES (
      coupon_record.id,
      clean_email,
      NOW() + INTERVAL '15 minutes'
    )
    ON CONFLICT (coupon_id, customer_email) DO UPDATE
    SET expires_at = NOW() + INTERVAL '15 minutes',
        reserved_at = NOW();
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'id', coupon_record.id,
    'code', coupon_record.code,
    'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value,
    'exclude_order_bumps', coupon_record.exclude_order_bumps,
    'allowed_product_ids', coupon_record.allowed_product_ids,
    'reserved', true,
    'expires_in_minutes', 15
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
