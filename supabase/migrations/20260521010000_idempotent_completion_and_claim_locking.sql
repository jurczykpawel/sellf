-- Idempotent payment completion + concurrent guest claim locking.
--
-- Two surgical changes to existing functions:
-- 1) seller_main.process_stripe_payment_completion: when a duplicate webhook
--    arrives for a row already in 'pending' state, promote it to the new
--    status instead of silently doing nothing. The old DO NOTHING left rows
--    stuck in 'pending' when Stripe retried a webhook after the first one
--    recorded 'pending' (rare with the current code path, but cheap to
--    harden).
-- 2) seller_main.claim_guest_purchases_for_user: serialize concurrent
--    callers via FOR UPDATE SKIP LOCKED so two parallel sign-ups against
--    the same email do not both try to claim the same guest row and trip
--    the optimistic locking retry path.
--
-- Both bodies are copied verbatim from supabase/migrations/20250102000000_payment_system.sql
-- with the noted clauses changed. CREATE OR REPLACE preserves any earlier
-- GRANTs; the explicit REVOKE + GRANT at the bottom matches the policy from
-- 20260302000000_restrict_rpc_function_access.sql.
--
-- NB: no top-level BEGIN/COMMIT — the production migration runner
-- (apply_migration RPC) wraps the apply in its own transaction and cannot
-- execute transaction commands via PL/pgSQL EXECUTE.

CREATE OR REPLACE FUNCTION seller_main.process_stripe_payment_completion(
    session_id_param TEXT,
    product_id_param UUID,
    customer_email_param TEXT,
    amount_total NUMERIC,
    currency_param TEXT,
    stripe_payment_intent_id TEXT DEFAULT NULL,
    user_id_param UUID DEFAULT NULL -- When specified, caller must be authorized for this user
) RETURNS JSONB AS $$
DECLARE
    current_user_id UUID;
    product_record RECORD;
    existing_user_id UUID;
    access_expires_at TIMESTAMPTZ := NULL;
    scenario TEXT;
    result JSONB;
