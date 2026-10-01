-- Narrows who may read and write shop-level data and keeps shared counters
-- per caller. Each section is independent; see the comment above it.

-- ===== Embed settings: managed by the shop admin =====

-- The embed allowlist is shop configuration. It is written by the service
-- role (admin tooling); signed-in admins may read it.
DROP POLICY IF EXISTS seller_embed_settings_owner_or_admin_all ON public.seller_embed_settings;
DROP POLICY IF EXISTS seller_embed_settings_admin_read ON public.seller_embed_settings;
CREATE POLICY seller_embed_settings_admin_read
  ON public.seller_embed_settings
  FOR SELECT
  TO authenticated
  USING ((select public.is_admin()));

REVOKE ALL ON public.seller_embed_settings FROM anon, authenticated;
GRANT SELECT ON public.seller_embed_settings TO authenticated;
GRANT ALL ON public.seller_embed_settings TO service_role;

-- Rows of users who are neither an admin nor the seller of any product are
-- never consulted; drop them.
DELETE FROM public.seller_embed_settings s
WHERE NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = s.seller_id)
  AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.seller_id = s.seller_id);

-- Single-admin installs: products created before seller_id was set on create
-- belong to that admin.
UPDATE public.products
SET seller_id = (SELECT a.user_id FROM public.admin_users a)
WHERE seller_id IS NULL
  AND (SELECT count(*) FROM public.admin_users) = 1;

-- ===== Products: column-level read for anon and authenticated =====

-- Storefront and buyer reads select only catalog columns. Delivered content
-- (content_config) and admin-only settings are read with the service role
-- after access has been confirmed. Keep this list in sync with
-- PRODUCT_PUBLIC_COLUMNS (admin-panel/src/lib/product-columns.ts).
REVOKE SELECT ON public.products FROM anon, authenticated;
GRANT SELECT (
  id,
  name,
  slug,
  description,
  long_description,
  icon,
  image_url,
  thumbnail_url,
  preview_video_url,
  preview_video_config,
  price,
  currency,
  vat_rate,
  price_includes_vat,
  vat_exempt,
  vat_exempt_note,
  features,
  layout_template,
  checkout_template,
  custom_checkout_fields,
  is_active,
  is_featured,
  is_listed,
  is_bundle,
  available_from,
  available_until,
  auto_grant_duration_days,
  content_delivery_type,
  success_redirect_url,
  pass_params_to_redirect,
  is_refundable,
  refund_period_days,
  enable_waitlist,
  allow_custom_price,
  custom_price_min,
  show_price_presets,
  custom_price_presets,
  omnibus_exempt,
  sale_price,
  sale_price_until,
  sale_quantity_limit,
  sale_quantity_sold,
  product_type,
  billing_interval,
  billing_interval_count,
  recurring_price,
  trial_days,
  stripe_price_id,
  seller_id,
  issue_license_on_purchase,
  license_duration_days,
  created_at,
  updated_at
) ON public.products TO anon, authenticated;

-- ===== Rate limits: count end users only =====

-- Calls without a request JWT come from the database itself (triggers fired
-- by the auth server, cron jobs) and service-role calls come from the Sellf
-- server, which applies its own per-client limits (check_application_rate_limit
-- keyed by the client IP). Neither is an end user, so neither is counted.
-- Signed-in users get a bucket per user. Anonymous PostgREST callers cannot be
-- told apart inside the database (the connection comes from PostgREST), so
-- they share one bucket per function: a ceiling on direct anonymous RPC use.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    function_name_param TEXT,
    max_calls INTEGER DEFAULT 100,
    time_window_seconds INTEGER DEFAULT 3600,
    identifier_param TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    bucket_id UUID;
    window_start_param TIMESTAMPTZ;
    current_count INTEGER;
