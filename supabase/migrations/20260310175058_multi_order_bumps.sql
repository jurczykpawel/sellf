-- Migration: Multi Order Bumps
-- 1. Removes the LIMIT 1 from get_product_order_bumps() to return ALL active bumps.
-- 2. Creates payment_line_items table for order composition tracking.
-- 3. Rewrites process_stripe_payment_completion_with_bump() to accept UUID[] for multiple bumps
--    and record line items per product in the order.
--
-- ROLLBACK: Drop payment_line_items, re-apply the LIMIT 1 in get_product_order_bumps,
-- and revert process_stripe_payment_completion_with_bump to accept a single UUID.

-- =============================================================================
-- 1. Remove LIMIT 1 from get_product_order_bumps
-- =============================================================================

-- Drop existing function first to allow return type change (adding urgency_duration_minutes)
DROP FUNCTION IF EXISTS seller_main.get_product_order_bumps(UUID);

CREATE OR REPLACE FUNCTION seller_main.get_product_order_bumps(
  product_id_param UUID
) RETURNS TABLE (
  bump_id UUID,
  bump_product_id UUID,
  bump_product_name TEXT,
  bump_product_description TEXT,
  bump_product_icon TEXT,
  bump_price NUMERIC,
  original_price NUMERIC,
  bump_access_duration INTEGER,
  bump_currency TEXT,
  bump_title TEXT,
  bump_description TEXT,
  display_order INTEGER,
  urgency_duration_minutes INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ob.id as bump_id,
    ob.bump_product_id,
    p.name as bump_product_name,
    p.description as bump_product_description,
    p.icon as bump_product_icon,
    COALESCE(ob.bump_price, p.price) as bump_price,
    p.price as original_price,
    COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as bump_access_duration,
    p.currency as bump_currency,
    ob.bump_title,
    ob.bump_description,
    ob.display_order,
    ob.urgency_duration_minutes
  FROM seller_main.order_bumps ob
  INNER JOIN seller_main.products p ON p.id = ob.bump_product_id
  WHERE ob.main_product_id = product_id_param
    AND ob.is_active = true
    AND p.is_active = true
  ORDER BY ob.display_order ASC, ob.created_at ASC;
  -- NOTE: Removed LIMIT 1 to support multiple order bumps per product
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- Re-grant after DROP+CREATE (DROP loses previous GRANTs)
GRANT EXECUTE ON FUNCTION seller_main.get_product_order_bumps TO anon, authenticated, service_role;

-- =============================================================================
-- 2. Create payment_line_items table
--    Tracks every product in an order (main product + bumps + future cart items).
--    Single source of truth for "what was in this order and at what price".
-- =============================================================================

CREATE TYPE seller_main.line_item_type AS ENUM ('main_product', 'order_bump');
-- Future: ALTER TYPE seller_main.line_item_type ADD VALUE 'cart_item';
-- Future: ALTER TYPE seller_main.line_item_type ADD VALUE 'upsell';

CREATE TABLE IF NOT EXISTS seller_main.payment_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES seller_main.payment_transactions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES seller_main.products(id) ON DELETE CASCADE,
  item_type seller_main.line_item_type NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 100),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0 AND unit_price <= 99999999),
  total_price NUMERIC NOT NULL CHECK (total_price >= 0 AND total_price <= 99999999),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND upper(currency) ~ '^[A-Z]{3}$'
  ),
  -- Snapshot of product name at purchase time (products can be renamed)
  product_name TEXT,
  -- For order_bump: link back to the order_bumps row (nullable for main_product / cart_item)
  order_bump_id UUID REFERENCES seller_main.order_bumps(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- A product should appear at most once per transaction
  CONSTRAINT unique_product_per_transaction UNIQUE (transaction_id, product_id),
  -- total_price must equal unit_price * quantity
  CONSTRAINT valid_total_price CHECK (total_price = unit_price * quantity)
);

-- Indexes for common queries
CREATE INDEX idx_payment_line_items_transaction ON seller_main.payment_line_items(transaction_id);
CREATE INDEX idx_payment_line_items_product ON seller_main.payment_line_items(product_id);
CREATE INDEX idx_payment_line_items_type ON seller_main.payment_line_items(item_type);
CREATE INDEX idx_payment_line_items_order_bump ON seller_main.payment_line_items(order_bump_id) WHERE order_bump_id IS NOT NULL;

