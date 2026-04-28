-- =============================================================================
-- Fix: Existing user guest checkout & retroactive claim for logged-in users
-- =============================================================================
-- Two bugs fixed in process_stripe_payment_completion_with_bump:
--
-- BUG #1 (SCENARIO 2): When a registered user did a guest checkout (without
-- logging in first), the RPC only created a guest_purchases row and never
-- granted access. The trigger handle_new_user_registration claims unclaimed
-- guest_purchases ONLY on user creation (INSERT). For pre-existing users
-- subsequent logins do not fire that trigger, so the product was never granted.
--
-- BUG #2 (idempotency): When a logged-in user revisits payment-status after
-- the guest_purchase was created, the RPC's idempotency check returned
-- is_guest_purchase=true, send_magic_link=true regardless of current login
-- state. Frontend then re-displayed the magic link UI to an already-logged-in
-- user (and sent another magic link).
--
-- FIX:
--   1. SCENARIO 2: when guest checkout email matches an existing user, grant
--      access to that user immediately (record transaction with user_id set).
--      Still send magic link so the user can log in to view the product.
--   2. Idempotency: if current_user_id is provided AND the email matches the
--      user's own auth.users.email AND there is an unclaimed guest_purchase,
--      claim it now (grant access + mark guest_purchase claimed).
--
-- Both paths reuse seller_main.grant_product_access_service_role for the
-- actual access record write.
--
-- @see vault/brands/_shared/reference/sellf-production-readiness-tests.md
-- @see admin-panel/tests/unit/security/payment-completion-rpc.test.ts
-- =============================================================================

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
  -- Retroactive claim variables
  existing_transaction_id UUID;
  caller_email TEXT;
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
    -- BUG #2 FIX: retroactive claim path.
    -- If the caller is now logged in AND owns the customer email, claim any
    -- unclaimed guest_purchase for this session and grant access.
    IF current_user_id IS NOT NULL THEN
      SELECT email INTO caller_email FROM auth.users WHERE id = current_user_id;
      IF caller_email IS NOT NULL AND lower(caller_email) = lower(customer_email_param) THEN
        SELECT id INTO existing_transaction_id
        FROM seller_main.payment_transactions
        WHERE session_id = session_id_param
        LIMIT 1;

        IF EXISTS (
          SELECT 1 FROM seller_main.guest_purchases
          WHERE session_id = session_id_param AND claimed_by_user_id IS NULL
        ) THEN
          -- Grant access for the main product
          PERFORM seller_main.grant_product_access_service_role(current_user_id, product_id_param);

          -- Grant access for any bump products recorded as line items.
          -- Use the snapshotted access_duration_override per line item so the
          -- retroactive claim resolves the bump's UI override even if the
          -- order_bumps row has since been edited or deleted.
          FOR bump_rec IN
            SELECT pli.product_id, pli.access_duration_override
            FROM seller_main.payment_line_items pli
            WHERE pli.transaction_id = existing_transaction_id
              AND pli.item_type = 'order_bump'
          LOOP
            PERFORM seller_main.grant_product_access_service_role(
              current_user_id,
              bump_rec.product_id,
              override_duration_days_param => bump_rec.access_duration_override
            );
          END LOOP;

          -- Mark guest_purchase as claimed
          UPDATE seller_main.guest_purchases
          SET claimed_by_user_id = current_user_id,
              claimed_at = NOW()
          WHERE session_id = session_id_param;

          -- Backfill user_id on the transaction so future lookups treat it as owned
          UPDATE seller_main.payment_transactions
          SET user_id = current_user_id,
              updated_at = NOW()
          WHERE id = existing_transaction_id AND user_id IS NULL;

          RETURN jsonb_build_object(
            'success', true,
            'scenario', 'idempotent_claimed_for_logged_in_user',
            'access_granted', true,
            'is_guest_purchase', false,
            'send_magic_link', false,
            'requires_login', false,
            'customer_email', customer_email_param
          );
        END IF;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM seller_main.guest_purchases WHERE session_id = session_id_param AND claimed_by_user_id IS NULL) THEN
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
  SELECT id, name, auto_grant_duration_days, price, currency, allow_custom_price, custom_price_min INTO product_record
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

      IF product_record.allow_custom_price = true THEN
        -- PWYW: validate minimum price (custom_price_min) + bumps
        IF amount_total < ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * 100) THEN
          RAISE EXCEPTION 'Amount below minimum: got % cents, minimum is % cents',
            amount_total, ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * 100);
        END IF;
      ELSIF coupon_id_param IS NULL THEN
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
    -- BUG #1 FIX: when email matches an existing user but caller is not logged in,
    -- treat it as that user's purchase. This causes the row to be inserted with
    -- user_id = existing_user_id and access to be granted directly below.
    IF current_user_id IS NULL AND existing_user_id IS NOT NULL THEN
      current_user_id := existing_user_id;
    END IF;

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

    -- Snapshot access_duration_override per bump line item so the retroactive
    -- guest-claim path resolves the bump's UI override even if the order_bumps
    -- row is later edited or deleted.
    IF bump_count > 0 THEN
      FOR bump_rec IN
        SELECT
          p.id,
          p.name,
          ob.id as order_bump_id,
          ob.access_duration_days as access_duration_override,
          COALESCE(ob.bump_price, p.price) as price,
          p.currency
        FROM unnest(bump_ids_found) AS bid(id)
        JOIN seller_main.products p ON p.id = bid.id
        JOIN seller_main.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
        WHERE p.is_active = true AND ob.is_active = true
      LOOP
        INSERT INTO seller_main.payment_line_items (
          transaction_id, product_id, item_type, quantity, unit_price, total_price,
          currency, product_name, order_bump_id, access_duration_override
        ) VALUES (
          transaction_id_var, bump_rec.id, 'order_bump', 1,
          bump_rec.price, bump_rec.price,
          upper(COALESCE(bump_rec.currency, currency_param)), bump_rec.name,
          bump_rec.order_bump_id, bump_rec.access_duration_override
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

    -- SCENARIO 1: Logged-in user OR existing-user-auto-claimed (current_user_id was set above)
    IF current_user_id IS NOT NULL THEN
      PERFORM seller_main.grant_product_access_service_role(current_user_id, product_id_param);

      -- Pass each bump's access_duration_days as override to the helper so
      -- renewal/extension uses the bump's UI override (NULL = use bump
      -- product default; 0 = unlimited; N>0 = N days).
      IF bump_count > 0 THEN
        FOR bump_rec IN
          SELECT u.bid AS product_id, ob.access_duration_days AS access_duration_override
          FROM unnest(bump_ids_found) AS u(bid)
          JOIN seller_main.order_bumps ob
            ON ob.bump_product_id = u.bid AND ob.main_product_id = product_id_param
        LOOP
          PERFORM seller_main.grant_product_access_service_role(
            current_user_id,
            bump_rec.product_id,
            override_duration_days_param => bump_rec.access_duration_override
          );
        END LOOP;
      END IF;

      -- If the caller was not actually logged in but we matched an existing user,
      -- still send magic link so they can sign in to view the product.
      IF user_id_param IS NULL AND existing_user_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'scenario', 'guest_purchase_user_exists_with_bump',
          'access_granted', true,
          'is_guest_purchase', false,
          'send_magic_link', true,
          'requires_login', true,
          'bump_access_granted', bump_count > 0,
          'bump_count', bump_count,
          'customer_email', customer_email_param
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'logged_in_user_with_bump',
        'access_granted', true,
        'bump_access_granted', bump_count > 0,
        'bump_count', bump_count,
        'customer_email', customer_email_param
      );

    -- SCENARIO 2: Pure guest purchase, no matching user
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