BEGIN
    IF function_name_param IS NULL OR length(function_name_param) = 0 OR length(function_name_param) > 100 THEN
        RETURN FALSE;
    END IF;

    IF identifier_param IS NOT NULL AND length(identifier_param) > 200 THEN
        RETURN FALSE;
    END IF;

    IF COALESCE(current_setting('request.jwt.claims', true), '') = ''
       OR (select auth.role()) = 'service_role' THEN
        RETURN TRUE;
    END IF;

    window_start_param := date_trunc('hour', NOW()) +
                   INTERVAL '1 second' * (FLOOR(EXTRACT(EPOCH FROM NOW() - date_trunc('hour', NOW())) / time_window_seconds) * time_window_seconds);

    IF identifier_param IS NOT NULL AND length(identifier_param) > 0 THEN
        bucket_id := md5('id:' || identifier_param || ':' || function_name_param)::uuid;
    ELSE
        bucket_id := COALESCE(
            (select auth.uid()),
            md5('anon:' || function_name_param)::uuid
        );
    END IF;

    INSERT INTO public.rate_limits (user_id, function_name, window_start, call_count)
    VALUES (bucket_id, function_name_param, window_start_param, 1)
    ON CONFLICT (user_id, function_name, window_start)
    DO UPDATE SET
        call_count = public.rate_limits.call_count + 1,
        updated_at = NOW()
    RETURNING public.rate_limits.call_count INTO current_count;

    RETURN current_count <= max_calls;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_coupon(
  code_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT DEFAULT NULL,
  currency_param TEXT DEFAULT 'USD'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  coupon_record RECORD;
  user_usage_count INTEGER;
  reserved_count INTEGER;
  available_slots INTEGER;
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

  -- Per code and per customer (signed-in user, else the e-mail), then per caller.
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
    INSERT INTO public.coupon_reservations (
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
$$;

-- ===== Auto-apply coupon lookup =====

-- Signed-in callers are matched by their account e-mail; the e-mail argument
-- is used only by the server (service role), which looks guests up after its
-- own per-client limit. Anonymous clients cannot call it directly.
CREATE OR REPLACE FUNCTION public.find_auto_apply_coupon(
  customer_email_param TEXT,
  product_id_param UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  coupon_record RECORD;
  lookup_email TEXT;
BEGIN
  IF (select auth.role()) = 'service_role' THEN
    lookup_email := lower(trim(customer_email_param));
  ELSIF (select auth.uid()) IS NOT NULL THEN
    SELECT lower(u.email) INTO lookup_email
    FROM auth.users u
    WHERE u.id = (select auth.uid());
  END IF;

  IF lookup_email IS NULL OR lookup_email = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF NOT public.check_rate_limit('find_auto_apply_coupon', 30, 60) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Keep lookup consistent with verify_coupon by ignoring expired reservations.
  DELETE FROM public.coupon_reservations
  WHERE expires_at < NOW();

  SELECT * INTO coupon_record
  FROM public.coupons c
  WHERE c.is_active = true
    AND (c.allowed_emails @> to_jsonb(lookup_email))
    AND (
      jsonb_array_length(c.allowed_product_ids) = 0 OR
      c.allowed_product_ids @> to_jsonb(product_id_param)
    )
    AND (c.expires_at IS NULL OR c.expires_at > NOW())
    AND (c.starts_at <= NOW())
    AND (
      c.usage_limit_global IS NULL OR
      (
        c.current_usage_count + (
          SELECT COUNT(*)
          FROM public.coupon_reservations r
          WHERE r.coupon_id = c.id
            AND r.expires_at > NOW()
        )
      ) < c.usage_limit_global
    )
    AND (
      c.usage_limit_per_user IS NULL OR
      (
        SELECT COUNT(*)
        FROM public.coupon_redemptions cr
        WHERE cr.coupon_id = c.id
          AND cr.customer_email = lookup_email
      ) < c.usage_limit_per_user
    )
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'code', coupon_record.code,
    'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value,
    'exclude_order_bumps', coupon_record.exclude_order_bumps
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_auto_apply_coupon(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_auto_apply_coupon(TEXT, UUID) TO authenticated, service_role;

-- ===== Refund requests: created only through create_refund_request =====

-- The function prices the request from the transaction; customers do not
-- write refund_requests rows directly. Admin processing runs as service role.
DROP POLICY IF EXISTS "Users can create refund requests" ON public.refund_requests;
DROP POLICY IF EXISTS "Admins can update refund requests" ON public.refund_requests;
REVOKE INSERT, UPDATE, DELETE ON public.refund_requests FROM anon, authenticated;
GRANT ALL ON public.refund_requests TO service_role;

CREATE OR REPLACE FUNCTION public.check_refund_eligibility(transaction_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
 SET statement_timeout TO '5s'
AS $$
DECLARE
    transaction_record RECORD;
    days_since_purchase INTEGER;
    existing_request RECORD;
    is_service BOOLEAN;
BEGIN
    is_service := (select auth.role()) = 'service_role';

    IF NOT is_service AND NOT public.check_rate_limit('check_refund_eligibility', 60, 3600) THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'rate_limited');
    END IF;

    -- Get transaction details with product info. Customers only see their own
    -- purchases; anything else reads as not found.
    SELECT pt.*, p.is_refundable, p.refund_period_days, p.name as product_name
    INTO transaction_record
    FROM public.payment_transactions pt
    JOIN public.products p ON pt.product_id = p.id
    WHERE pt.id = transaction_id_param
      AND (is_service OR (
        (select auth.uid()) IS NOT NULL
        AND pt.user_id IS NOT DISTINCT FROM (select auth.uid())
      ));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'transaction_not_found');
    END IF;

    IF transaction_record.status = 'refunded' THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'already_refunded');
    END IF;

    IF NOT transaction_record.is_refundable THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'product_not_refundable');
    END IF;

    -- Check for existing pending request
    SELECT * INTO existing_request
    FROM public.refund_requests
    WHERE refund_requests.transaction_id = transaction_id_param
      AND status IN ('pending', 'approved');

    IF FOUND THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'reason', 'request_already_exists',
            'existing_request_id', existing_request.id,
            'existing_request_status', existing_request.status
        );
    END IF;

    -- Calculate days since purchase
    days_since_purchase := EXTRACT(DAY FROM NOW() - transaction_record.created_at);

    -- Check refund period
    IF transaction_record.refund_period_days IS NOT NULL AND
       days_since_purchase > transaction_record.refund_period_days THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'reason', 'refund_period_expired',
            'refund_period_days', transaction_record.refund_period_days,
            'days_since_purchase', days_since_purchase
        );
    END IF;

    -- Transaction is eligible
    RETURN jsonb_build_object(
        'eligible', true,
        'transaction_id', transaction_record.id,
        'product_name', transaction_record.product_name,
        'amount', transaction_record.amount,
        'currency', transaction_record.currency,
        'refund_period_days', transaction_record.refund_period_days,
        'days_since_purchase', days_since_purchase,
        'days_remaining', CASE
            WHEN transaction_record.refund_period_days IS NOT NULL
            THEN transaction_record.refund_period_days - days_since_purchase
            ELSE NULL
        END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_refund_request(transaction_id_param uuid, reason_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
 SET statement_timeout TO '10s'
AS $$
DECLARE
    current_user_id UUID;
    transaction_record RECORD;
    eligibility JSONB;
    new_request_id UUID;
BEGIN
    -- Rate limiting
    IF NOT public.check_rate_limit('create_refund_request', 10, 3600) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded. Please try again later.');
    END IF;

    current_user_id := auth.uid();

    IF current_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    -- Check eligibility first
    eligibility := public.check_refund_eligibility(transaction_id_param);

    IF NOT (eligibility->>'eligible')::boolean THEN
        RETURN jsonb_build_object('success', false, 'error', eligibility->>'reason', 'details', eligibility);
    END IF;

    -- Get transaction for ownership check
    SELECT pt.*, p.name as product_name
    INTO transaction_record
    FROM public.payment_transactions pt
    JOIN public.products p ON pt.product_id = p.id
    WHERE pt.id = transaction_id_param;

    -- Verify ownership
    IF NOT FOUND OR transaction_record.user_id IS DISTINCT FROM current_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You can only request refunds for your own purchases');
    END IF;

    -- Create the refund request
    INSERT INTO public.refund_requests (
        transaction_id, user_id, customer_email, product_id, reason,
        requested_amount, currency, status
    ) VALUES (
        transaction_id_param, current_user_id, transaction_record.customer_email,
        transaction_record.product_id, reason_param,
        transaction_record.amount - COALESCE(transaction_record.refunded_amount, 0),
        transaction_record.currency, 'pending'
    )
    RETURNING id INTO new_request_id;

    RETURN jsonb_build_object(
        'success', true,
        'request_id', new_request_id,
        'status', 'pending',
        'message', 'Refund request submitted successfully'
    );

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'A refund request already exists for this transaction');
END;
$$;

-- ===== API keys: revocation ends the rotation window =====

CREATE OR REPLACE FUNCTION public.verify_api_key(p_key_hash text)
 RETURNS TABLE(key_id uuid, admin_user_id uuid, scopes jsonb, rate_limit_per_minute integer, is_valid boolean, rejection_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
DECLARE
  v_key RECORD;
BEGIN
  -- Find the key
  SELECT * INTO v_key
  FROM public.api_keys ak
  WHERE ak.key_hash = p_key_hash;

  -- Key not found
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::UUID, NULL::UUID, NULL::JSONB, NULL::INTEGER,
      false, 'Invalid API key'::TEXT;
    RETURN;
  END IF;

  -- Key was revoked: no grace window applies
  IF v_key.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT
      v_key.id, v_key.admin_user_id, v_key.scopes, v_key.rate_limit_per_minute,
      false, 'API key has been revoked'::TEXT;
    RETURN;
  END IF;

  -- Key is not active
  IF NOT v_key.is_active THEN
    -- Check if it's in rotation grace period
    IF v_key.rotation_grace_until IS NOT NULL AND v_key.rotation_grace_until > NOW() THEN
      -- Still in grace period, allow
    ELSE
      RETURN QUERY SELECT
        v_key.id, v_key.admin_user_id, v_key.scopes, v_key.rate_limit_per_minute,
        false, 'API key has been revoked'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Key has expired
  IF v_key.expires_at IS NOT NULL AND v_key.expires_at < NOW() THEN
    RETURN QUERY SELECT
      v_key.id, v_key.admin_user_id, v_key.scopes, v_key.rate_limit_per_minute,
      false, 'API key has expired'::TEXT;
    RETURN;
  END IF;

  -- Update usage stats (non-blocking)
  UPDATE public.api_keys
  SET
    last_used_at = NOW(),
    usage_count = usage_count + 1
  WHERE id = v_key.id;

  -- Key is valid
  RETURN QUERY SELECT
    v_key.id, v_key.admin_user_id, v_key.scopes, v_key.rate_limit_per_minute,
    true, NULL::TEXT;
END;
$$;

-- Revoked keys keep no rotation window.
UPDATE public.api_keys SET rotation_grace_until = NULL
WHERE revoked_at IS NOT NULL AND rotation_grace_until IS NOT NULL;

-- ===== Free grants: one-time products inside their sales window =====

CREATE OR REPLACE FUNCTION public.is_free_grantable_now(
  p_product_type TEXT,
  p_available_from TIMESTAMPTZ,
  p_available_until TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_product_type = 'one_time'
     AND (p_available_from IS NULL OR p_available_from <= NOW())
     AND (p_available_until IS NULL OR p_available_until >= NOW());
$$;

REVOKE ALL ON FUNCTION public.is_free_grantable_now(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_free_grantable_now(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- Same rules for products queued by e-mail (pending free grants).
CREATE OR REPLACE FUNCTION public.is_free_claimable_product(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.is_active
      AND (p.price = 0 OR (p.allow_custom_price AND p.custom_price_min = 0))
      AND public.is_free_grantable_now(p.product_type, p.available_from, p.available_until)
  );
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
    clean_slug TEXT;
    clean_coupon TEXT;
    coupon_result JSONB;
    v_coupon_id UUID;
    v_discount_type TEXT;
    v_discount_value NUMERIC;
    v_user_email TEXT;
    eligible BOOLEAN := FALSE;
    v_component_id UUID;
BEGIN
    -- Input validation and sanitization
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

    -- Authenticated user is mandatory
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Fetch user email (needed for coupon validation + redemption row)
    SELECT email INTO v_user_email FROM auth.users WHERE id = current_user_id;

    -- Fetch product (no price filter here — eligibility is decided below)
    SELECT id, price, currency, allow_custom_price, custom_price_min, auto_grant_duration_days, is_active,
           product_type, available_from, available_until, is_bundle
      INTO product_record
      FROM public.products
      WHERE slug = clean_slug;

    IF NOT FOUND OR NOT product_record.is_active THEN
        RETURN FALSE;
    END IF;

    -- New grants only for one-time products inside their sales window. Access
    -- the user already holds is still confirmed further down.
    IF NOT public.is_free_grantable_now(product_record.product_type, product_record.available_from, product_record.available_until)
       AND NOT EXISTS (
         SELECT 1 FROM public.user_product_access upa
         WHERE upa.user_id = current_user_id
           AND upa.product_id = product_record.id
           AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW())
       ) THEN
        RETURN FALSE;
    END IF;

    -- -----------------------------------------------------------------------
    -- Eligibility (three branches):
    --   1. Coupon path: valid full-discount coupon on a paid product → OK
    --   2. Regular free: price = 0 → OK
    --   3. PWYW-free: allow_custom_price AND custom_price_min = 0 → OK
    --   Otherwise: reject.
    -- -----------------------------------------------------------------------
    IF coupon_code_param IS NOT NULL THEN
        clean_coupon := regexp_replace(upper(coupon_code_param), '[^A-Z0-9_-]', '', 'g');
        IF length(clean_coupon) = 0 THEN
            RETURN FALSE;
        END IF;

        -- Reuse verify_coupon (shared with the Stripe paid flow) for all the checks:
        -- active, starts_at/expires_at, currency, allowed_products, allowed_emails,
        -- usage_limit_global, usage_limit_per_user. Single source of truth for coupon rules.
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

        -- Only full-discount coupons qualify for the free-access path.
        -- Partial discounts must go through the Stripe paid flow.
        IF v_discount_type = 'percentage' AND v_discount_value >= 100 THEN
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

    -- Early return if the user already has active (non-expired) access.
    -- No side effects (no redemption recorded on repeat clicks).
    PERFORM 1 FROM public.user_product_access upa
    WHERE upa.user_id = current_user_id
      AND upa.product_id = product_record.id
      AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW());
    IF FOUND THEN
        RETURN TRUE;
    END IF;

    -- Rate limiting: 20 calls per hour (prevents DB spam for expired/new access grants)
    IF NOT public.check_rate_limit('grant_free_product_access'::TEXT, 20, 3600) THEN
        RETURN FALSE;
    END IF;

    -- Cap user-supplied duration to product config (prevent exceeding intended access window)
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

    -- A bundle brings its components, as in the paid flow.
    IF product_record.is_bundle THEN
        FOR v_component_id IN
            SELECT bi.component_product_id FROM public.bundle_items bi
            WHERE bi.bundle_product_id = product_record.id
            ORDER BY bi.display_order
        LOOP
            PERFORM public.grant_bundle_component_access(current_user_id, v_component_id);
        END LOOP;
    END IF;

    -- Coupon side effects run in the same transaction: if anything here fails,
    -- the grant above is rolled back, guaranteeing no partial state
    -- (e.g. access without a redemption row, or bumped counter without access).
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

        -- Clear any reservation verify_coupon created (idempotent — no-op if absent)
        DELETE FROM public.coupon_reservations
         WHERE coupon_id = v_coupon_id
           AND customer_email = v_user_email;
    END IF;

    RETURN TRUE;
END;
$$;

-- ===== Video progress: only for products the user can access =====

CREATE OR REPLACE FUNCTION public.update_video_progress(product_id_param uuid, video_id_param text, position_param integer, duration_param integer DEFAULT NULL::integer, completed_param boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  progress_record RECORD;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF video_id_param IS NULL OR length(video_id_param) = 0 OR length(video_id_param) > 200 THEN
    RAISE EXCEPTION 'Invalid video id';
  END IF;

  IF NOT (select public.is_admin()) AND NOT EXISTS (
    SELECT 1 FROM public.user_product_access upa
    WHERE upa.user_id = current_user_id
      AND upa.product_id = product_id_param
      AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'No access to this product';
  END IF;

  INSERT INTO public.video_progress (
    user_id, product_id, video_id, last_position_seconds,
    max_position_seconds, video_duration_seconds, is_completed
  ) VALUES (
    current_user_id, product_id_param, video_id_param, position_param,
    position_param, duration_param, completed_param
  )
  ON CONFLICT (user_id, product_id, video_id) DO UPDATE SET
    last_position_seconds = position_param,
    max_position_seconds = GREATEST(video_progress.max_position_seconds, position_param),
    video_duration_seconds = COALESCE(duration_param, video_progress.video_duration_seconds),
    is_completed = video_progress.is_completed OR completed_param,
    view_count = video_progress.view_count + CASE WHEN position_param = 0 THEN 1 ELSE 0 END,
    updated_at = NOW()
  RETURNING * INTO progress_record;

  RETURN jsonb_build_object(
    'success', true,
    'id', progress_record.id,
    'last_position', progress_record.last_position_seconds,
    'is_completed', progress_record.is_completed
  );
END;
$$;

-- ===== Scheduled maintenance =====

-- Housekeeping that had functions but no schedule.
SELECT cron.schedule(
  'cleanup-application-rate-limits',
  '15 * * * *',
  'SELECT public.cleanup_application_rate_limits();'
);

SELECT cron.schedule(
  'cleanup-expired-oto-coupons',
  '30 * * * *',
  'SELECT public.cleanup_expired_oto_coupons();'
);

SELECT cron.schedule(
  'mark-expired-pending-payments',
  '*/15 * * * *',
  'SELECT public.mark_expired_pending_payments();'
);

-- Audit log retention: keep 12 months, purge weekly. Guest purchases are
-- intentionally left out of this section — cleanup_old_guest_purchases stays
-- unscheduled because unclaimed guest purchases must be kept indefinitely.
SELECT cron.schedule(
  'cleanup-audit-logs',
  '0 3 * * 0',
  'SELECT public.cleanup_audit_logs(365);'
);

-- ===== Storefront lookups: bounded direct use =====

-- The OTO page looks offers up through the server (per-client limit); direct
-- anonymous calls share one bucket.
CREATE OR REPLACE FUNCTION public.get_oto_coupon_info(coupon_code_param text, email_param text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
DECLARE
  coupon_record RECORD;
  seconds_left INTEGER;
BEGIN
  IF NOT public.check_rate_limit('get_oto_coupon_info', 30, 60) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
  END IF;

  -- Find valid OTO coupon for this email
  SELECT
    c.id,
    c.code,
    c.discount_type,
    c.discount_value,
    c.allowed_product_ids,
    c.exclude_order_bumps,
    c.expires_at,
    o.duration_minutes,
    p.id as product_id,
    p.slug as product_slug,
    p.name as product_name,
    p.price as product_price,
    p.currency as product_currency
  INTO coupon_record
  FROM public.coupons c
  LEFT JOIN public.oto_offers o ON c.oto_offer_id = o.id
  LEFT JOIN public.products p ON o.oto_product_id = p.id
  WHERE c.code = coupon_code_param
    AND c.is_oto_coupon = true
    AND c.is_active = true
    AND c.expires_at > NOW()
    AND c.current_usage_count < COALESCE(c.usage_limit_global, 999999)
    AND c.allowed_emails ? email_param;

  IF coupon_record IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Coupon not found or expired'
    );
  END IF;

  -- Calculate seconds remaining
  seconds_left := GREATEST(0, EXTRACT(EPOCH FROM (coupon_record.expires_at - NOW()))::INTEGER);

  RETURN jsonb_build_object(
    'valid', true,
    'coupon_id', coupon_record.id,
    'code', coupon_record.code,
    'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value,
    'allowed_product_ids', coupon_record.allowed_product_ids,
    'exclude_order_bumps', coupon_record.exclude_order_bumps,
    'expires_at', coupon_record.expires_at,
    'seconds_remaining', seconds_left,
    'duration_minutes', coupon_record.duration_minutes,
    'product', jsonb_build_object(
      'id', coupon_record.product_id,
      'slug', coupon_record.product_slug,
      'name', coupon_record.product_name,
      'price', coupon_record.product_price,
      'currency', coupon_record.product_currency
    )
  );
END;
$$;

-- Waitlist configuration is admin tooling.
CREATE OR REPLACE FUNCTION public.check_waitlist_config()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (select public.is_admin()) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN json_build_object(
    'has_webhook', EXISTS(
      SELECT 1 FROM public.webhook_endpoints
      WHERE 'waitlist.signup' = ANY(events)
        AND is_active = true
    ),
    'products_count', (
      SELECT COUNT(*)::integer
      FROM public.products
      WHERE enable_waitlist = true
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_waitlist_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_waitlist_config() TO authenticated, service_role;

-- ===== API key prefix length =====

-- New keys store a 16-character display prefix (8 hex digits after sf_live_
-- or sf_test_); keys created earlier keep their 12-character prefix.
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_key_prefix_check;
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_key_prefix_check CHECK (length(key_prefix) IN (12, 16));

-- ===== Payment completion: case-insensitive e-mail matching =====

CREATE OR REPLACE FUNCTION public.process_stripe_payment_completion_with_bump(session_id_param text, product_id_param uuid, customer_email_param text, amount_total numeric, currency_param text, stripe_payment_intent_id text DEFAULT NULL::text, user_id_param uuid DEFAULT NULL::uuid, bump_product_ids_param uuid[] DEFAULT NULL::uuid[], coupon_id_param uuid DEFAULT NULL::uuid, amount_subtotal_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
DECLARE
  resolved_sid TEXT;
  pi_param TEXT := stripe_payment_intent_id;
  result JSONB;
BEGIN
  -- One writer per purchase: serialize on the payment-intent (shared by the
  -- cs_/pi_ events and verification); fall back to session id when absent.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(coalesce(pi_param, session_id_param))
  );

  IF pi_param IS NOT NULL THEN
    SELECT pt.session_id INTO resolved_sid
      FROM public.payment_transactions pt
     WHERE pt.stripe_payment_intent_id = pi_param
       AND pt.status <> 'pending'
       AND pt.session_id <> session_id_param
     LIMIT 1;

    IF resolved_sid IS NOT NULL THEN
      session_id_param := resolved_sid;
    END IF;
  END IF;

  -- Accounts, guest purchases and coupon reservations keep e-mails lowercased;
  -- Stripe reports the address as the buyer typed it.
  result := public._process_stripe_payment_completion_with_bump_impl(
    session_id_param, product_id_param, lower(trim(customer_email_param)), amount_total,
    currency_param, stripe_payment_intent_id, user_id_param,
    bump_product_ids_param, coupon_id_param, amount_subtotal_param
  );

  -- Some idempotent re-entry branches in the impl omit already_had_access
  -- (guest re-entry carries the idempotent message; the claimed-logged-in
  -- branch carries only its scenario). Stamp it so callers consistently skip
  -- duplicate side-effects on a second completion of the same purchase.
  IF (result->>'message') = 'Payment already processed (idempotent)'
     OR (result->>'scenario') = 'idempotent_claimed_for_logged_in_user' THEN
    result := result || jsonb_build_object('already_had_access', true);
  END IF;

  RETURN result;
END;
$$;

-- Unclaimed guest purchases recorded with the e-mail as typed.
UPDATE public.guest_purchases
SET customer_email = lower(customer_email)
WHERE claimed_by_user_id IS NULL
  AND customer_email <> lower(customer_email);

-- ===== First admin: only the true first user of the whole installation =====

-- handle_new_user_registration used to promote whoever registered next
-- whenever admin_users was empty -- including right after the last admin
-- was removed, even though the installation already had other registered
-- users. Promotion is now scoped to the genuinely first user ever: nobody
-- else exists yet in auth.users. Once that first user is gone, nobody gets
-- auto-promoted again; restore admin access with a service-role insert into
-- admin_users instead.
CREATE OR REPLACE FUNCTION public.handle_new_user_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claim_result JSON;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('handle_new_user_registration'));

  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.admin_users (user_id)
  SELECT NEW.id WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id <> NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_guest_purchases_for_user' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    SELECT public.claim_guest_purchases_for_user(NEW.id) INTO claim_result;
  END IF;

  -- Migrate payment data from guest purchases to profile
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'migrate_guest_payment_data_to_profile' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    PERFORM public.migrate_guest_payment_data_to_profile(NEW.id);
  END IF;

  PERFORM public.log_audit_entry('auth.users', 'INSERT', NULL, jsonb_build_object('email', NEW.email), NEW.id);
  RETURN NEW;
END;
$$;

-- ===== Login wall nonce ledger: remove =====

-- Nothing ever read public.loginwall_tokens back after a token was issued —
-- it recorded a nonce per issued login-wall token but had no server-side
-- single-use check consuming it. Drop the ledger, its cleanup job, and its
-- cleanup function along with it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-loginwall-tokens') THEN
    PERFORM cron.unschedule('cleanup-loginwall-tokens');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.cleanup_loginwall_tokens();
DROP TABLE IF EXISTS public.loginwall_tokens;

-- ===== Legacy single-bump payment completion: remove =====

-- Superseded by process_stripe_payment_completion_with_bump, which the
-- webhook handler and every payment flow call instead. Nothing else calls
-- this signature (verified against pg_depend, triggers, and every function
-- body in the live database).
DROP FUNCTION IF EXISTS public.process_stripe_payment_completion(
  text, uuid, text, numeric, text, text, uuid
);

-- ===== Dead table grants: authenticated never had a matching policy =====

-- api_key_audit_log: only a SELECT policy exists for authenticated (admins
-- reading logs for their own keys). The INSERT grant from the original
-- migration has no matching policy, so it can never succeed for that role —
-- every write to this table goes through the service-role client instead.
REVOKE INSERT ON public.api_key_audit_log FROM authenticated;

-- guest_purchases: only service_role has a DELETE policy. The DELETE grant
-- to authenticated has no matching policy — access revocation always runs
-- through an admin/service-role client (see revokeTransactionAccess).
REVOKE DELETE ON public.guest_purchases FROM authenticated;

-- ===== Meta CAPI token: encrypted at rest =====

-- The Conversions API access token moves to AES-256-GCM ciphertext columns,
-- the same scheme as the GUS and Currency API keys in this table. The key
-- (APP_ENCRYPTION_KEY) lives only in the app, so this migration cannot encrypt
-- an existing value. The legacy plaintext column stays and keeps working: the
-- app reads it as a fallback and converts it in place (ciphertext written and
-- plaintext cleared by one UPDATE) at server start and on the first tracking
-- read. No database function reads the token.
ALTER TABLE public.integrations_config
  ADD COLUMN IF NOT EXISTS facebook_capi_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS facebook_capi_token_iv TEXT,
  ADD COLUMN IF NOT EXISTS facebook_capi_token_tag TEXT;

ALTER TABLE public.integrations_config
  DROP CONSTRAINT IF EXISTS integrations_config_capi_token_encryption_complete;
ALTER TABLE public.integrations_config
  ADD CONSTRAINT integrations_config_capi_token_encryption_complete CHECK (
    (facebook_capi_token_encrypted IS NULL AND facebook_capi_token_iv IS NULL AND facebook_capi_token_tag IS NULL)
    OR (facebook_capi_token_encrypted IS NOT NULL AND facebook_capi_token_iv IS NOT NULL AND facebook_capi_token_tag IS NOT NULL)
  );

COMMENT ON COLUMN public.integrations_config.facebook_capi_token IS
  'Legacy plaintext Meta CAPI token. New saves leave it NULL; a remaining value is converted to the encrypted columns by the app.';
COMMENT ON COLUMN public.integrations_config.facebook_capi_token_encrypted IS
  'AES-256-GCM encrypted Meta CAPI access token (base64 encoded)';
COMMENT ON COLUMN public.integrations_config.facebook_capi_token_iv IS
  'Initialization vector for Meta CAPI token decryption (base64 encoded)';
COMMENT ON COLUMN public.integrations_config.facebook_capi_token_tag IS
  'Authentication tag for Meta CAPI token decryption (base64 encoded)';

-- ===== API keys: payments endpoints require their own scope =====

-- The payments list/detail/export endpoints used to accept analytics:read as
-- a stand-in for payments:read (kept for keys issued before payments:read
-- existed). That fallback is now removed from the application code, so any
-- existing key that relied on analytics:read alone for those endpoints would
-- lose access. Grant it payments:read directly so it keeps working. `scopes`
-- is jsonb; idempotent because a key that already has payments:read (or the
-- expanded wildcard set) no longer matches the WHERE clause.
UPDATE public.api_keys
SET scopes = scopes || '["payments:read"]'::jsonb
WHERE scopes @> '["analytics:read"]'::jsonb
  AND NOT scopes @> '["payments:read"]'::jsonb
  AND NOT scopes @> '["*"]'::jsonb;

-- ===== API key audit log: cover the remaining lifecycle events =====

-- Only key rotation recorded an audit event; creation, revocation, and
-- enable/disable toggles left no trace. The application now writes those
-- events too, so the event-type list needs the two new values it uses.
ALTER TABLE public.api_key_audit_log
  DROP CONSTRAINT IF EXISTS api_key_audit_log_event_type_check;
ALTER TABLE public.api_key_audit_log
  ADD CONSTRAINT api_key_audit_log_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'created'::text,
      'rotated'::text,
      'revoked'::text,
      'deactivated'::text,
      'reactivated'::text,
      'expired'::text,
      'used_after_revoke'::text
    ])
  );

-- ===== Generated legal documents: rendered by Sellf, not linked to storage =====

-- Supabase Storage serves `text/html` objects as `text/plain` (buyers would
-- see raw markup instead of a document), and self-hosted installs often store
-- an internal SUPABASE_URL (e.g. Coolify's `http://kong:8000/...`) that the
-- buyer's browser cannot reach at all. Generated Terms/Privacy documents are
-- now served through `/legal/<type>`, which reads the same stored object with
-- the service-role client and renders it through a sanitizing pipeline (see
-- admin-panel/src/app/[locale]/legal/[type]/page.tsx). Already-published
-- documents do not need to be regenerated — only the stored URL changes; the
-- underlying object and its content are untouched.
--
-- The regex matches only URLs pointing at OUR bucket path, so a URL an admin
-- typed in by hand (any external host) is left untouched. Idempotent: a row
-- already rewritten to '/legal/terms' no longer matches the pattern.
UPDATE public.shop_config
   SET terms_of_service_url = '/legal/terms'
 WHERE terms_of_service_url ~ '/storage/v1/object/public/legal/[0-9a-f-]{36}/terms\.html$';

UPDATE public.shop_config
   SET privacy_policy_url = '/legal/privacy'
 WHERE privacy_policy_url ~ '/storage/v1/object/public/legal/[0-9a-f-]{36}/privacy\.html$';

-- Nothing needs a public URL for this bucket anymore.
UPDATE storage.buckets SET public = false WHERE id = 'legal' AND public = true;

-- ===== Admin list/search: indexes for the server-side filters =====
--
-- The payments, coupons and products admin list endpoints now filter and
-- search on the server (see fetch-transactions-page.ts / fetch-coupons-page.ts
-- and the corresponding /api/v1 routes) instead of loading everything and
-- filtering client-side. Measured with EXPLAIN ANALYZE against a throwaway
-- copy of the real row shapes (50k payment_transactions, 20k coupons with a
-- realistic OTO/regular split, 5k products, 5k refund_requests — inserted and
-- rolled back in the same transaction, never committed) at volumes well past
-- what these tables hold today. Every Seq Scan called out below became an
-- Index Scan / Bitmap Index Scan after the matching index, typically 10-50x
-- faster at that volume.
--
-- Builds are plain (non-CONCURRENT): `apply_migration` runs each file inside
-- a transaction, where CONCURRENTLY is not allowed. At the row counts above
-- these builds took well under a second; the lock is brief.
--
-- Not touched: the admin users list (`user_access_stats` view over
-- `auth.users`) also does a leading-wildcard ILIKE on email, and the same
-- fix (a trigram index) would apply in principle — but `auth.users` is owned
-- by `supabase_auth_admin` and this migration's role cannot create an index
-- on it (confirmed locally: `must be owner of table users`), so it is out of
-- reach from a Sellf migration on both self-hosted and Supabase Cloud.
-- refund_requests.status and .user_id already had covering indexes; only
-- .product_id (also filterable via the API) was missing one.

-- pg_trgm backs every ILIKE '%term%' search below — a plain btree cannot
-- serve a leading-wildcard pattern. Ships in both the Supabase Cloud image
-- and the self-hosted supabase/postgres image, with the `extensions` schema
-- already present in both (verified locally).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Sellf is open source and self-hosted installs vary: some may already have
-- pg_trgm installed in a different schema (commonly `public`, e.g. if it was
-- added by hand before this migration existed). CREATE EXTENSION IF NOT
-- EXISTS is then a no-op, and a hardcoded `extensions.gin_trgm_ops`
-- reference would fail to resolve — aborting the whole migration on
-- upgrade. Look up wherever the extension actually lives and build every
-- trigram index against that schema instead of assuming `extensions`.
DO $$
DECLARE
  trgm_schema text;
BEGIN
  SELECT n.nspname INTO trgm_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF trgm_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm extension not found after CREATE EXTENSION';
  END IF;

  -- payment_transactions: GET /api/v1/payments `search` matches
  -- customer_email, session_id and stripe_payment_intent_id with a leading
  -- wildcard; the existing btree indexes on these columns only serve
  -- exact/prefix lookups. Separate indexes (not a single multi-column one)
  -- so each condition in the `.or()` can use its own, combined by a
  -- BitmapOr — matches what EXPLAIN chose once these existed.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_payment_transactions_customer_email_trgm ON public.payment_transactions USING gin (customer_email %I.gin_trgm_ops)',
    trgm_schema);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_payment_transactions_session_id_trgm ON public.payment_transactions USING gin (session_id %I.gin_trgm_ops)',
    trgm_schema);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_payment_transactions_stripe_payment_intent_id_trgm ON public.payment_transactions USING gin (stripe_payment_intent_id %I.gin_trgm_ops)',
    trgm_schema);

  -- coupons: GET /api/v1/coupons `search` matches code and name with a
  -- leading wildcard.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_coupons_code_trgm ON public.coupons USING gin (code %I.gin_trgm_ops)',
    trgm_schema);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_coupons_name_trgm ON public.coupons USING gin (name %I.gin_trgm_ops)',
    trgm_schema);

  -- products: GET /api/v1/products `search` matches name and description
  -- with a leading wildcard.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name %I.gin_trgm_ops)',
    trgm_schema);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON public.products USING gin (description %I.gin_trgm_ops)',
    trgm_schema);