-- RLS: Same pattern as payment_transactions
ALTER TABLE seller_main.payment_line_items ENABLE ROW LEVEL SECURITY;

-- Users can read their own line items (via transaction ownership)
CREATE POLICY "Users can view own line items"
  ON seller_main.payment_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM seller_main.payment_transactions pt
      WHERE pt.id = payment_line_items.transaction_id
        AND pt.user_id = auth.uid()
    )
  );

-- Service role has full access (for payment processing)
CREATE POLICY "Service role full access to line items"
  ON seller_main.payment_line_items FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
  );

-- Admin can read all line items
CREATE POLICY "Admin can view all line items"
  ON seller_main.payment_line_items FOR SELECT
  USING (
    ( select public.is_admin() )
  );

-- =============================================================================
-- 3. Rewrite process_stripe_payment_completion_with_bump for multi-bump
--    New parameter: bump_product_ids_param UUID[] (replaces bump_product_id_param UUID)
--    Backward compatibility: NULL or empty array = no bumps
-- =============================================================================

-- Drop the old function signature to avoid overload ambiguity
DROP FUNCTION IF EXISTS seller_main.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, UUID
);

CREATE OR REPLACE FUNCTION seller_main.process_stripe_payment_completion_with_bump(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_ids_param UUID[] DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  current_user_id UUID;
  product_record RECORD;
  existing_user_id UUID;
  access_expires_at TIMESTAMPTZ := NULL;
  transaction_id_var UUID;
  pending_transaction_id UUID;
  -- Multi-bump variables
  bump_rec RECORD;
  total_bump_price NUMERIC := 0;
  bump_count INTEGER := 0;
  bump_ids_found UUID[] := '{}';
BEGIN
  -- Rate limiting
  IF NOT public.check_rate_limit('process_stripe_payment_completion', 100, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded');
  END IF;

  -- Input validation
  IF session_id_param IS NULL OR length(session_id_param) = 0 OR length(session_id_param) > 255 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID');
  END IF;

  IF NOT (session_id_param ~* '^(cs_|pi_)[a-zA-Z0-9_]+$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID format');
  END IF;

  IF product_id_param IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product ID is required');
  END IF;

  IF NOT public.validate_email_format(customer_email_param) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid email address is required');
  END IF;

  IF amount_total IS NULL OR amount_total <= 0 OR amount_total > 99999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  -- Authorization
  IF user_id_param IS NOT NULL THEN
    IF (select auth.role()) = 'service_role' THEN
      current_user_id := user_id_param;
    ELSIF auth.uid() = user_id_param THEN
      current_user_id := user_id_param;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
  ELSE
    current_user_id := NULL;
  END IF;

  -- Idempotency check
  IF EXISTS (SELECT 1 FROM seller_main.payment_transactions WHERE session_id = session_id_param AND status != 'pending') THEN
    IF EXISTS (SELECT 1 FROM seller_main.guest_purchases WHERE session_id = session_id_param) THEN
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param,
        'message', 'Payment already processed (idempotent)'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'already_processed_idempotent',
        'access_granted', true,
        'already_had_access', true,
        'message', 'Payment already processed (idempotent)'
      );
    END IF;
  END IF;

  -- Get product (include name for line item snapshot)
  SELECT id, name, auto_grant_duration_days, price, currency INTO product_record
  FROM seller_main.products
  WHERE id = product_id_param AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  -- Currency validation
  IF product_record.currency IS NOT NULL THEN
    IF upper(currency_param) != upper(product_record.currency) THEN
      RAISE EXCEPTION 'Currency mismatch: expected %, got %',
        product_record.currency, currency_param;
    END IF;
  END IF;

  -- ==========================================
  -- MULTI-BUMP: Validate all bump products
  -- Collects: id, name, price, order_bump_id for line items
  -- ==========================================
  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many bump products (max 20)');
  END IF;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 0 THEN
    FOR bump_rec IN
      SELECT
        p.id,
        p.name,
        ob.id as order_bump_id,
        COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as auto_grant_duration_days,
        COALESCE(ob.bump_price, p.price) as price,
        p.currency
      FROM unnest(bump_product_ids_param) AS bid(id)
      JOIN seller_main.products p ON p.id = bid.id
      JOIN seller_main.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
      WHERE p.is_active = true
        AND ob.is_active = true
    LOOP
      total_bump_price := total_bump_price + bump_rec.price;
      bump_count := bump_count + 1;
      bump_ids_found := array_append(bump_ids_found, bump_rec.id);
    END LOOP;
  END IF;

  -- ==========================================
  -- SECURITY: Validate amount
  -- ==========================================
  IF product_record.price IS NOT NULL THEN
    DECLARE
      expected_total NUMERIC;
    BEGIN
      expected_total := product_record.price + total_bump_price;

      IF coupon_id_param IS NULL THEN
        -- No coupon: validate exact amount
        IF amount_total != (expected_total * 100) THEN
          RAISE EXCEPTION 'Amount mismatch: expected % cents (product % + bumps %), got % cents',
            (expected_total * 100),
            (product_record.price * 100),
            (total_bump_price * 100),
            amount_total;
        END IF;
      ELSE
        -- Coupon applied: lenient check
        IF amount_total <= 0 THEN
          RAISE EXCEPTION 'Invalid amount with coupon: amount cannot be zero or negative';
        END IF;

        IF amount_total > (expected_total * 100) THEN
          RAISE EXCEPTION 'Amount too high with coupon: got % cents but max possible is % cents',
            amount_total, (expected_total * 100);
        END IF;
      END IF;
    END;
  END IF;

  -- Find existing user
  SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param;

  -- Calculate main product expiration
  IF product_record.auto_grant_duration_days IS NOT NULL THEN
    access_expires_at := NOW() + (product_record.auto_grant_duration_days || ' days')::INTERVAL;
  END IF;

  BEGIN
    -- Check for existing pending transaction and update it
    SELECT pt.id INTO pending_transaction_id
    FROM seller_main.payment_transactions pt
    WHERE pt.stripe_payment_intent_id = process_stripe_payment_completion_with_bump.stripe_payment_intent_id
      AND pt.status = 'pending'
    LIMIT 1;

    IF pending_transaction_id IS NOT NULL THEN
      UPDATE seller_main.payment_transactions
      SET
        status = 'completed',
        user_id = current_user_id,
        customer_email = customer_email_param,
        metadata = metadata || jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param,
          'converted_from_pending', true
        ),
        updated_at = NOW()
      WHERE id = pending_transaction_id
      RETURNING id INTO transaction_id_var;
    ELSE
      INSERT INTO seller_main.payment_transactions (
        session_id, user_id, product_id, customer_email, amount, currency,
        stripe_payment_intent_id, status, metadata
      ) VALUES (
        session_id_param, current_user_id, product_id_param, customer_email_param,
        amount_total, upper(currency_param), stripe_payment_intent_id, 'completed',
        jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param
        )
      ) RETURNING id INTO transaction_id_var;
    END IF;

    -- Increment sale quantity sold
    PERFORM seller_main.increment_sale_quantity_sold(product_id_param);

    -- ==========================================
    -- LINE ITEMS: Record order composition
    -- Main product is always the first line item.
    -- Each validated bump gets its own line item.
    -- ==========================================
    INSERT INTO seller_main.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price,
      currency, product_name
    ) VALUES (
      transaction_id_var, product_id_param, 'main_product', 1,
      product_record.price, product_record.price,
      upper(currency_param), product_record.name
    );

    IF bump_count > 0 THEN
      FOR bump_rec IN
        SELECT
          p.id,
          p.name,
          ob.id as order_bump_id,
          COALESCE(ob.bump_price, p.price) as price,
          p.currency
        FROM unnest(bump_ids_found) AS bid(id)
        JOIN seller_main.products p ON p.id = bid.id
        JOIN seller_main.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
        WHERE p.is_active = true AND ob.is_active = true
      LOOP
        INSERT INTO seller_main.payment_line_items (
          transaction_id, product_id, item_type, quantity, unit_price, total_price,
          currency, product_name, order_bump_id
        ) VALUES (
          transaction_id_var, bump_rec.id, 'order_bump', 1,
          bump_rec.price, bump_rec.price,
          upper(COALESCE(bump_rec.currency, currency_param)), bump_rec.name,
          bump_rec.order_bump_id
        );
      END LOOP;
    END IF;

    -- Coupon redemption
    IF coupon_id_param IS NOT NULL THEN
      DELETE FROM seller_main.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      UPDATE seller_main.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND is_active = true
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      INSERT INTO seller_main.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

    -- SCENARIO 1: Logged-in user
    IF current_user_id IS NOT NULL THEN
      PERFORM seller_main.grant_product_access_service_role(current_user_id, product_id_param);

      IF bump_count > 0 THEN
        FOR bump_rec IN
          SELECT unnest(bump_ids_found) AS bid
        LOOP
          PERFORM seller_main.grant_product_access_service_role(current_user_id, bump_rec.bid);
        END LOOP;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'logged_in_user_with_bump',
        'access_granted', true,
        'bump_access_granted', bump_count > 0,
        'bump_count', bump_count,
        'customer_email', customer_email_param
      );

    -- SCENARIO 2: Guest purchase, user exists
    ELSIF existing_user_id IS NOT NULL THEN
      INSERT INTO seller_main.guest_purchases (customer_email, product_id, transaction_amount, session_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param);

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_user_exists_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );

    -- SCENARIO 3: Guest purchase, new user
    ELSE
      INSERT INTO seller_main.guest_purchases (customer_email, product_id, transaction_amount, session_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param);

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'process_stripe_payment_completion_with_bump error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment processing failed. Please try again or contact support.',
      'code', SQLSTATE
    );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion_with_bump TO service_role;

