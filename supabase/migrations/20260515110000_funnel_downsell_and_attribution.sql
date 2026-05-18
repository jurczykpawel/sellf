-- =====================================================
-- Funnel Downsell + Attribution
-- =====================================================
-- Generalises oto_offers to encode both upsell AND downsell branches per
-- source product, mirroring ThriveCart's binary-tree funnel model. Chains
-- emerge naturally because each generated coupon still funnels through the
-- same payment-status redirect logic. Attribution columns on coupons let us
-- compute conversion stats (offered vs accepted) per oto_offer + per role
-- without a separate events table.
--
-- @see admin-panel/src/lib/checkout-templates/oto.tsx
-- @see admin-panel/src/lib/payment/oto-redirect.ts
-- @see supabase/migrations/20251230000000_oto_system.sql
-- @see supabase/migrations/20260305000000_oto_webhook_access.sql
-- =====================================================

SET client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- 1. Extend oto_offers with downsell branch
-- -----------------------------------------------------------------------------

ALTER TABLE seller_main.oto_offers
  ADD COLUMN IF NOT EXISTS downsell_product_id UUID
    REFERENCES seller_main.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS downsell_discount_type TEXT,
  ADD COLUMN IF NOT EXISTS downsell_discount_value NUMERIC,
  ADD COLUMN IF NOT EXISTS downsell_duration_minutes INTEGER;

ALTER TABLE seller_main.oto_offers
  DROP CONSTRAINT IF EXISTS oto_offers_downsell_not_source,
  DROP CONSTRAINT IF EXISTS oto_offers_downsell_not_upsell,
  DROP CONSTRAINT IF EXISTS oto_offers_downsell_consistency,
  DROP CONSTRAINT IF EXISTS oto_offers_downsell_discount_type_check,
  DROP CONSTRAINT IF EXISTS oto_offers_downsell_discount_value_check,
  DROP CONSTRAINT IF EXISTS oto_offers_downsell_duration_check;

ALTER TABLE seller_main.oto_offers
  ADD CONSTRAINT oto_offers_downsell_not_source
    CHECK (downsell_product_id IS NULL OR downsell_product_id <> source_product_id),
  ADD CONSTRAINT oto_offers_downsell_not_upsell
    CHECK (downsell_product_id IS NULL OR downsell_product_id <> oto_product_id),
  ADD CONSTRAINT oto_offers_downsell_consistency
    CHECK (
      (downsell_product_id IS NULL AND downsell_discount_type IS NULL
        AND downsell_discount_value IS NULL AND downsell_duration_minutes IS NULL)
      OR
      (downsell_product_id IS NOT NULL AND downsell_discount_type IS NOT NULL
        AND downsell_discount_value IS NOT NULL AND downsell_duration_minutes IS NOT NULL)
    ),
  ADD CONSTRAINT oto_offers_downsell_discount_type_check
    CHECK (downsell_discount_type IS NULL OR downsell_discount_type IN ('percentage', 'fixed')),
  ADD CONSTRAINT oto_offers_downsell_discount_value_check
    CHECK (
      downsell_discount_value IS NULL
      OR (downsell_discount_value > 0
          AND (downsell_discount_type <> 'percentage' OR downsell_discount_value <= 100))
    ),
  ADD CONSTRAINT oto_offers_downsell_duration_check
    CHECK (downsell_duration_minutes IS NULL
           OR (downsell_duration_minutes > 0 AND downsell_duration_minutes <= 1440));

CREATE INDEX IF NOT EXISTS idx_oto_offers_downsell_product
  ON seller_main.oto_offers(downsell_product_id)
  WHERE downsell_product_id IS NOT NULL;

COMMENT ON COLUMN seller_main.oto_offers.downsell_product_id IS
  'Optional product offered when the buyer declines the upsell. Forms the second branch of the post-purchase funnel.';

-- public.oto_offers is a SELECT * view; Postgres freezes the column list at
-- view creation time, so the new downsell_* columns are invisible until we
-- recreate it. Without this PostgREST returns PGRST204 "column not found".
CREATE OR REPLACE VIEW public.oto_offers WITH (security_invoker = on) AS
  SELECT * FROM seller_main.oto_offers;