BEGIN
    -- TEMPORARY DEBUG: Log function entry with all parameters
    BEGIN
        PERFORM public.log_admin_action(
            'payment_processing_debug_start',
            'payment_transactions',
            session_id_param,
            jsonb_build_object(
                'severity', 'DEBUG',
                'session_id', session_id_param,
                'product_id', product_id_param,
                'customer_email', customer_email_param,
                'amount', amount_total,
                'currency', currency_param,
                'stripe_payment_intent_id', stripe_payment_intent_id,
                'user_id_param', user_id_param,
                'function_name', 'process_stripe_payment_completion',
                'timestamp', extract(epoch from NOW()),
                'context', 'debug_function_entry'
            )
        );
    EXCEPTION
        WHEN OTHERS THEN
            -- If logging fails, continue anyway
            NULL;
    END;

    -- Rate limiting: 100 calls per hour for payment processing (increased for checkout)
    IF NOT public.check_rate_limit('process_stripe_payment_completion', 100, 3600) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded. Please wait before processing another payment.');
    END IF;

    -- Enhanced input validation (SECURITY)
    IF session_id_param IS NULL OR length(session_id_param) = 0 OR length(session_id_param) > 255 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID');
    END IF;
    
    -- Validate session_id format (Stripe sessions start with 'cs_' or Payment Intents with 'pi_')
    IF NOT (session_id_param ~* '^(cs_|pi_)[a-zA-Z0-9_]+$') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID format');
    END IF;
    
    IF product_id_param IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product ID is required');
    END IF;
    
    -- Enhanced email validation using dedicated function
    IF NOT public.validate_email_format(customer_email_param) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valid email address is required');
    END IF;
    
    IF amount_total IS NULL OR amount_total <= 0 OR amount_total > 99999999 THEN -- Max $999,999.99
        RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
    END IF;
    
    -- Enhanced currency validation with ISO 4217 code checking
    IF currency_param IS NULL OR 
       length(currency_param) != 3 OR
       NOT (upper(currency_param) ~ '^[A-Z]{3}$') OR
       NOT (upper(currency_param) IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RUB', 'TRY', 'BRL', 'MXN', 'INR', 'KRW', 'SGD', 'HKD', 'NZD', 'ZAR', 'ILS', 'THB', 'MYR', 'PHP', 'IDR', 'VND')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid or unsupported currency code');
    END IF;
    
    -- Validate Stripe Payment Intent ID format if provided
    IF stripe_payment_intent_id IS NOT NULL AND (
       length(stripe_payment_intent_id) = 0 OR 
       length(stripe_payment_intent_id) > 255 OR
       NOT (stripe_payment_intent_id ~* '^pi_[a-zA-Z0-9_]+$')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid Stripe Payment Intent ID format');
    END IF;

    -- Authorization check: Verify caller has permission to process payments for the specified user (SECURITY)
    IF user_id_param IS NOT NULL THEN
        -- If user_id is specified, verify authorization
        IF (select auth.role()) = 'service_role' THEN
            -- Service role can process payments for any user (trusted backend)
            current_user_id := user_id_param;
        ELSIF auth.uid() = user_id_param THEN
            -- Authenticated user can only process payments for themselves
            current_user_id := user_id_param;
        ELSE
            -- Unauthorized: user trying to process payment for different user
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Cannot process payment for another user');
        END IF;
    ELSE
        -- No user_id specified - this is a guest purchase
        current_user_id := NULL;
    END IF;

    -- Enhanced idempotency check: Check both session_id AND stripe_payment_intent_id
    -- This prevents duplicate processing if Stripe sends webhooks multiple times
    SELECT 
        p.id, p.name, p.slug, p.auto_grant_duration_days, p.price, p.currency as product_currency,
        EXISTS(
            SELECT 1 FROM seller_main.payment_transactions pt 
            WHERE pt.session_id = session_id_param 
               OR (process_stripe_payment_completion.stripe_payment_intent_id IS NOT NULL AND pt.stripe_payment_intent_id = process_stripe_payment_completion.stripe_payment_intent_id)
        ) as transaction_exists
    INTO product_record
    FROM seller_main.products p
    WHERE p.id = product_id_param AND p.is_active = true;

    -- Check if product exists
    IF product_record.id IS NULL THEN
        -- TEMPORARY DEBUG: Log product not found
        BEGIN
            PERFORM public.log_admin_action(
                'payment_processing_debug_product_not_found',
                'products',
                product_id_param::TEXT,
                jsonb_build_object(
                    'severity', 'DEBUG',
                    'product_id', product_id_param,
                    'session_id', session_id_param,
                    'context', 'debug_product_lookup_failed'
                )
            );
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;
        
        RETURN jsonb_build_object('success', false, 'error', 'Product not found or inactive');
    END IF;

    -- TEMPORARY DEBUG: Log product found and transaction status
    BEGIN
        PERFORM public.log_admin_action(
            'payment_processing_debug_product_found',
            'products',
            product_record.id::TEXT,
            jsonb_build_object(
                'severity', 'DEBUG',
                'product_id', product_record.id,
                'product_name', product_record.name,
                'transaction_exists', product_record.transaction_exists,
                'session_id', session_id_param,
                'context', 'debug_product_lookup_success'
            )
        );
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;

    -- Calculate access expiry once (for response)
    IF product_record.auto_grant_duration_days IS NOT NULL THEN
        access_expires_at := NOW() + (product_record.auto_grant_duration_days || ' days')::INTERVAL;
    END IF;

    -- EARLY RETURN: Check for idempotency first (much cleaner than nested IF/ELSE)
    IF product_record.transaction_exists THEN
        -- Transaction already exists - return idempotent success
        scenario := 'idempotent_transaction';
        
        -- TEMPORARY DEBUG: Log idempotent processing
        BEGIN
            PERFORM public.log_admin_action(
                'payment_processing_debug_idempotent',
                'payment_transactions',
                session_id_param,
                jsonb_build_object(
                    'severity', 'DEBUG',
                    'session_id', session_id_param,
                    'product_id', product_id_param,
                    'customer_email', customer_email_param,
                    'scenario', scenario,
                    'context', 'debug_idempotent_webhook_detected'
                )
            );
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;
        
        RETURN jsonb_build_object(
            'success', true,
            'access_granted', true,
            'already_had_access', true, -- This is true because we found an existing transaction
            'scenario', scenario,
            'access_expires_at', access_expires_at,
            'requires_login', false,
            'send_magic_link', false,
            'customer_email', customer_email_param,
            'grant_details', 'Payment already processed successfully'
        );
    END IF;

    -- NEW TRANSACTION: Process payment and grant access
    INSERT INTO seller_main.payment_transactions (
        session_id, user_id, product_id, customer_email, amount, currency, 
        stripe_payment_intent_id, status, metadata
    ) VALUES (
        session_id_param, current_user_id, product_id_param, customer_email_param, amount_total, currency_param,
        process_stripe_payment_completion.stripe_payment_intent_id, 'completed',
        jsonb_build_object(
            'stripe_session_id', session_id_param,
            'product_slug', product_record.slug,
            'amount_display', (amount_total / 100.0)::text || ' ' || upper(currency_param),
            'idempotency_check', 'webhook_processed',
            'processed_at', NOW()
        )
    ) ON CONFLICT (session_id) DO UPDATE
        SET status = EXCLUDED.status,
            updated_at = NOW()
      WHERE seller_main.payment_transactions.status = 'pending'
        AND EXCLUDED.status IN ('completed', 'failed');

    -- SCENARIO 1: User is logged in
    IF current_user_id IS NOT NULL THEN
        scenario := 'logged_in_user';
        
        -- Use optimistic locking function with enhanced error handling
        BEGIN
            SELECT seller_main.grant_product_access_service_role(current_user_id, product_id_param) INTO result;
            IF (result->>'success')::boolean = false THEN
                -- Handle specific optimistic locking failures
                IF (result->>'retry_exceeded')::boolean = true THEN
                    -- High concurrency - this is actually quite rare and indicates very high traffic
                    PERFORM public.log_admin_action(
                        'high_concurrency_detected',
                        'user_product_access',
                        current_user_id::TEXT || '_' || product_id_param::TEXT,
                        jsonb_build_object(
                            'severity', 'WARNING',
                            'error_type', 'optimistic_lock_retry_exceeded',
                            'user_id', current_user_id,
                            'product_id', product_id_param,
                            'session_id', session_id_param,
                            'retry_count', result->>'retry_count',
                            'function_name', 'process_stripe_payment_completion',
                            'timestamp', extract(epoch from NOW()),
                            'customer_email', customer_email_param,
                            'context', 'payment_processing'
                        )
                    );
                    
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', 'High concurrency detected. Please try again.',
                        'error_type', 'concurrency_conflict',
                        'retry_safe', true,
                        'customer_email', customer_email_param
                    );
                ELSE
                    -- Other error from optimistic locking function
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', 'Failed to grant access: ' || COALESCE(result->>'error', 'Unknown error'),
                        'error_details', result,
                        'customer_email', customer_email_param
                    );
                END IF;
            END IF;
        EXCEPTION 
            WHEN OTHERS THEN
                -- Critical error: payment processed but access grant failed
                PERFORM public.log_admin_action(
                    'critical_access_grant_failure',
                    'user_product_access',
                    current_user_id::TEXT || '_' || product_id_param::TEXT,
                    jsonb_build_object(
                        'severity', 'CRITICAL',
                        'error_type', 'access_grant_exception',
                        'error_code', SQLSTATE,
                        'error_message', SQLERRM,
                        'user_id', current_user_id,
                        'product_id', product_id_param,
                        'session_id', session_id_param,
                        'payment_amount', amount_total,
                        'customer_email', customer_email_param,
                        'function_name', 'process_stripe_payment_completion',
                        'timestamp', extract(epoch from NOW()),
                        'context', 'payment_processing'
                    )
                );
                
                RETURN jsonb_build_object(
                    'success', false, 
                    'error', 'Payment processed but access grant failed. Support has been notified.',
                    'error_reference', extract(epoch from NOW())::bigint,
                    'requires_manual_intervention', true,
                    'customer_email', customer_email_param
                );
        END;

        RETURN jsonb_build_object(
            'success', true,
            'access_granted', true,
            'already_had_access', false, -- Optimistic function provides this info in result
            'scenario', scenario,
            'access_expires_at', access_expires_at,
            'requires_login', false,
            'send_magic_link', false,
            'customer_email', customer_email_param,
            'grant_details', result -- Include optimistic locking details
        );
    END IF;

    -- SCENARIO 2 & 3: No current user - single query to check if email exists
    SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param;

    IF existing_user_id IS NOT NULL THEN
        -- SCENARIO 2: Email exists - grant access to that user using optimistic locking
        scenario := 'existing_user_email';
        
        BEGIN
            SELECT seller_main.grant_product_access_service_role(existing_user_id, product_id_param) INTO result;

            IF (result->>'success')::boolean = false THEN
                -- Handle specific optimistic locking failures
                IF (result->>'retry_exceeded')::boolean = true THEN
                    PERFORM public.log_admin_action(
                        'high_concurrency_detected',
                        'user_product_access',
                        existing_user_id::TEXT || '_' || product_id_param::TEXT,
                        jsonb_build_object(
                            'severity', 'WARNING',
                            'error_type', 'optimistic_lock_retry_exceeded',
                            'user_id', existing_user_id,
                            'product_id', product_id_param,
                            'session_id', session_id_param,
                            'retry_count', result->>'retry_count',
                            'customer_email', customer_email_param,
                            'function_name', 'process_stripe_payment_completion',
                            'timestamp', extract(epoch from NOW()),
                            'context', 'payment_processing_existing_user'
                        )
                    );
                    
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', 'High concurrency detected. Please try again.',
                        'error_type', 'concurrency_conflict',
                        'retry_safe', true,
                        'customer_email', customer_email_param
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', 'Failed to grant access: ' || COALESCE(result->>'error', 'Unknown error'),
                        'error_details', result,
                        'customer_email', customer_email_param
                    );
                END IF;
            END IF;
        EXCEPTION 
            WHEN OTHERS THEN
                -- Critical error: payment processed but access grant failed
                PERFORM public.log_admin_action(
                    'critical_access_grant_failure',
                    'user_product_access',
                    existing_user_id::TEXT || '_' || product_id_param::TEXT,
                    jsonb_build_object(
                        'severity', 'CRITICAL',
                        'error_type', 'access_grant_exception',
                        'error_code', SQLSTATE,
                        'error_message', SQLERRM,
                        'user_id', existing_user_id,
                        'product_id', product_id_param,
                        'session_id', session_id_param,
                        'payment_amount', amount_total,
                        'customer_email', customer_email_param,
                        'function_name', 'process_stripe_payment_completion',
                        'timestamp', extract(epoch from NOW()),
                        'context', 'payment_processing_existing_user'
                    )
                );
                
                RETURN jsonb_build_object(
                    'success', false, 
                    'error', 'Payment processed but access grant failed. Support has been notified.',
                    'error_reference', extract(epoch from NOW())::bigint,
                    'requires_manual_intervention', true,
                    'customer_email', customer_email_param
                );
        END;

        result := jsonb_build_object(
            'success', true,
            'access_granted', true,
            'already_had_access', false,
            'scenario', scenario,
            'access_expires_at', access_expires_at,
            'requires_login', true,
            'send_magic_link', true,
            'customer_email', customer_email_param,
            'grant_details', result
        );
    ELSE
        -- SCENARIO 3: Email not in database - save as guest purchase with proper idempotency
        scenario := 'guest_purchase';
        
        -- Enhanced idempotency: Use INSERT with proper conflict handling
        BEGIN
            INSERT INTO seller_main.guest_purchases (customer_email, product_id, session_id, transaction_amount)
            VALUES (customer_email_param, product_id_param, session_id_param, amount_total);
        EXCEPTION 
            WHEN unique_violation THEN
                -- Idempotency: Guest purchase already exists for this session
                -- This is expected behavior for duplicate webhooks - continue processing normally
                NULL; -- Do nothing, guest purchase already recorded
        END;

        result := jsonb_build_object(
            'success', true,
            'access_granted', false,
            'already_had_access', false,
            'scenario', scenario,
            'access_expires_at', access_expires_at,
            'requires_login', true,
            'send_magic_link', true,
            'is_guest_purchase', true,
            'customer_email', customer_email_param
        );
    END IF;

    RETURN result;