-- =============================================================================
-- 4. Update claim_guest_purchases_for_user to also grant access for bump products
--    found in payment_line_items (since bump-specific guest_purchases rows are removed).
--    After claiming the main guest_purchase, look up the transaction's line items
--    and grant access for each order_bump product.
-- =============================================================================

CREATE OR REPLACE FUNCTION seller_main.claim_guest_purchases_for_user(
  p_user_id UUID
) RETURNS json AS $$
DECLARE
  user_email_var TEXT;
  claimed_count INTEGER := 0;
  guest_purchase_record RECORD;
  line_item_rec RECORD;
BEGIN
  -- Rate limiting: 10 calls per hour for claiming purchases
  IF NOT public.check_rate_limit('claim_guest_purchases_for_user', 10, 3600) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Rate limit exceeded. Please wait before trying again.'
    );
  END IF;

  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User ID is required');
  END IF;

  SELECT email INTO user_email_var FROM auth.users WHERE id = p_user_id;

  IF user_email_var IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  IF NOT public.validate_email_format(user_email_var) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email format');
  END IF;

  FOR guest_purchase_record IN
    SELECT gp.*, pt.id as transaction_id
    FROM seller_main.guest_purchases gp
    LEFT JOIN seller_main.payment_transactions pt ON pt.session_id = gp.session_id
    WHERE gp.customer_email = user_email_var
      AND gp.claimed_by_user_id IS NULL
  LOOP
    UPDATE seller_main.guest_purchases
    SET claimed_by_user_id = p_user_id, claimed_at = NOW()
    WHERE id = guest_purchase_record.id;

    -- Grant access to the main product
    BEGIN
      DECLARE
        grant_result JSONB;
      BEGIN
        SELECT seller_main.grant_product_access_service_role(p_user_id, guest_purchase_record.product_id) INTO grant_result;

        IF (grant_result->>'success')::boolean = true THEN
          claimed_count := claimed_count + 1;
        ELSE
          IF (grant_result->>'retry_exceeded')::boolean = true THEN
            PERFORM public.log_admin_action(
              'guest_claim_concurrency_failure', 'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'WARNING', 'error_type', 'optimistic_lock_retry_exceeded',
                'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id, 'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user'
              )
            );
          ELSE
            PERFORM public.log_admin_action(
              'guest_claim_grant_failure', 'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'ERROR', 'error_type', 'access_grant_failure',
                'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id, 'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user'
              )
            );
          END IF;

          UPDATE seller_main.guest_purchases
          SET claimed_by_user_id = NULL, claimed_at = NULL
          WHERE id = guest_purchase_record.id;
        END IF;
      END;
    EXCEPTION
      WHEN OTHERS THEN
        PERFORM public.log_admin_action(
          'critical_guest_claim_failure', 'guest_purchases',
          guest_purchase_record.id::TEXT,
          jsonb_build_object(
            'severity', 'CRITICAL', 'error_type', 'guest_claim_exception',
            'error_code', SQLSTATE, 'error_message', SQLERRM,
            'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
            'guest_purchase_id', guest_purchase_record.id,
            'function_name', 'claim_guest_purchases_for_user'
          )
        );
        UPDATE seller_main.guest_purchases
        SET claimed_by_user_id = NULL, claimed_at = NULL
        WHERE id = guest_purchase_record.id;
        NULL;
    END;

    -- Grant access for bump products from payment_line_items
    IF guest_purchase_record.transaction_id IS NOT NULL THEN
      FOR line_item_rec IN
        SELECT pli.product_id
        FROM seller_main.payment_line_items pli
        WHERE pli.transaction_id = guest_purchase_record.transaction_id
          AND pli.item_type = 'order_bump'
      LOOP
        BEGIN
          PERFORM seller_main.grant_product_access_service_role(p_user_id, line_item_rec.product_id);
          claimed_count := claimed_count + 1;
        EXCEPTION WHEN OTHERS THEN
          PERFORM public.log_admin_action(
            'guest_claim_bump_failure', 'payment_line_items',
            guest_purchase_record.transaction_id::TEXT,
            jsonb_build_object(
              'severity', 'ERROR', 'error_type', 'bump_access_grant_failure',
              'user_id', p_user_id, 'product_id', line_item_rec.product_id,
              'transaction_id', guest_purchase_record.transaction_id,
              'function_name', 'claim_guest_purchases_for_user'
            )
          );
          NULL;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'claimed_count', claimed_count,
    'user_email', user_email_var
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