END
$$;

-- --- payment_transactions: GET /api/v1/payments (search + status/date_from) ---
--
-- (the leading-wildcard search indexes for this table are created in the
-- DO block above, right after CREATE EXTENSION, since their operator class
-- needs pg_trgm's actual install schema resolved at apply time)

-- `status = 'completed'` (the default filter sellers actually use) combined
-- with `created_at >= date_from` had no covering index — the two existing
-- partial (status, created_at) indexes only cover
-- ('pending','abandoned') and ('refunded','disputed'). This fills the two
-- statuses they leave out; 'pending', 'abandoned', 'refunded' and 'disputed'
-- keep using their existing, smaller partial indexes.
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status_created_uncovered
  ON public.payment_transactions (status, created_at DESC)
  WHERE status = ANY (ARRAY['completed'::text, 'partially_refunded'::text]);

-- --- coupons: GET /api/v1/coupons (default order, type/status filters) ---
--
-- (the code/name search indexes for this table are created in the DO block
-- above, right after CREATE EXTENSION, since their operator class needs
-- pg_trgm's actual install schema resolved at apply time)

-- The default list has no filter at all and orders by (created_at DESC, id
-- DESC) — coupons had no index at all on created_at, so every page (and
-- every cursor step) was a full sort of the table.
CREATE INDEX IF NOT EXISTS idx_coupons_created_at
  ON public.coupons (created_at DESC, id DESC);

-- `type=regular` (`is_oto_coupon = false`) — the existing idx_coupons_oto
-- only covers `= true`. Matters most once idx_coupons_created_at exists and
-- regular coupons stop being scattered evenly through time (e.g. a handful
-- of hand-made codes from early on, buried under thousands of newer
-- OTO-auto-generated ones): measured case where the planner's default choice
-- (scan idx_coupons_created_at and filter) degrades because it must walk
-- past every newer OTO row first, and this index gives it a fast path.
CREATE INDEX IF NOT EXISTS idx_coupons_not_oto
  ON public.coupons (is_oto_coupon) WHERE is_oto_coupon = false;

-- `status=expired` (`expires_at IS NOT NULL AND expires_at < now()`) —
-- idx_coupons_oto_expires only covers OTO coupons. Same reasoning as
-- idx_coupons_not_oto: once expired coupons skew toward the older end of
-- created_at, this is the index that keeps the query from walking most of
-- the table.
CREATE INDEX IF NOT EXISTS idx_coupons_expires_at
  ON public.coupons (expires_at) WHERE expires_at IS NOT NULL;

-- --- products: GET /api/v1/products (search) ---
--
-- (the name/description search indexes for this table are created in the
-- DO block above, right after CREATE EXTENSION, since their operator class
-- needs pg_trgm's actual install schema resolved at apply time)

-- --- refund_requests: GET /api/v1/refund-requests (product_id filter) ---

-- .status and .user_id already had covering indexes; .product_id (also a
-- supported filter on this endpoint) did not.
CREATE INDEX IF NOT EXISTS idx_refund_requests_product_id
  ON public.refund_requests (product_id);

-- ===== Account deletion: keep records, drop the dangling reference =====
--
-- Deleting a user from Supabase Auth (dashboard "Delete user", or
-- `auth.admin.deleteUser`) failed for every user who had ever signed up:
-- `handle_new_user_registration()` writes one `audit_log` row per signup, and
-- `audit_log.user_id` / `.performed_by` had delete rule NO ACTION against
-- `auth.users`, so the delete was rejected outright. A few other tables had
-- the opposite problem: `payment_transactions.user_id` and
-- `refund_requests.user_id` were ON DELETE CASCADE, so a delete that DID go
-- through would have taken real financial/refund records down with it.
--
-- Two rules, applied per table below:
--   - Financial / legal records (payments, refunds, price-history compliance
--     snapshots, the signup/action audit trail, license issuance history)
--     are KEPT; the column that pointed at the deleted user is set to NULL
--     instead. All of these already store an independent, sufficient
--     snapshot (amount, e-mail, product, timestamps) for accounting/audit
--     purposes, so nulling the account reference loses no financial detail.
--   - Pure per-account rows (`user_product_access`, `video_progress`,
--     `admin_users`, `stripe_customers`, ...) already cascade and are
--     intentionally left as-is — they disappear with the account, matching
--     ordinary account-deletion behaviour.
--
-- `auth.users` itself is owned by `supabase_auth_admin`; every constraint
-- touched here lives on one of OUR tables (`public.*`), which this
-- migration's role owns, so altering them is allowed. Confirmed locally.
--
-- Re-runnable: each block drops the constraint (if present) and re-adds it,
-- so applying this file twice is a no-op the second time.

-- --- audit_log: the table that made every deletion fail ---
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_performed_by_fkey;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_performed_by_fkey
  FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- --- admin_actions: an admin-action log entry outlives the admin's account ---
ALTER TABLE public.admin_actions DROP CONSTRAINT IF EXISTS admin_actions_admin_id_fkey;
ALTER TABLE public.admin_actions
  ADD CONSTRAINT admin_actions_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- --- payment_transactions: the purchase record is the financial record ---
-- user_id was CASCADE, which would have deleted the whole payment row
-- (amount, product, e-mail) along with the account — the opposite of what
-- accounting retention requires. refunded_by was NO ACTION, which blocked
-- deletion outright for any admin who had ever processed a refund.
ALTER TABLE public.payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_user_id_fkey;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_refunded_by_fkey;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_refunded_by_fkey
  FOREIGN KEY (refunded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- --- refund_requests: same reasoning as payment_transactions above ---
ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_user_id_fkey;
ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_admin_id_fkey;
ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- --- product_price_history: Omnibus Directive compliance snapshots ---
-- These rows exist to prove the lowest price shown in the last 30 days;
-- losing them (or blocking a deletion because of them) is not acceptable.
ALTER TABLE public.product_price_history DROP CONSTRAINT IF EXISTS product_price_history_changed_by_fkey;
ALTER TABLE public.product_price_history
  ADD CONSTRAINT product_price_history_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- --- issued_licenses: license issuance history outlives the seller's account ---
-- seller_id was NOT NULL and CASCADE, so deleting a seller who had ever
-- issued a license silently destroyed every license record they had issued
-- to their buyers. The column must accept NULL before it can be nulled.
ALTER TABLE public.issued_licenses ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE public.issued_licenses DROP CONSTRAINT IF EXISTS issued_licenses_seller_id_fkey;
ALTER TABLE public.issued_licenses
  ADD CONSTRAINT issued_licenses_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ===== Account deletion: subscriptions — block only while Stripe would still
-- charge this person =====
--
-- subscriptions.user_id was NOT NULL / ON DELETE RESTRICT: a subscription is
-- simultaneously a billing record and the mechanism granting ongoing product
-- access, so a user with ANY subscription row (active or long-ended) could
-- never be deleted. Decision: block deletion only while Stripe is currently
-- charging the customer or about to — deleting the Sellf account underneath
-- that would leave Stripe billing someone with no account left to see it,
-- manage it, or get support. Once a subscription has ended, it stays in
-- history with user_id set to NULL, same as the other financial tables above,
-- and the account can be deleted.
--
-- The "still charging" set was read off Stripe's own subscription-status
-- semantics (https://docs.stripe.com/billing/subscriptions/overview and the
-- API reference for the Subscription object — via Context7), not guessed:
--   - trialing  — trial in progress; billing starts automatically at trial end.
--   - active    — in good standing; the subscription is currently billing.
--   - past_due  — the latest invoice failed; Stripe is automatically retrying
--                 the charge on its own schedule.
--   - incomplete — the very first payment is being collected/confirmed right
--                 now (e.g. pending 3DS); a success here would charge a buyer
--                 whose Sellf account no longer exists.
-- Explicitly NOT in the blocking set, because Stripe has already stopped (or
-- never started) attempting to collect for these:
--   - unpaid             — Stripe keeps generating invoices but has given up
--                 attempting to charge them (per Stripe's own docs).
--   - canceled / incomplete_expired — terminal, no further billing ever.
--   - paused             — collection is explicitly halted; no invoices are
--                 generated while paused.
-- This mirrors, and is a superset of, STATUSES_GRANTING_ACCESS /
-- TERMINAL_STATUSES in admin-panel/src/app/api/webhooks/stripe/subscription-handlers.ts
-- (that pair is about access, not billing — past_due/incomplete grant no
-- access but Stripe is still actively trying to charge, so they block here).
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.prevent_delete_user_with_active_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = OLD.id
      AND status IN ('trialing', 'active', 'past_due', 'incomplete')
  ) THEN
    RAISE EXCEPTION 'Cannot delete user: an active Stripe subscription exists for this account. Cancel it in Stripe first, then delete the account.';
  END IF;
  RETURN OLD;
END;
$$;

-- Trigger functions are fired by the DML itself, not called directly, so the
-- triggering role needs no EXECUTE privilege — lock it down (security rule #7).
REVOKE EXECUTE ON FUNCTION public.prevent_delete_user_with_active_subscription() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS prevent_delete_user_with_active_subscription ON auth.users;
CREATE TRIGGER prevent_delete_user_with_active_subscription
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_user_with_active_subscription();

-- ===== Account deletion: seller_license_keys — keep the keypair so an
-- already-issued license keeps verifying after the seller's account is gone =====
--
-- seller_id was NOT NULL / ON DELETE CASCADE: deleting a seller who had ever
-- issued a license destroyed their signing keypair along with the account,
-- even though issued_licenses (above) keeps the issuance history. That left
-- `GET /api/licenses/jwks?seller=<id>` with nothing to return, so a deleted
-- seller's buyers could no longer verify a license they were issued before
-- the deletion. Decision: keep the keys, same "keep with NULL" treatment as
-- every financial/legal table above.
--
-- A license token carries no seller claim (src/lib/license-keys/format.ts) —
-- the buyer's verifier is handed the seller id out of band, once, at
-- issuance, and keeps using it for the life of the license. If seller_id (the
-- live FK) were the only lookup key, nulling it on deletion would silently
-- break every license already issued by that seller. original_seller_id is a
-- plain UUID column with no foreign key — never touched by CASCADE/SET NULL —
-- stamped once at insert time by stamp_original_seller_id() below, so the
-- lookup key a buyer already has keeps working regardless of what happens to
-- the seller's account afterwards. issued_licenses gets the same column and
-- trigger: its seller_id was already switched to nullable/SET NULL above,
-- which would have broken the CRL/revocation lookup
-- (seller_revoked_orders, below) for a deleted seller's buyers the same way.
ALTER TABLE public.seller_license_keys ADD COLUMN IF NOT EXISTS original_seller_id UUID;
UPDATE public.seller_license_keys SET original_seller_id = seller_id WHERE original_seller_id IS NULL;
ALTER TABLE public.seller_license_keys ALTER COLUMN original_seller_id SET NOT NULL;

ALTER TABLE public.seller_license_keys ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE public.seller_license_keys DROP CONSTRAINT IF EXISTS seller_license_keys_seller_id_fkey;
ALTER TABLE public.seller_license_keys
  ADD CONSTRAINT seller_license_keys_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_seller_license_keys_original_seller_id
  ON public.seller_license_keys (original_seller_id);

ALTER TABLE public.issued_licenses ADD COLUMN IF NOT EXISTS original_seller_id UUID;
UPDATE public.issued_licenses SET original_seller_id = seller_id WHERE original_seller_id IS NULL;
ALTER TABLE public.issued_licenses ALTER COLUMN original_seller_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_issued_licenses_original_seller_id
  ON public.issued_licenses (original_seller_id);

CREATE OR REPLACE FUNCTION public.stamp_original_seller_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.original_seller_id IS NULL THEN
    NEW.original_seller_id := NEW.seller_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stamp_original_seller_id() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS seller_license_keys_stamp_original_seller_id ON public.seller_license_keys;
CREATE TRIGGER seller_license_keys_stamp_original_seller_id
  BEFORE INSERT ON public.seller_license_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_original_seller_id();

DROP TRIGGER IF EXISTS issued_licenses_stamp_original_seller_id ON public.issued_licenses;
CREATE TRIGGER issued_licenses_stamp_original_seller_id
  BEFORE INSERT ON public.issued_licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_original_seller_id();

-- Public-key + CRL lookups resolve by the permanent original_seller_id now,
-- so a deleted seller's buyers keep verifying/checking revocation for
-- licenses issued before the deletion. Same signature as before (CREATE OR
-- REPLACE only, no DROP) — existing grants are untouched.
CREATE OR REPLACE FUNCTION public.seller_license_public_keys(seller UUID)
RETURNS TABLE (kid TEXT, public_key TEXT, alg TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT k.kid, k.public_key, k.alg
  FROM public.seller_license_keys k
  WHERE k.original_seller_id = seller AND k.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.seller_revoked_orders(seller UUID, hash_prefix TEXT)
RETURNS TABLE (order_hash TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT h.order_hash
  FROM public.issued_licenses l
  CROSS JOIN LATERAL (
    SELECT encode(extensions.digest(convert_to(l.order_id, 'UTF8'), 'sha256'), 'hex') AS order_hash
  ) h
  WHERE l.original_seller_id = seller
    AND l.revoked_at IS NOT NULL
    -- Defense in depth: reject anything but a hex prefix so a wildcard ('%','_') can never
    -- widen the bucket to the whole list. A non-hex prefix simply matches nothing.
    AND hash_prefix ~ '^[0-9a-f]{1,64}$'
    AND h.order_hash LIKE hash_prefix || '%';
$$;
