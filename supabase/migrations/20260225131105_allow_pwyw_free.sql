-- Allow PWYW products with minimum price of 0 (free option)
-- Previously custom_price_min was constrained to >= 0.50 (Stripe minimum)
-- Now we allow 0 to support "Pay What You Want" with free option

-- Relax the CHECK constraint on custom_price_min
ALTER TABLE seller_main.products DROP CONSTRAINT IF EXISTS products_custom_price_min_check;
ALTER TABLE seller_main.products ADD CONSTRAINT products_custom_price_min_check CHECK (custom_price_min >= 0);

-- Create function to grant free access for PWYW products with min=0
-- Separate from grant_free_product_access which only handles price=0 products
CREATE OR REPLACE FUNCTION seller_main.grant_pwyw_free_access(
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
        RETURN FALSE; -- Max 10 years
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

    -- Get product by slug — only PWYW products with min=0 allowed
    SELECT id, auto_grant_duration_days INTO product_record
    FROM seller_main.products
    WHERE slug = clean_slug
      AND is_active = true
      AND allow_custom_price = true
      AND custom_price_min = 0;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Calculate access expiration
    IF access_duration_days_param IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * access_duration_days_param;
    ELSIF product_record.auto_grant_duration_days IS NOT NULL THEN
        access_expires_at := NOW() + INTERVAL '1 day' * product_record.auto_grant_duration_days;
    ELSE
        access_expires_at := NULL; -- Permanent access
    END IF;

    -- Insert or update user access
    INSERT INTO seller_main.user_product_access (user_id, product_id, access_expires_at, access_duration_days)
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

COMMENT ON FUNCTION seller_main.grant_pwyw_free_access IS 'Grant free access to PWYW products with custom_price_min=0. Separate from grant_free_product_access which only handles price=0 products.';