-- =============================================================================
-- 5. Urgency Timer for Order Bumps
-- =============================================================================

-- Add urgency timer column to order_bumps table.
-- NULL = no urgency timer shown, value = countdown duration in minutes.
-- The timer is purely a UI element — it counts from the moment the buyer
-- enters the checkout page and has no backend enforcement.
ALTER TABLE seller_main.order_bumps
  ADD COLUMN IF NOT EXISTS urgency_duration_minutes INTEGER
  CHECK (urgency_duration_minutes IS NULL OR (urgency_duration_minutes >= 1 AND urgency_duration_minutes <= 1440));

-- Refresh proxy view to include new column
CREATE OR REPLACE VIEW public.order_bumps WITH (security_invoker = on) AS SELECT * FROM seller_main.order_bumps;

COMMENT ON COLUMN seller_main.order_bumps.urgency_duration_minutes IS
  'Urgency countdown timer in minutes (NULL = no timer, 1-1440). Purely cosmetic — counts from page load.';

-- Drop and recreate admin_get_product_order_bumps to allow return type change
DROP FUNCTION IF EXISTS seller_main.admin_get_product_order_bumps(UUID);

CREATE OR REPLACE FUNCTION seller_main.admin_get_product_order_bumps(
  product_id_param UUID
) RETURNS TABLE (
  bump_id UUID,
  bump_product_id UUID,
  bump_product_name TEXT,
  bump_price NUMERIC,
  bump_title TEXT,
  bump_description TEXT,
  is_active BOOLEAN,
  display_order INTEGER,
  access_duration_days INTEGER,
  urgency_duration_minutes INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  RETURN QUERY
  SELECT
    ob.id as bump_id,
    ob.bump_product_id,
    p.name as bump_product_name,
    ob.bump_price,
    ob.bump_title,
    ob.bump_description,
    ob.is_active,
    ob.display_order,
    ob.access_duration_days,
    ob.urgency_duration_minutes,
    ob.created_at,
    ob.updated_at
  FROM seller_main.order_bumps ob
  INNER JOIN seller_main.products p ON p.id = ob.bump_product_id
  WHERE ob.main_product_id = product_id_param
  ORDER BY ob.display_order ASC, ob.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- Re-grant after DROP+CREATE (DROP loses previous GRANTs)
GRANT EXECUTE ON FUNCTION seller_main.admin_get_product_order_bumps TO authenticated, service_role;

-- Proxy view for backward compatibility
CREATE OR REPLACE VIEW public.payment_line_items WITH (security_invoker = on) AS SELECT * FROM seller_main.payment_line_items;

-- Explicit table grants (Security Rule #5)
-- payment_line_items: authenticated users can SELECT own (RLS enforced)
REVOKE ALL ON seller_main.payment_line_items FROM anon, authenticated;
GRANT SELECT ON seller_main.payment_line_items TO authenticated;
