-- Unified free-access grant: one RPC handles price=0, PWYW-free, and 100%-coupon paths.
--
-- History:
--   - Original grant_free_product_access (core schema) accepted only price=0.
--   - grant_pwyw_free_access (20260225131105) added PWYW-free support as a separate RPC.
--   - This migration (originally the rate-limit hardening pass) is now the authority:
--     * consolidates both RPCs into a single atomic function,
--     * adds 100%-coupon support (paid products become grantable with a full-discount coupon),
--     * records coupon_redemptions + bumps the global usage counter + clears any reservation
--       in the same transaction as the access grant — so the three effects never drift apart,
--     * keeps rate limiting at 20 calls/hour (prevents DB spam).

-- Drop both legacy signatures so the CREATE below is unambiguous.
DROP FUNCTION IF EXISTS seller_main.grant_pwyw_free_access(TEXT, INTEGER);
DROP FUNCTION IF EXISTS seller_main.grant_free_product_access(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION seller_main.grant_free_product_access(
    product_slug_param TEXT,
    access_duration_days_param INTEGER DEFAULT NULL,
    coupon_code_param TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
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
    SELECT id, price, currency, allow_custom_price, custom_price_min, auto_grant_duration_days, is_active
      INTO product_record
      FROM seller_main.products
      WHERE slug = clean_slug;

    IF NOT FOUND OR NOT product_record.is_active THEN
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
        coupon_result := seller_main.verify_coupon(
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
    PERFORM 1 FROM seller_main.user_product_access upa
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

    INSERT INTO seller_main.user_product_access (user_id, product_id, access_expires_at, access_duration_days)
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

    -- Coupon side effects run in the same transaction: if anything here fails,
    -- the grant above is rolled back, guaranteeing no partial state
    -- (e.g. access without a redemption row, or bumped counter without access).
    IF coupon_code_param IS NOT NULL AND v_coupon_id IS NOT NULL THEN
        INSERT INTO seller_main.coupon_redemptions (
            coupon_id, customer_email, user_id, discount_amount, transaction_id
        )
        VALUES (
            v_coupon_id,
            v_user_email,
            current_user_id,
            product_record.price,  -- full-discount path: discount equals list price
            NULL
        );

        UPDATE seller_main.coupons
           SET current_usage_count = current_usage_count + 1
         WHERE id = v_coupon_id;

        -- Clear any reservation verify_coupon created (idempotent — no-op if absent)
        DELETE FROM seller_main.coupon_reservations
         WHERE coupon_id = v_coupon_id
           AND customer_email = v_user_email;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

COMMENT ON FUNCTION seller_main.grant_free_product_access(TEXT, INTEGER, TEXT) IS
  'Unified free-access grant. Three eligibility branches: (1) full-discount coupon on a paid product, (2) price=0 product, (3) PWYW product with custom_price_min=0. Atomic: UPA upsert + coupon redemption + usage counter + reservation cleanup all commit together.';