-- -----------------------------------------------------------------------------
-- 2. Allow 'oto' template on products
-- -----------------------------------------------------------------------------

ALTER TABLE seller_main.products
  DROP CONSTRAINT IF EXISTS products_checkout_template_check,
  DROP CONSTRAINT IF EXISTS products_tipjar_requires_pwyw;

ALTER TABLE seller_main.products
  ADD CONSTRAINT products_checkout_template_check
  CHECK (checkout_template IN ('default', 'tip-jar', 'oto')),
  ADD CONSTRAINT products_tipjar_requires_pwyw
  CHECK (checkout_template <> 'tip-jar' OR allow_custom_price = true);

-- -----------------------------------------------------------------------------
-- 3. Coupon role attribution + idempotency rework
-- -----------------------------------------------------------------------------
-- After this migration, a single transaction may produce TWO OTO coupons
-- (upsell + downsell). The legacy unique indexes keyed only on
-- source_transaction_id (or oto_offer_id+allowed_emails for free products)
-- would collide on the second INSERT. We re-key them to include coupon_role.

ALTER TABLE seller_main.coupons
  ADD COLUMN IF NOT EXISTS coupon_role TEXT;

ALTER TABLE seller_main.coupons
  DROP CONSTRAINT IF EXISTS coupons_coupon_role_check;

ALTER TABLE seller_main.coupons
  ADD CONSTRAINT coupons_coupon_role_check
  CHECK (coupon_role IS NULL OR coupon_role IN ('upsell', 'downsell'));

-- Backfill BEFORE recreating the unique index so existing rows pick up role.
UPDATE seller_main.coupons
  SET coupon_role = 'upsell'
  WHERE is_oto_coupon = true AND coupon_role IS NULL;

DROP INDEX IF EXISTS seller_main.idx_coupons_oto_transaction_unique;
CREATE UNIQUE INDEX idx_coupons_oto_transaction_unique
  ON seller_main.coupons(source_transaction_id, coupon_role)
  WHERE source_transaction_id IS NOT NULL AND is_oto_coupon = true;

DROP INDEX IF EXISTS seller_main.idx_coupons_oto_free_unique;
CREATE UNIQUE INDEX idx_coupons_oto_free_unique
  ON seller_main.coupons(oto_offer_id, allowed_emails, coupon_role)
  WHERE source_transaction_id IS NULL AND is_oto_coupon = true;

CREATE INDEX IF NOT EXISTS idx_coupons_role
  ON seller_main.coupons(coupon_role) WHERE coupon_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_offer_role
  ON seller_main.coupons(oto_offer_id, coupon_role)
  WHERE oto_offer_id IS NOT NULL;

COMMENT ON COLUMN seller_main.coupons.coupon_role IS
  'Funnel role: upsell or downsell. NULL for non-funnel coupons (manual, campaign, etc.).';

-- Refresh proxy view so PostgREST exposes the new column.
CREATE OR REPLACE VIEW public.coupons WITH (security_invoker = on) AS
  SELECT * FROM seller_main.coupons;

-- =============================================================================
-- 4. generate_oto_coupon: now emits BOTH upsell and downsell branches
-- =============================================================================
-- Preserves the existing contract: 3-arg signature, transaction_id_param
-- optional (free-product flow). Idempotency keys now include coupon_role so
-- the same transaction can hold both an upsell and a downsell coupon.