EXCEPTION
    WHEN serialization_failure THEN
        -- SERIALIZABLE transaction conflicts - safe to retry for concurrent webhooks
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Concurrent processing detected. This is normal for webhook retries.',
            'retry_safe', true,
            'error_reference', extract(epoch from NOW())::bigint
        );
    
    WHEN unique_violation THEN
        -- Idempotency: Payment already processed - this is expected for duplicate webhooks
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'message', 'Payment already processed successfully',
            'error_reference', extract(epoch from NOW())::bigint
        );
    
    WHEN OTHERS THEN
        -- Log security-relevant errors without exposing internal details
        BEGIN
            PERFORM public.log_admin_action(
                'payment_processing_error',
                'payment_transactions',
                session_id_param,
                jsonb_build_object(
                    'severity', 'ERROR',
                    'error_type', 'payment_processing_exception',
                    'error_code', SQLSTATE,
                    'error_message', SQLERRM,
                    'user_id', current_user_id,
                    'customer_email_hash', encode(extensions.digest(customer_email_param, 'sha256'), 'hex'),
                    'product_id', product_id_param,
                    'function_name', 'process_stripe_payment_completion',
                    'timestamp', extract(epoch from NOW()),
                    'context', 'payment_processing'
                )
            );
        EXCEPTION
            WHEN OTHERS THEN
                -- If logging fails, continue with error response
                NULL;
        END;
        
        -- TEMPORARY DEBUG: Return detailed error information for troubleshooting
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Payment processing failed: ' || COALESCE(SQLERRM, 'Unknown database error'),
            'error_code', SQLSTATE,
            'error_details', jsonb_build_object(
                'sqlstate', SQLSTATE,
                'error_message', SQLERRM,
                'session_id', session_id_param,
                'product_id', product_id_param,
                'user_id', current_user_id,
                'customer_email', customer_email_param,
                'amount', amount_total,
                'currency', currency_param,
                'function', 'process_stripe_payment_completion',
                'timestamp', NOW()
            ),
            'error_reference', extract(epoch from NOW())::bigint,
            'retry_safe', CASE 
                WHEN SQLSTATE LIKE '08%' THEN true  -- Connection errors
                WHEN SQLSTATE LIKE '53%' THEN true  -- Resource errors
                WHEN SQLSTATE LIKE '57%' THEN true  -- Operator intervention
                ELSE false
            END
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '15s'; -- Increased for production webhook traffic and complex transactions

REVOKE EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) TO service_role;

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
    FOR UPDATE OF gp SKIP LOCKED
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

          UPDATE seller_main.payment_transactions
          SET user_id = p_user_id,
              updated_at = NOW()
          WHERE session_id = guest_purchase_record.session_id
            AND user_id IS NULL;
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

    -- Grant access for bump products from payment_line_items.
    -- Use the snapshotted access_duration_override per line item so the claim
    -- path resolves the bump's UI override without re-querying order_bumps
    -- (the bump row may have been edited or deleted since the purchase).
    IF guest_purchase_record.transaction_id IS NOT NULL THEN
      FOR line_item_rec IN
        SELECT pli.product_id, pli.access_duration_override
        FROM seller_main.payment_line_items pli
        WHERE pli.transaction_id = guest_purchase_record.transaction_id
          AND pli.item_type = 'order_bump'
      LOOP
        BEGIN
          PERFORM seller_main.grant_product_access_service_role(
            p_user_id,
            line_item_rec.product_id,
            override_duration_days_param => line_item_rec.access_duration_override
          );
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

REVOKE EXECUTE ON FUNCTION seller_main.claim_guest_purchases_for_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seller_main.claim_guest_purchases_for_user(UUID) TO service_role;
