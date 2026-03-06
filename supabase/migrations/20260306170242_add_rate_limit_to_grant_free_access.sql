-- Add rate limiting to grant_free_product_access and grant_pwyw_free_access
-- Found during pentest: these functions had no rate limiting, allowing unlimited DB spam

-- Recreate grant_free_product_access with rate limiting (20 calls/hour)
CREATE OR REPLACE FUNCTION public.grant_free_product_access(
    product_slug_param TEXT,
    access_duration_days_param INTEGER DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    product_record RECORD;
    current_user_id UUID;
    access_expires_at TIMESTAMPTZ;
    clean_slug TEXT;
BEGIN
    -- Input validation and sanitization
    IF product_slug_param IS NULL OR length(product_slug_param) = 0 OR length(product_slug_param) > 100 THEN
        RETURN FALSE;
    END IF;

    -- Validate access duration
    IF access_duration_days_param IS NOT NULL AND (access_duration_days_param < 0 OR access_duration_days_param > 3650) THEN
        RETURN FALSE;
    END IF;

    -- Sanitize slug
    clean_slug := regexp_replace(product_slug_param, '[^a-zA-Z0-9_-]', '', 'g');
    IF clean_slug IS NULL OR length(clean_slug) = 0 THEN
        RETURN FALSE;
    END IF;

    -- Get current authenticated user ID
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Get product by slug (use sanitized slug)
    SELECT id, auto_grant_duration_days INTO product_record
    FROM public.products
    WHERE slug = clean_slug AND is_active = true AND price = 0;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Early return if user already has active (non-expired) access — avoids pointless UPSERTs
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

    -- Calculate access expiration
    IF access_duration_days_param IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * access_duration_days_param;
    ELSIF product_record.auto_grant_duration_days IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * product_record.auto_grant_duration_days;
    ELSE
        access_expires_at := NULL;
    END IF;

    -- Insert or update user access
    INSERT INTO public.user_product_access (user_id, product_id, access_expires_at, access_duration_days)
    VALUES (current_user_id, product_record.id, access_expires_at, COALESCE(access_duration_days_param, product_record.auto_grant_duration_days))
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET
        access_expires_at = EXCLUDED.access_expires_at,
        access_duration_days = EXCLUDED.access_duration_days,
        access_granted_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

-- Recreate grant_pwyw_free_access with rate limiting (20 calls/hour)
CREATE OR REPLACE FUNCTION public.grant_pwyw_free_access(
    product_slug_param TEXT,
    access_duration_days_param INTEGER DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    product_record RECORD;
    current_user_id UUID;
    access_expires_at TIMESTAMPTZ;
    clean_slug TEXT;
BEGIN
    -- Input validation and sanitization
    IF product_slug_param IS NULL OR length(product_slug_param) = 0 OR length(product_slug_param) > 100 THEN
        RETURN FALSE;
    END IF;

    -- Validate access duration
    IF access_duration_days_param IS NOT NULL AND (access_duration_days_param < 0 OR access_duration_days_param > 3650) THEN
        RETURN FALSE;
    END IF;

    -- Sanitize slug
    clean_slug := regexp_replace(product_slug_param, '[^a-zA-Z0-9_-]', '', 'g');
    IF clean_slug IS NULL OR length(clean_slug) = 0 THEN
        RETURN FALSE;
    END IF;

    -- Get current authenticated user ID
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Get product by slug - only PWYW products with min=0 allowed
    SELECT id, auto_grant_duration_days INTO product_record
    FROM public.products
    WHERE slug = clean_slug
      AND is_active = true
      AND allow_custom_price = true
      AND custom_price_min = 0;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Early return if user already has active (non-expired) access
    PERFORM 1 FROM public.user_product_access
    WHERE user_id = current_user_id
      AND product_id = product_record.id
      AND (access_expires_at IS NULL OR access_expires_at > NOW());
    IF FOUND THEN
        RETURN TRUE;
    END IF;

    -- Rate limiting: 20 calls per hour (prevents DB spam for expired/new access grants)
    IF NOT public.check_rate_limit('grant_pwyw_free_access'::TEXT, 20, 3600) THEN
        RETURN FALSE;
    END IF;

    -- Calculate access expiration
    IF access_duration_days_param IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * access_duration_days_param;
    ELSIF product_record.auto_grant_duration_days IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * product_record.auto_grant_duration_days;
    ELSE
        access_expires_at := NULL;
    END IF;

    -- Insert or update user access
    INSERT INTO public.user_product_access (user_id, product_id, access_expires_at, access_duration_days)
    VALUES (current_user_id, product_record.id, access_expires_at, COALESCE(access_duration_days_param, product_record.auto_grant_duration_days))
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET
        access_expires_at = EXCLUDED.access_expires_at,
        access_duration_days = EXCLUDED.access_duration_days,
        access_granted_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';