CREATE OR REPLACE FUNCTION seller_main.generate_oto_coupon(
  source_product_id_param UUID,
  customer_email_param TEXT,
  transaction_id_param UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  oto_config RECORD;
  downsell_product RECORD;

  upsell_existing RECORD;
  downsell_existing RECORD;

  upsell_code TEXT;
  upsell_id UUID;
  upsell_expires TIMESTAMPTZ;

  downsell_code TEXT;
  downsell_id UUID;
  downsell_expires TIMESTAMPTZ;
  -- Scalar copies for JSONB return: avoid the "record not assigned yet" trap
  -- when the downsell branch is unconfigured. (PL/pgSQL CASE evaluates every
  -- arm before the predicate, so reading downsell_product.<field> in an
  -- unmatched arm still raises.)
  downsell_product_slug TEXT;
  downsell_product_name TEXT;
  downsell_product_price NUMERIC;
  downsell_product_currency TEXT;

  email_array JSONB;
BEGIN
  email_array := jsonb_build_array(customer_email_param);

  -- ---------------------------------------------------------------------------
  -- IDEMPOTENCY: locate any existing upsell/downsell coupon for this caller.
  -- Strategy mirrors 20260305 (transaction → source_transaction_id; free →
  -- offer+email+role).
  -- ---------------------------------------------------------------------------
  IF transaction_id_param IS NOT NULL THEN
    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           o.oto_product_id, o.duration_minutes, o.downsell_product_id,
           o.downsell_discount_type, o.downsell_discount_value, o.downsell_duration_minutes,
           p.slug AS oto_product_slug, p.name AS oto_product_name,
           p.price AS oto_product_price, p.currency AS oto_product_currency
      INTO upsell_existing
      FROM seller_main.coupons c
      INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN seller_main.products p ON o.oto_product_id = p.id
     WHERE c.source_transaction_id = transaction_id_param
       AND c.is_oto_coupon = true
       AND c.coupon_role = 'upsell'
     LIMIT 1;

    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           dp.id AS downsell_product_id, dp.slug AS downsell_product_slug,
           dp.name AS downsell_product_name, dp.price AS downsell_product_price,
           dp.currency AS downsell_product_currency,
           o.downsell_duration_minutes
      INTO downsell_existing
      FROM seller_main.coupons c
      INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN seller_main.products dp ON o.downsell_product_id = dp.id
     WHERE c.source_transaction_id = transaction_id_param
       AND c.is_oto_coupon = true
       AND c.coupon_role = 'downsell'
     LIMIT 1;
  ELSE
    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           o.oto_product_id, o.duration_minutes, o.downsell_product_id,
           o.downsell_discount_type, o.downsell_discount_value, o.downsell_duration_minutes,
           p.slug AS oto_product_slug, p.name AS oto_product_name,
           p.price AS oto_product_price, p.currency AS oto_product_currency
      INTO upsell_existing
      FROM seller_main.coupons c
      INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN seller_main.products p ON o.oto_product_id = p.id
     WHERE o.source_product_id = source_product_id_param
       AND c.is_oto_coupon = true
       AND c.source_transaction_id IS NULL
       AND c.allowed_emails = email_array
       AND c.coupon_role = 'upsell'
       AND o.is_active = true
     LIMIT 1;

    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           dp.id AS downsell_product_id, dp.slug AS downsell_product_slug,
           dp.name AS downsell_product_name, dp.price AS downsell_product_price,
           dp.currency AS downsell_product_currency,
           o.downsell_duration_minutes
      INTO downsell_existing
      FROM seller_main.coupons c
      INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN seller_main.products dp ON o.downsell_product_id = dp.id
     WHERE o.source_product_id = source_product_id_param
       AND c.is_oto_coupon = true
       AND c.source_transaction_id IS NULL
       AND c.allowed_emails = email_array
       AND c.coupon_role = 'downsell'
       AND o.is_active = true
     LIMIT 1;
  END IF;

  -- PL/pgSQL gotcha: `record IS NOT NULL` is FALSE when ANY column is NULL.
  -- Since our SELECT pulls nullable downsell_* cols from oto_offers, we can't
  -- use that idiom — fall back to the primary key, which is non-null iff a
  -- row was actually found.
  IF upsell_existing.id IS NOT NULL THEN
    -- Already generated. If the coupon is no longer usable, surface that.
    IF upsell_existing.is_active IS DISTINCT FROM true
      OR upsell_existing.expires_at <= NOW()
      OR upsell_existing.current_usage_count >= COALESCE(upsell_existing.usage_limit_global, 999999)
    THEN
      RETURN jsonb_build_object(
        'has_oto', false,
        'reason', 'existing_oto_coupon_unavailable',
        'coupon_code', upsell_existing.code,
        'coupon_id', upsell_existing.id
      );
    END IF;

    RETURN jsonb_build_object(
      'has_oto', true,
      'coupon_code', upsell_existing.code,
      'coupon_id', upsell_existing.id,
      'upsell_code', upsell_existing.code,
      'upsell_coupon_id', upsell_existing.id,
      'oto_product_id', upsell_existing.oto_product_id,
      'oto_product_slug', upsell_existing.oto_product_slug,
      'oto_product_name', upsell_existing.oto_product_name,
      'oto_product_price', upsell_existing.oto_product_price,
      'oto_product_currency', upsell_existing.oto_product_currency,
      'discount_type', upsell_existing.discount_type,
      'discount_value', upsell_existing.discount_value,
      'expires_at', upsell_existing.expires_at,
      'duration_minutes', upsell_existing.duration_minutes,
      'downsell_code', downsell_existing.code,
      'downsell_coupon_id', downsell_existing.id,
      'downsell_product_id', downsell_existing.downsell_product_id,
      'downsell_product_slug', downsell_existing.downsell_product_slug,
      'downsell_product_name', downsell_existing.downsell_product_name,
      'downsell_product_price', downsell_existing.downsell_product_price,
      'downsell_product_currency', downsell_existing.downsell_product_currency,
      'downsell_discount_type', downsell_existing.discount_type,
      'downsell_discount_value', downsell_existing.discount_value,
      'downsell_expires_at', downsell_existing.expires_at,
      'downsell_duration_minutes', downsell_existing.downsell_duration_minutes
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- Resolve active OTO offer (no existing coupon yet)
  -- ---------------------------------------------------------------------------
  SELECT o.*, p.slug AS oto_product_slug, p.name AS oto_product_name,
         p.price AS oto_product_price, p.currency AS oto_product_currency
    INTO oto_config
    FROM seller_main.oto_offers o
    INNER JOIN seller_main.products p ON p.id = o.oto_product_id AND p.is_active = true
   WHERE o.source_product_id = source_product_id_param
     AND o.is_active = true
   ORDER BY o.display_order ASC, o.created_at ASC
   LIMIT 1;

  IF oto_config IS NULL THEN
    RETURN jsonb_build_object('has_oto', false);
  END IF;

  -- Customer already owns the upsell product → suppress entire funnel
  IF EXISTS (
    SELECT 1
      FROM seller_main.user_product_access upa
      INNER JOIN auth.users au ON au.id = upa.user_id
     WHERE au.email = customer_email_param
       AND upa.product_id = oto_config.oto_product_id
       AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW())
  ) OR EXISTS (
    SELECT 1
      FROM seller_main.guest_purchases gp
     WHERE gp.customer_email = customer_email_param
       AND gp.product_id = oto_config.oto_product_id
  ) THEN
    RETURN jsonb_build_object(
      'has_oto', false,
      'reason', 'already_owns_oto_product',
      'skipped_oto_product_id', oto_config.oto_product_id,
      'skipped_oto_product_slug', oto_config.oto_product_slug
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- Generate UPSELL coupon
  -- ---------------------------------------------------------------------------
  upsell_code := 'OTO-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8));
  upsell_expires := NOW() + (oto_config.duration_minutes || ' minutes')::INTERVAL;

  BEGIN
    INSERT INTO seller_main.coupons (
      code, name, discount_type, discount_value, currency,
      allowed_emails, allowed_product_ids,
      usage_limit_global, usage_limit_per_user,
      expires_at, is_active,
      is_oto_coupon, oto_offer_id, source_transaction_id, coupon_role
    ) VALUES (
      upsell_code,
      'OTO upsell: ' || customer_email_param,
      oto_config.discount_type, oto_config.discount_value,
      CASE WHEN oto_config.discount_type = 'fixed' THEN oto_config.oto_product_currency ELSE NULL END,
      email_array,
      jsonb_build_array(oto_config.oto_product_id),
      1, 1,
      upsell_expires, true,
      true, oto_config.id, transaction_id_param, 'upsell'
    )
    RETURNING id INTO upsell_id;
  EXCEPTION
    WHEN unique_violation THEN
      IF transaction_id_param IS NOT NULL THEN
        SELECT id, code, expires_at INTO upsell_id, upsell_code, upsell_expires
          FROM seller_main.coupons
         WHERE source_transaction_id = transaction_id_param
           AND is_oto_coupon = true
           AND coupon_role = 'upsell'
         LIMIT 1;
      ELSE
        SELECT id, code, expires_at INTO upsell_id, upsell_code, upsell_expires
          FROM seller_main.coupons
         WHERE oto_offer_id = oto_config.id
           AND allowed_emails = email_array
           AND is_oto_coupon = true
           AND source_transaction_id IS NULL
           AND coupon_role = 'upsell'
         LIMIT 1;
      END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- Generate DOWNSELL coupon if configured. We DO NOT short-circuit on the
  -- customer already owning the downsell product — that's handled at decline
  -- time. Here we just pre-mint the coupon for the decline URL.
  -- ---------------------------------------------------------------------------
  IF oto_config.downsell_product_id IS NOT NULL THEN
    SELECT id, slug, name, price, currency, is_active
      INTO downsell_product
      FROM seller_main.products
     WHERE id = oto_config.downsell_product_id;

    IF downsell_product IS NOT NULL AND downsell_product.is_active THEN
      downsell_product_slug := downsell_product.slug;
      downsell_product_name := downsell_product.name;
      downsell_product_price := downsell_product.price;
      downsell_product_currency := downsell_product.currency;

      downsell_code := 'OTO-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8));
      downsell_expires := NOW() + (oto_config.downsell_duration_minutes || ' minutes')::INTERVAL;

      BEGIN
        INSERT INTO seller_main.coupons (
          code, name, discount_type, discount_value, currency,
          allowed_emails, allowed_product_ids,
          usage_limit_global, usage_limit_per_user,
          expires_at, is_active,
          is_oto_coupon, oto_offer_id, source_transaction_id, coupon_role
        ) VALUES (
          downsell_code,
          'OTO downsell: ' || customer_email_param,
          oto_config.downsell_discount_type, oto_config.downsell_discount_value,
          CASE WHEN oto_config.downsell_discount_type = 'fixed' THEN downsell_product.currency ELSE NULL END,
          email_array,
          jsonb_build_array(oto_config.downsell_product_id),
          1, 1,
          downsell_expires, true,
          true, oto_config.id, transaction_id_param, 'downsell'
        )
        RETURNING id INTO downsell_id;
      EXCEPTION
        WHEN unique_violation THEN
          IF transaction_id_param IS NOT NULL THEN
            SELECT id, code, expires_at INTO downsell_id, downsell_code, downsell_expires
              FROM seller_main.coupons
             WHERE source_transaction_id = transaction_id_param
               AND is_oto_coupon = true
               AND coupon_role = 'downsell'
             LIMIT 1;
          ELSE
            SELECT id, code, expires_at INTO downsell_id, downsell_code, downsell_expires
              FROM seller_main.coupons
             WHERE oto_offer_id = oto_config.id
               AND allowed_emails = email_array
               AND is_oto_coupon = true
               AND source_transaction_id IS NULL
               AND coupon_role = 'downsell'
             LIMIT 1;
          END IF;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'has_oto', true,
    'coupon_code', upsell_code,
    'coupon_id', upsell_id,
    'upsell_code', upsell_code,
    'upsell_coupon_id', upsell_id,
    'oto_product_id', oto_config.oto_product_id,
    'oto_product_slug', oto_config.oto_product_slug,
    'oto_product_name', oto_config.oto_product_name,
    'oto_product_price', oto_config.oto_product_price,
    'oto_product_currency', oto_config.oto_product_currency,
    'discount_type', oto_config.discount_type,
    'discount_value', oto_config.discount_value,
    'expires_at', upsell_expires,
    'duration_minutes', oto_config.duration_minutes,
    'downsell_code', downsell_code,
    'downsell_coupon_id', downsell_id,
    'downsell_product_id', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_product_id END,
    'downsell_product_slug', downsell_product_slug,
    'downsell_product_name', downsell_product_name,
    'downsell_product_price', downsell_product_price,
    'downsell_product_currency', downsell_product_currency,
    'downsell_discount_type', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_discount_type END,
    'downsell_discount_value', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_discount_value END,
    'downsell_expires_at', downsell_expires,
    'downsell_duration_minutes', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_duration_minutes END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.generate_oto_coupon TO service_role;

-- =============================================================================
-- 5. admin_save_oto_offer with downsell params
-- =============================================================================
-- We must DROP the old signature explicitly: Postgres forbids changing
-- parameter defaults via CREATE OR REPLACE, and we're adding 4 new
-- DEFAULT-NULL parameters at the tail.

DROP FUNCTION IF EXISTS seller_main.admin_save_oto_offer(
  UUID, UUID, TEXT, NUMERIC, INTEGER, BOOLEAN
);

CREATE FUNCTION seller_main.admin_save_oto_offer(
  source_product_id_param UUID,
  oto_product_id_param UUID,
  discount_type_param TEXT,
  discount_value_param NUMERIC,
  duration_minutes_param INTEGER DEFAULT 15,
  is_active_param BOOLEAN DEFAULT true,
  downsell_product_id_param UUID DEFAULT NULL,
  downsell_discount_type_param TEXT DEFAULT NULL,
  downsell_discount_value_param NUMERIC DEFAULT NULL,
  downsell_duration_minutes_param INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result_id UUID;
BEGIN
  IF NOT ( SELECT public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  IF source_product_id_param = oto_product_id_param THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source and OTO product cannot be the same');
  END IF;

  IF downsell_product_id_param IS NOT NULL THEN
    IF downsell_product_id_param = source_product_id_param THEN
      RETURN jsonb_build_object('success', false, 'error', 'Downsell product cannot equal source product');
    END IF;
    IF downsell_product_id_param = oto_product_id_param THEN
      RETURN jsonb_build_object('success', false, 'error', 'Downsell product cannot equal upsell product');
    END IF;
    IF downsell_discount_type_param IS NULL
       OR downsell_discount_value_param IS NULL
       OR downsell_duration_minutes_param IS NULL THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Downsell discount type, value and duration are required when downsell product is set');
    END IF;
    IF downsell_discount_type_param NOT IN ('percentage', 'fixed') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid downsell discount type');
    END IF;
    IF downsell_discount_type_param = 'percentage' AND downsell_discount_value_param > 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Downsell percentage discount cannot exceed 100%');
    END IF;
    IF downsell_duration_minutes_param < 1 OR downsell_duration_minutes_param > 1440 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Downsell duration must be between 1 and 1440 minutes');
    END IF;
  END IF;

  IF discount_type_param NOT IN ('percentage', 'fixed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid discount type');
  END IF;
  IF discount_type_param = 'percentage' AND discount_value_param > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Percentage discount cannot exceed 100%');
  END IF;
  IF duration_minutes_param < 1 OR duration_minutes_param > 1440 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Duration must be between 1 and 1440 minutes');
  END IF;

  INSERT INTO seller_main.oto_offers (
    source_product_id, oto_product_id,
    discount_type, discount_value, duration_minutes,
    is_active,
    downsell_product_id, downsell_discount_type,
    downsell_discount_value, downsell_duration_minutes
  ) VALUES (
    source_product_id_param, oto_product_id_param,
    discount_type_param, discount_value_param, duration_minutes_param,
    is_active_param,
    downsell_product_id_param, downsell_discount_type_param,
    downsell_discount_value_param, downsell_duration_minutes_param
  )
  ON CONFLICT (source_product_id, oto_product_id) DO UPDATE SET
    discount_type = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    duration_minutes = EXCLUDED.duration_minutes,
    is_active = EXCLUDED.is_active,
    downsell_product_id = EXCLUDED.downsell_product_id,
    downsell_discount_type = EXCLUDED.downsell_discount_type,
    downsell_discount_value = EXCLUDED.downsell_discount_value,
    downsell_duration_minutes = EXCLUDED.downsell_duration_minutes,
    updated_at = NOW()
  RETURNING id INTO result_id;

  RETURN jsonb_build_object('success', true, 'id', result_id);
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.admin_save_oto_offer(
  UUID, UUID, TEXT, NUMERIC, INTEGER, BOOLEAN, UUID, TEXT, NUMERIC, INTEGER
) TO authenticated;
