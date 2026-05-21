-- ============================================================================
-- check_rate_limit: optional per-identifier scope (DRY refactor)
-- ============================================================================
--
-- Previously every caller of check_rate_limit() shared a single counter per
-- function_name, keyed by the caller's user_id || inet_client_addr(). For
-- functions where "the thing being checked" is a parameter (coupon code,
-- product slug, email, etc.), this collapses unrelated attackers into the
-- same bucket — one bad actor can DoS legitimate verification of every
-- other instance of the same operation.
--
-- This refactor adds an optional 4th argument `identifier_param TEXT`.
-- When supplied, it overrides the default user_id derivation so each
-- distinct identifier value gets its own bucket. When NULL (the default),
-- behavior is exactly as before — every existing caller stays correct
-- without any change at the call site.
--
-- Single source of truth: there is now ONE rate-limit primitive in the DB.
-- Future callers that need per-thing limits opt in with one argument,
-- not with string-concat workarounds inside their own function body.
--
-- Verifies M2 from blind pentest 2026-05-20: verify_coupon uses the new
-- argument to scope rate limits per coupon code.
-- ============================================================================

-- Drop the original 3-arg signature so the 4-arg replacement does not end
-- up as a parallel overload (PostgREST + plpgsql calls without explicit
-- types would otherwise raise "function is not unique").
DROP FUNCTION IF EXISTS public.check_rate_limit(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION check_rate_limit(
    function_name_param TEXT,
    max_calls INTEGER DEFAULT 100,
    time_window_seconds INTEGER DEFAULT 3600,
    identifier_param TEXT DEFAULT NULL
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
    IF function_name_param IS NULL OR length(function_name_param) = 0 OR length(function_name_param) > 100 THEN
        RETURN FALSE;
    END IF;

    IF identifier_param IS NOT NULL AND length(identifier_param) > 200 THEN
        RETURN FALSE;
    END IF;

    window_start_param := date_trunc('hour', NOW()) +
                   INTERVAL '1 second' * (FLOOR(EXTRACT(EPOCH FROM NOW() - date_trunc('hour', NOW())) / time_window_seconds) * time_window_seconds);

    -- New per-identifier mode: caller-supplied identifier overrides default
    -- user_id derivation. Skips global-anon backup check because the
    -- identifier itself partitions attackers.
    IF identifier_param IS NOT NULL AND length(identifier_param) > 0 THEN
        current_user_id := md5('id:' || identifier_param || ':' || function_name_param)::uuid;
    ELSE
        current_user_id := auth.uid();

        IF current_user_id IS NULL THEN
            client_ip := COALESCE(
                inet_client_addr()::text,
                'conn_' || pg_backend_pid()::text || '_' || extract(epoch from NOW())::bigint::text
            );

            rate_limit_key := 'anon_conn_' ||
                             regexp_replace(client_ip, '[^0-9.]', '', 'g') || '_' ||
                             function_name_param;

            IF current_setting('request.jwt.claims', true) != '' THEN
                rate_limit_key := rate_limit_key || '_' ||
                                 COALESCE(
                                     current_setting('request.jwt.claims', true)::jsonb->>'sub',
                                     current_setting('request.jwt.claims', true)::jsonb->>'aud',
                                     'no_jwt'
                                 );
            ELSE
                rate_limit_key := rate_limit_key || '_bucket_' ||
                                 FLOOR(extract(epoch from NOW()) / 300)::text;
            END IF;

            current_user_id := (md5(rate_limit_key)::uuid);

            backup_rate_limit_key := 'global_anon_' || function_name_param;

            INSERT INTO public.rate_limits (user_id, function_name, window_start, call_count)
            VALUES (
                (md5(backup_rate_limit_key)::uuid),
                'global_' || function_name_param,
                window_start_param,
                1
            )
            ON CONFLICT (user_id, function_name, window_start)
            DO UPDATE SET
                call_count = rate_limits.call_count + 1,
                updated_at = NOW()
            RETURNING rate_limits.call_count INTO backup_count;
            IF backup_count > GREATEST(10, max_calls * 2) THEN
                RETURN FALSE;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.rate_limits (user_id, function_name, window_start, call_count)
    VALUES (current_user_id, function_name_param, window_start_param, 1)
    ON CONFLICT (user_id, function_name, window_start)
    DO UPDATE SET
        call_count = rate_limits.call_count + 1,
        updated_at = NOW()
    RETURNING rate_limits.call_count INTO current_count;

    RETURN current_count <= max_calls;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Preserve existing grants (REVOKE/GRANT idempotent)
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, TEXT) TO service_role;

-- ===== verify_coupon: opt in to per-identifier rate limit =====
-- Layer 1 (per-code, 5/min): spam on one code doesn't affect others
-- Layer 2 (global, 100/min): caps namespace enumeration
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
  IF code_param IS NOT NULL AND length(code_param) > 0 THEN
    IF NOT public.check_rate_limit(
      'verify_coupon', 5, 60,
      'code:' || lower(left(code_param, 80))
    ) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
    END IF;
  END IF;

  IF NOT public.check_rate_limit('verify_coupon', 100, 60) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
  END IF;

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

  DELETE FROM seller_main.coupon_reservations WHERE expires_at < NOW();

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

  IF clean_email IS NOT NULL THEN
    SELECT COUNT(*) INTO user_usage_count
    FROM seller_main.coupon_redemptions
    WHERE coupon_id = coupon_record.id AND customer_email = clean_email;

    IF user_usage_count >= coupon_record.usage_limit_per_user THEN
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this code');
    END IF;
  END IF;

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
