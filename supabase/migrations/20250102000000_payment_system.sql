-- Complete payment system with guest checkout and security
-- Migration: 20250717_complete_payment_system

-- Suppress NOTICE messages during migration (e.g., "relation already exists, skipping")
SET client_min_messages = warning;

BEGIN;

-- =============================================================================
-- REQUIRED EXTENSIONS
-- =============================================================================

-- Ensure pgcrypto is available for cryptographic functions (digest, encode)
-- Note: Supabase has this pre-installed, but explicit declaration is good practice
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- UTILITY FUNCTIONS (MUST BE DEFINED FIRST)
-- =============================================================================

-- Secure email validation function with improved pattern
CREATE OR REPLACE FUNCTION validate_email_format(email_param TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Input validation
    IF email_param IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Length check (RFC 5321)
    IF length(email_param) < 3 OR length(email_param) > 254 THEN
        RETURN FALSE;
    END IF;
    
    -- Basic format validation with simplified but robust regex
    -- This pattern is more maintainable and covers most real-world cases
    IF NOT (email_param ~* '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$') THEN
        RETURN FALSE;
    END IF;
    
    -- Additional security checks
    IF email_param LIKE '%..%' OR     -- Consecutive dots
       email_param LIKE '.%' OR       -- Starting with dot
       email_param LIKE '%.' OR       -- Ending with dot
       email_param LIKE '%@.%' OR     -- Dot immediately after @
       email_param LIKE '%.@%' THEN   -- Dot immediately before @
        RETURN FALSE;
    END IF;
    
    -- Check for multiple @ symbols
    IF (length(email_param) - length(replace(email_param, '@', ''))) != 1 THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'; -- Increased for production traffic

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION validate_email_format TO service_role, authenticated;

-- =============================================================================
-- ADMIN SYSTEM
-- =============================================================================

-- Note: admin_users table already exists in initial schema migration
-- We'll add the admin_actions table with enhanced security

-- CRITICAL SECURITY NOTE: Rate limiting protection against IP spoofing
-- This migration relies on the enhanced check_rate_limit() function from the initial schema
-- which ONLY uses trusted server-side IP sources (inet_client_addr()) and NEVER trusts
-- client headers like x-forwarded-for which can be easily spoofed by attackers.
-- See: https://owasp.org/www-community/attacks/HTTP_Request_Smuggling
--
-- SECURE APPROACH:
-- ✅ inet_client_addr() - Real TCP connection IP (cannot be spoofed)
-- ✅ pg_backend_pid() - Server process ID (unique per connection)
-- ✅ Time-based fallbacks - Prevent complete bypass
--
-- INSECURE APPROACH (NEVER USE):
-- ❌ x-forwarded-for header - Easily spoofed by clients
-- ❌ x-real-ip header - Can be manipulated
-- ❌ Any client-provided header - Unreliable for security

-- Create admin_actions table for audit logging (SECURITY)
CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- Nullable for system/guest operations
  action VARCHAR(100) NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  target_type VARCHAR(50) NOT NULL CHECK (length(target_type) BETWEEN 1 AND 50),
  target_id VARCHAR(255) NOT NULL CHECK (length(target_id) BETWEEN 1 AND 255),
  details JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- admin_actions: service_role only (written via SECURITY DEFINER functions)
REVOKE ALL ON public.admin_actions FROM anon, authenticated;
GRANT ALL ON public.admin_actions TO service_role;

-- =============================================================================
-- PAYMENT TRACKING TABLES
-- =============================================================================

-- Create payment_transactions table for completed payments with COMPLETE IDEMPOTENCY PROTECTION
-- Note: For high-volume applications, consider partitioning by created_at (monthly/yearly)
-- to improve query performance and maintenance operations
CREATE TABLE IF NOT EXISTS seller_main.payment_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL CHECK (
    length(session_id) BETWEEN 1 AND 255 AND
    session_id ~* '^(cs_|pi_)[a-zA-Z0-9_]+$'
  ),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- Nullable for guest purchases
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  customer_email TEXT NOT NULL CHECK (public.validate_email_format(customer_email)),
  amount NUMERIC NOT NULL CHECK (amount > 0 AND amount <= 99999999), -- Amount in cents, max $999,999.99
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND 
    upper(currency) ~ '^[A-Z]{3}$' AND
    upper(currency) IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RUB', 'TRY', 'BRL', 'MXN', 'INR', 'KRW', 'SGD', 'HKD', 'NZD', 'ZAR', 'ILS', 'THB', 'MYR', 'PHP', 'IDR', 'VND')
  ),
  stripe_payment_intent_id TEXT CHECK (
    stripe_payment_intent_id IS NULL OR (
      length(stripe_payment_intent_id) BETWEEN 1 AND 255 AND
      stripe_payment_intent_id ~* '^pi_[a-zA-Z0-9_]+$'
    )
  ),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded', 'disputed')),
  refunded_amount NUMERIC DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount IS NOT NULL), -- Refunded amount in cents, must be non-negative and not null
  refunded_at TIMESTAMPTZ,
  refunded_by UUID REFERENCES auth.users(id), -- Admin who processed refund
  refund_id TEXT CHECK (
    refund_id IS NULL OR (
      length(refund_id) BETWEEN 1 AND 255 AND
      refund_id ~* '^re_[a-zA-Z0-9_]+$'
    )
  ), -- Stripe refund ID (re_xxx)
  refund_reason TEXT CHECK (refund_reason IS NULL OR length(refund_reason) BETWEEN 1 AND 1000),
  metadata JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Business logic constraints
  CONSTRAINT valid_refund_amount CHECK (refunded_amount <= amount),
  
  -- CRITICAL IDEMPOTENCY CONSTRAINTS (BULLETPROOF WEBHOOK PROTECTION)
  CONSTRAINT unique_session_id UNIQUE (session_id), -- Prevent duplicate session processing
  CONSTRAINT unique_stripe_payment_intent_id UNIQUE (stripe_payment_intent_id) DEFERRABLE INITIALLY DEFERRED -- Authoritative Stripe idempotency
);

-- =============================================================================
-- GUEST CHECKOUT SYSTEM
-- =============================================================================

-- Create guest_purchases table to track purchases by email before account creation
CREATE TABLE IF NOT EXISTS seller_main.guest_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_email TEXT NOT NULL CHECK (public.validate_email_format(customer_email)),
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  transaction_amount NUMERIC NOT NULL CHECK (transaction_amount >= 0 AND transaction_amount <= 99999999), -- Amount in cents, max $999,999.99
  session_id TEXT NOT NULL CHECK (
    length(session_id) BETWEEN 1 AND 255 AND
    session_id ~* '^(cs_|pi_)[a-zA-Z0-9_]+$'
  ),
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- When user creates account and claims
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (session_id) -- One purchase per session (session_id is unique per transaction)
);

-- =============================================================================
-- SECURITY SYSTEM (RATE LIMITING)
-- =============================================================================
-- Note: rate_limits table is already defined in the initial schema migration
-- with improved structure (user_id, function_name, window_start)

-- =============================================================================
-- INDEXES FOR PERFORMANCE (OPTIMIZED TO PREVENT WRITE DEGRADATION)
-- =============================================================================

-- NOTE: session_id and stripe_payment_intent_id indexes are NOT needed here
-- because UNIQUE constraints automatically create indexes for these columns

-- Essential indexes for core business queries
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON seller_main.payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_product_id ON seller_main.payment_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_customer_email ON seller_main.payment_transactions(customer_email);

-- BRIN index for time-based queries (minimal storage overhead, perfect for timestamp columns)
CREATE INDEX IF NOT EXISTS idx_payment_transactions_created_at ON seller_main.payment_transactions USING BRIN (created_at);

-- Critical compound indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_payment_transactions_email_date 
ON seller_main.payment_transactions(customer_email, created_at DESC);

-- Optimized compound index for admin refund queries (with WHERE clause for efficiency)
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status_date 
ON seller_main.payment_transactions(status, created_at DESC) 
WHERE status IN ('refunded', 'disputed');

-- NOTE: UNIQUE constraints are now defined directly in the table schema above
-- This eliminates the need for separate ALTER TABLE statements and ensures
-- atomic table creation with complete constraint validation from the start

-- Admin system indexes
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);

-- Guest checkout indexes
CREATE INDEX IF NOT EXISTS idx_guest_purchases_customer_email ON seller_main.guest_purchases(customer_email);
CREATE INDEX IF NOT EXISTS idx_guest_purchases_product_id ON seller_main.guest_purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_guest_purchases_claimed_by_user_id ON seller_main.guest_purchases(claimed_by_user_id) WHERE claimed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_purchases_session_id ON seller_main.guest_purchases(session_id);

CREATE INDEX IF NOT EXISTS idx_guest_purchases_cleanup 
ON seller_main.guest_purchases USING BRIN (created_at);

-- Additional BRIN index for rate_limits cleanup (complements existing B-tree indexes from initial schema)
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup_brin 
ON rate_limits USING BRIN (window_start);

-- Note: rate_limits B-tree indexes are already defined in the initial schema migration

-- =============================================================================
-- ROW LEVEL SECURITY SETUP
-- =============================================================================

-- Enable RLS on all tables
-- Note: admin_users RLS is already enabled in the initial schema migration
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.guest_purchases ENABLE ROW LEVEL SECURITY;
-- Note: rate_limits RLS is already enabled in the initial schema migration

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- Note: admin_users policies are already defined in the initial schema migration

-- Admin actions policies (SECURITY)
CREATE POLICY "Admins can view admin actions" ON admin_actions
    FOR SELECT USING (
        ( select public.is_admin() )
    );

CREATE POLICY "Admins can insert admin actions" ON admin_actions
    FOR INSERT WITH CHECK (
        -- Allow logged-in admins to insert with their own admin_id
        (admin_id = (select auth.uid()) AND
        ( select public.is_admin() )) OR
        -- Allow service_role (database functions) to insert with any admin_id (including NULL)
        (select (select auth.role())) = 'service_role'
    );

-- Combined SELECT policy for payment transactions
CREATE POLICY "Combined SELECT policy for payment transactions" ON seller_main.payment_transactions
    FOR SELECT 
    USING (
        user_id = (SELECT auth.uid()) OR  -- Users can see their own transactions
        ( select public.is_admin() ) OR  -- Admins can see all transactions
        (SELECT auth.role()) = 'service_role'  -- Service role can see all
    );

CREATE POLICY "Service role limited access payment transactions" ON seller_main.payment_transactions
    FOR INSERT 
    TO service_role
    WITH CHECK (true);

-- Admins can update payment transactions for refunds (SECURITY)
CREATE POLICY "Admins can update payment transactions for refunds" ON seller_main.payment_transactions
    FOR UPDATE 
    TO authenticated
    USING (
        ( select public.is_admin() )
    );


-- Combined SELECT policy for all roles
CREATE POLICY "Combined SELECT policy for guest purchases" ON seller_main.guest_purchases
    FOR SELECT 
    USING (
        claimed_by_user_id = (SELECT auth.uid()) OR 
        (SELECT auth.role()) = 'service_role'
    );

-- Service role policies for modifications only
CREATE POLICY "Service role can insert guest purchases" ON seller_main.guest_purchases
    FOR INSERT 
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update guest purchases" ON seller_main.guest_purchases
    FOR UPDATE 
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can delete guest purchases" ON seller_main.guest_purchases
    FOR DELETE 
    TO service_role
    USING (true);


-- Note: rate_limits RLS policies are already defined in the initial schema migration

-- =============================================================================
-- DATABASE FUNCTIONS
-- =============================================================================
-- Note: Rate limiting functions are already defined in the initial schema migration
-- We reuse the existing check_rate_limit() function for consistency and performance

-- Optimistic locking helper: Add version column to user_product_access table if it doesn't exist
-- This approach eliminates the need for advisory locks by using database-level concurrency control
DO $$
BEGIN
    -- Add version column for optimistic locking if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'seller_main' AND table_name = 'user_product_access' 
        AND column_name = 'version'
    ) THEN
        ALTER TABLE seller_main.user_product_access ADD COLUMN version INTEGER DEFAULT 1 NOT NULL;
        
        -- Refresh proxy view to include new column
        CREATE OR REPLACE VIEW public.user_product_access WITH (security_invoker = on) AS SELECT * FROM seller_main.user_product_access;
        
        -- Create index for efficient version-based queries
        CREATE INDEX IF NOT EXISTS idx_user_product_access_version 
        ON seller_main.user_product_access(user_id, product_id, version);
        
        -- Update existing records to have version = 1
        UPDATE seller_main.user_product_access SET version = 1 WHERE version IS NULL;
    END IF;
END $$;

-- Optimistic locking version of grant_product_access function
-- This approach eliminates advisory locks by using version-based concurrency control
-- Key benefits: No connection pooling issues, no lock timeouts, better scalability
-- Trade-off: May require retry on high concurrency (handled by caller)
CREATE OR REPLACE FUNCTION seller_main.grant_product_access_service_role(
    user_id_param UUID,
    product_id_param UUID,
    max_retries INTEGER DEFAULT 3
) RETURNS JSONB AS $$
DECLARE
    product_auto_duration INTEGER;
    existing_record RECORD;
    new_expires_at TIMESTAMPTZ := NULL;
    final_duration INTEGER := NULL;
    retry_count INTEGER := 0;
    rows_affected INTEGER;
BEGIN
    -- Input validation
    IF user_id_param IS NULL OR product_id_param IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User ID and Product ID are required'
        );
    END IF;
    
    -- Get product configuration
    SELECT auto_grant_duration_days 
    INTO product_auto_duration
    FROM seller_main.products 
    WHERE id = product_id_param AND is_active = true;

    -- If product doesn't exist, return error
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Product not found or inactive'
        );
    END IF;

    -- Retry loop for optimistic locking
    WHILE retry_count < max_retries LOOP
        -- Get current state (including version for optimistic locking)
        SELECT 
            access_expires_at,
            version,
            (access_expires_at IS NULL) as has_permanent_access,
            (access_expires_at IS NOT NULL AND access_expires_at > NOW()) as has_active_access
        INTO existing_record
        FROM seller_main.user_product_access
        WHERE user_id = user_id_param AND product_id = product_id_param;

        -- Calculate new expiration based on business logic
        IF FOUND THEN
            -- User has existing access record
            IF existing_record.has_permanent_access THEN
                -- User has PERMANENT access - NEVER downgrade
                new_expires_at := NULL;
                final_duration := NULL;
            ELSIF existing_record.has_active_access THEN
                -- User has active LIMITED access
                IF product_auto_duration IS NOT NULL THEN
                    -- Extend existing access
                    new_expires_at := existing_record.access_expires_at + (product_auto_duration || ' days')::INTERVAL;
                    final_duration := product_auto_duration;
                ELSE
                    -- Upgrade to permanent
                    new_expires_at := NULL;
                    final_duration := NULL;
                END IF;
            ELSE
                -- User's access expired - standard logic
                IF product_auto_duration IS NOT NULL THEN
                    new_expires_at := NOW() + (product_auto_duration || ' days')::INTERVAL;
                    final_duration := product_auto_duration;
                ELSE
                    new_expires_at := NULL;
                    final_duration := NULL;
                END IF;
            END IF;

            -- Optimistic update with version check
            UPDATE seller_main.user_product_access 
            SET 
                access_granted_at = NOW(),
                access_duration_days = final_duration,
                access_expires_at = CASE
                    -- Never downgrade from permanent to limited
                    WHEN access_expires_at IS NULL THEN NULL
                    -- Otherwise use calculated value
                    ELSE new_expires_at
                END,
                version = version + 1
            WHERE 
                user_id = user_id_param 
                AND product_id = product_id_param 
                AND version = existing_record.version; -- Optimistic locking condition
            
            GET DIAGNOSTICS rows_affected = ROW_COUNT;
            
            IF rows_affected = 1 THEN
                -- Success! Update succeeded
                RETURN jsonb_build_object(
                    'success', true,
                    'operation', 'updated_existing',
                    'had_permanent_access', existing_record.has_permanent_access,
                    'had_active_access', existing_record.has_active_access,
                    'new_expires_at', new_expires_at,
                    'retry_count', retry_count
                );
            ELSE
                -- Optimistic lock failure - someone else modified the record
                retry_count := retry_count + 1;
                
                -- Small delay before retry (exponential backoff)
                IF retry_count < max_retries THEN
                    PERFORM pg_sleep(0.01 * (2 ^ retry_count)); -- 10ms, 20ms, 40ms
                END IF;
                
                CONTINUE; -- Retry the loop
            END IF;
        ELSE
            -- No existing record - create new with version = 1
            IF product_auto_duration IS NOT NULL THEN
                new_expires_at := NOW() + (product_auto_duration || ' days')::INTERVAL;
                final_duration := product_auto_duration;
            ELSE
                new_expires_at := NULL;
                final_duration := NULL;
            END IF;

            -- Insert new record with optimistic locking protection
            BEGIN
                INSERT INTO seller_main.user_product_access (
                    user_id, 
                    product_id, 
                    access_duration_days, 
                    access_expires_at,
                    access_granted_at,
                    version
                )
                VALUES (
                    user_id_param, 
                    product_id_param, 
                    final_duration, 
                    new_expires_at,
                    NOW(),
                    1
                );
                
                -- Success! Insert succeeded
                RETURN jsonb_build_object(
                    'success', true,
                    'operation', 'created_new',
                    'new_expires_at', new_expires_at,
                    'retry_count', retry_count
                );
                
            EXCEPTION 
                WHEN unique_violation THEN
                    -- Someone else created the record concurrently
                    retry_count := retry_count + 1;
                    
                    -- Small delay before retry
                    IF retry_count < max_retries THEN
                        PERFORM pg_sleep(0.01 * (2 ^ retry_count));
                    END IF;
                    
                    CONTINUE; -- Retry the loop
            END;
        END IF;
    END LOOP;
    
    -- All retries exhausted - CRITICAL: Log this business failure
    BEGIN
        PERFORM public.log_admin_action(
            'critical_optimistic_lock_exhausted',
            'user_product_access',
            user_id_param::TEXT || '_' || product_id_param::TEXT,
            jsonb_build_object(
                'severity', 'CRITICAL',
                'error_type', 'optimistic_lock_retry_exhausted',
                'user_id', user_id_param,
                'product_id', product_id_param,
                'retry_count', retry_count,
                'max_retries', max_retries,
                'function_name', 'grant_product_access_service_role',
                'timestamp', extract(epoch from NOW()),
                'business_impact', 'Payment processed but product access not granted due to high concurrency',
                'context', 'optimistic_locking'
            )
        );
    EXCEPTION 
        WHEN OTHERS THEN
            -- If logging fails, continue anyway
            NULL;
    END;
    
    -- All retries exhausted
    RETURN jsonb_build_object(
        'success', false,
        'error', 'Concurrency conflict: Could not complete operation after retries',
        'retry_count', retry_count,
        'max_retries', max_retries,
        'retry_exceeded', true
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error for debugging
        BEGIN
            PERFORM public.log_admin_action(
                'grant_access_error',
                'user_product_access',
                user_id_param::TEXT || '_' || product_id_param::TEXT,
                jsonb_build_object(
                    'severity', 'ERROR',
                    'error_type', 'database_exception',
                    'error_code', SQLSTATE,
                    'error_message', SQLERRM,
                    'user_id', user_id_param,
                    'product_id', product_id_param,
                    'retry_count', retry_count,
                    'function_name', 'grant_product_access_service_role',
                    'timestamp', extract(epoch from NOW()),
                    'context', 'optimistic_locking'
                )
            );
        EXCEPTION 
            WHEN OTHERS THEN
                -- If logging fails, continue
                NULL;
        END;
        
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Database error occurred',
            'error_code', SQLSTATE,
            'retry_count', retry_count
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

-- Grant execute permissions to the service role
GRANT EXECUTE ON FUNCTION seller_main.grant_product_access_service_role TO service_role;

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
    ) ON CONFLICT (session_id) DO NOTHING;

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
                    'customer_email_hash', encode(digest(customer_email_param, 'sha256'), 'hex'),
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

-- Grant execute permissions to the service role
GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion TO service_role;

-- Function to claim guest purchases when user logs in
-- Enhanced with rate limiting and input validation (SECURITY)
CREATE OR REPLACE FUNCTION seller_main.claim_guest_purchases_for_user(
  p_user_id UUID
) RETURNS json AS $$
DECLARE
  user_email_var TEXT;
  claimed_count INTEGER := 0;
  guest_purchase_record RECORD;
BEGIN
  -- Rate limiting: 10 calls per hour for claiming purchases (SECURITY)
  IF NOT public.check_rate_limit('claim_guest_purchases_for_user', 10, 3600) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Rate limit exceeded. Please wait before trying again.'
    );
  END IF;

  -- Input validation
  IF p_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User ID is required'
    );
  END IF;
  
  -- Get user's email using parameterized query (SECURITY)
  SELECT email INTO user_email_var 
  FROM auth.users 
  WHERE id = p_user_id;
  
  IF user_email_var IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;
  
  -- Enhanced email format validation using dedicated function
  IF NOT public.validate_email_format(user_email_var) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid email format'
    );
  END IF;
  
  -- Find and claim all unclaimed guest purchases for this email
  -- Direct query - no need for dynamic SQL (SECURITY FIX)
  FOR guest_purchase_record IN
    SELECT * FROM seller_main.guest_purchases 
    WHERE customer_email = user_email_var 
      AND claimed_by_user_id IS NULL
  LOOP
    -- Update guest purchase to mark as claimed
    UPDATE seller_main.guest_purchases
    SET claimed_by_user_id = p_user_id,
        claimed_at = NOW()
    WHERE id = guest_purchase_record.id;
    
    -- Grant access to the product using optimistic locking with error handling
    BEGIN
      DECLARE
        grant_result JSONB;
      BEGIN
        SELECT seller_main.grant_product_access_service_role(p_user_id, guest_purchase_record.product_id) INTO grant_result;
        
        IF (grant_result->>'success')::boolean = true THEN
          claimed_count := claimed_count + 1;
        ELSE
          -- Handle optimistic locking failures
          IF (grant_result->>'retry_exceeded')::boolean = true THEN
            -- High concurrency - log and continue
            PERFORM public.log_admin_action(
              'guest_claim_concurrency_failure',
              'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'WARNING',
                'error_type', 'optimistic_lock_retry_exceeded',
                'user_id', p_user_id,
                'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id,
                'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user',
                'timestamp', extract(epoch from NOW()),
                'context', 'guest_claim_processing'
              )
            );
          ELSE
            -- Other error
            PERFORM public.log_admin_action(
              'guest_claim_grant_failure',
              'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'ERROR',
                'error_type', 'access_grant_failure',
                'user_id', p_user_id,
                'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id,
                'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user',
                'timestamp', extract(epoch from NOW()),
                'context', 'guest_claim_processing'
              )
            );
          END IF;
          
          -- Roll back the claim update since access grant failed
          UPDATE seller_main.guest_purchases
          SET claimed_by_user_id = NULL,
              claimed_at = NULL
          WHERE id = guest_purchase_record.id;
        END IF;
      END;
    EXCEPTION 
      WHEN OTHERS THEN
        -- Critical error: guest purchase marked as claimed but access not granted
        PERFORM public.log_admin_action(
          'critical_guest_claim_failure',
          'guest_purchases',
          guest_purchase_record.id::TEXT,
          jsonb_build_object(
            'severity', 'CRITICAL',
            'error_type', 'guest_claim_exception',
            'error_code', SQLSTATE,
            'error_message', SQLERRM,
            'user_id', p_user_id,
            'product_id', guest_purchase_record.product_id,
            'guest_purchase_id', guest_purchase_record.id,
            'function_name', 'claim_guest_purchases_for_user',
            'timestamp', extract(epoch from NOW()),
            'context', 'guest_claim_processing'
          )
        );
        
        -- Roll back the claim update since access grant failed
        UPDATE seller_main.guest_purchases
        SET claimed_by_user_id = NULL,
            claimed_at = NULL
        WHERE id = guest_purchase_record.id;
        
        -- Continue with other purchases but log the failure
        NULL;
    END;
  END LOOP;
  
  RETURN json_build_object(
    'success', true,
    'claimed_count', claimed_count,
    'message', 'Claimed ' || claimed_count || ' guest purchases'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s';

-- Note: User registration trigger is handled in the initial schema migration
-- to avoid conflicts with the first_user_admin_trigger

-- Get user's payment history
-- Enhanced with input validation and rate limiting (SECURITY)
CREATE OR REPLACE FUNCTION seller_main.get_user_payment_history(
    user_id_param UUID
) RETURNS TABLE (
    transaction_id UUID,
    product_name TEXT,
    product_slug TEXT,
    amount NUMERIC,
    currency TEXT,
    payment_date TIMESTAMPTZ,
    status TEXT,
    refunded_amount NUMERIC
) AS $$
BEGIN
    -- Rate limiting: 30 calls per hour for payment history (SECURITY)
    IF NOT public.check_rate_limit('get_user_payment_history', 30, 3600) THEN
        RAISE EXCEPTION 'Rate limit exceeded. Please wait before requesting payment history again.';
    END IF;

    -- Input validation
    IF user_id_param IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    -- Security check: users can only view their own payment history (unless admin)
    IF user_id_param != auth.uid() THEN
        IF NOT ( select public.is_admin() ) THEN
            RAISE EXCEPTION 'Unauthorized: Can only view your own payment history';
        END IF;
    END IF;

    RETURN QUERY
    SELECT 
        pt.id,
        p.name,
        p.slug,
        pt.amount / 100.0, -- Convert cents to dollars for display
        pt.currency,
        pt.created_at,
        pt.status,
        pt.refunded_amount / 100.0 -- Convert cents to dollars for display
    FROM seller_main.payment_transactions pt
    JOIN seller_main.products p ON pt.product_id = p.id
    WHERE pt.user_id = user_id_param
    ORDER BY pt.created_at DESC
    LIMIT 100; -- Prevent excessive data retrieval
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s';

-- =============================================================================
-- TRIGGERS FOR AUTOMATION (SECURITY)
-- =============================================================================

-- Function to automatically set refunded_at when status changes to refunded
CREATE OR REPLACE FUNCTION update_refunded_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'refunded' AND OLD.status != 'refunded' THEN
        NEW.refunded_at = NOW();
        -- Note: Admin action logging is handled by the log_admin_action() trigger
        -- which runs AFTER this trigger and captures the complete state change
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- Create trigger for refunded_at automation
CREATE TRIGGER trigger_update_refunded_at
    BEFORE UPDATE ON seller_main.payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_refunded_at();

-- Function to log admin actions (direct calls with validation)
CREATE OR REPLACE FUNCTION log_admin_action(
    action_name TEXT,
    target_type TEXT,
    target_id TEXT,
    action_details JSONB DEFAULT '{}'::JSONB
) RETURNS VOID AS $$
BEGIN
    -- SECURITY: Rate limiting to prevent log spam attacks by authenticated users
    -- Admins get higher limits since they need to perform legitimate admin actions
    IF ( select public.is_admin() ) THEN
        -- Admin users: 200 log entries per hour (higher limit for legitimate admin work)
        IF NOT public.check_rate_limit('log_admin_action_admin', 200, 3600) THEN
            RAISE EXCEPTION 'Rate limit exceeded: Too many admin actions logged. Please wait before performing more actions.';
        END IF;
    ELSE
        -- Non-admin authenticated users: 20 log entries per hour (much stricter)
        IF NOT public.check_rate_limit('log_admin_action_user', 20, 3600) THEN
            RAISE EXCEPTION 'Rate limit exceeded: Too many log entries. Please wait before performing more actions.';
        END IF;
    END IF;

    -- Input validation
    IF action_name IS NULL OR length(action_name) = 0 OR length(action_name) > 100 THEN
        RAISE EXCEPTION 'Invalid action name: must be 1-100 characters';
    END IF;
    
    IF target_type IS NULL OR length(target_type) = 0 OR length(target_type) > 50 THEN
        RAISE EXCEPTION 'Invalid target type: must be 1-50 characters';
    END IF;
    
    IF target_id IS NULL OR length(target_id) = 0 OR length(target_id) > 255 THEN
        RAISE EXCEPTION 'Invalid target ID: must be 1-255 characters';
    END IF;
    
    -- Validate JSONB is not too large (prevent DoS) - reduced limit for non-admins
    IF ( select public.is_admin() ) THEN
        -- Admins can log larger details (64KB) for legitimate debugging
        IF pg_column_size(action_details) > 65536 THEN -- 64KB limit
            RAISE EXCEPTION 'Action details too large (max 64KB for admins)';
        END IF;
    ELSE
        -- Non-admin users get much smaller limit (8KB) to prevent abuse
        IF pg_column_size(action_details) > 8192 THEN -- 8KB limit
            RAISE EXCEPTION 'Action details too large (max 8KB for non-admin users)';
        END IF;
    END IF;
    
    -- Insert admin action with proper user identification
    INSERT INTO public.admin_actions (admin_id, action, target_type, target_id, details)
    VALUES (
        auth.uid(), -- NULL for system operations when no user is logged in
        action_name,
        target_type,
        target_id,
        action_details
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

-- Grant execute permissions to the service role and authenticated users
GRANT EXECUTE ON FUNCTION log_admin_action TO service_role, authenticated;

-- Trigger function to log admin actions automatically with optimized performance
CREATE OR REPLACE FUNCTION log_admin_action_trigger()
RETURNS TRIGGER AS $$
DECLARE
    action_name TEXT;
    action_details JSONB;
BEGIN
    -- Only log if the user is an admin
    IF ( select public.is_admin() ) THEN
        -- Determine specific action name based on operation and changes
        IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'payment_transactions' THEN
            IF OLD.status != NEW.status AND NEW.status = 'refunded' THEN
                action_name := 'payment_refunded';
                -- Standardized logging format
                action_details := jsonb_build_object(
                    'severity', 'INFO',
                    'action_type', 'payment_status_change',
                    'transaction_id', NEW.id,
                    'old_status', OLD.status,
                    'new_status', NEW.status,
                    'refunded_amount', NEW.refunded_amount,
                    'refund_reason', NEW.refund_reason,
                    'refunded_at', NEW.refunded_at,
                    'refunded_by', auth.uid(),
                    'customer_email_hash', encode(digest(NEW.customer_email, 'sha256'), 'hex'),
                    'function_name', 'log_admin_action_trigger',
                    'timestamp', extract(epoch from NOW()),
                    'context', 'payment_refund_processing'
                );
            ELSE
                action_name := 'payment_updated';
                -- Standardized logging format
                action_details := jsonb_build_object(
                    'severity', 'INFO',
                    'action_type', 'payment_modification',
                    'transaction_id', NEW.id,
                    'changed_fields', jsonb_build_object(
                        'status', CASE WHEN OLD.status != NEW.status THEN jsonb_build_object('old', OLD.status, 'new', NEW.status) END,
                        'refunded_amount', CASE WHEN OLD.refunded_amount != NEW.refunded_amount THEN jsonb_build_object('old', OLD.refunded_amount, 'new', NEW.refunded_amount) END,
                        'updated_at', NEW.updated_at
                    ),
                    'function_name', 'log_admin_action_trigger',
                    'timestamp', extract(epoch from NOW()),
                    'context', 'payment_update_processing'
                );
            END IF;
        ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'guest_purchases' THEN
            action_name := 'guest_purchase_claimed';
            -- Standardized logging format
            action_details := jsonb_build_object(
                'severity', 'INFO',
                'action_type', 'guest_purchase_claim',
                'purchase_id', NEW.id,
                'claimed_by', NEW.claimed_by_user_id,
                'claimed_at', NEW.claimed_at,
                'customer_email_hash', encode(digest(NEW.customer_email, 'sha256'), 'hex'),
                'product_id', NEW.product_id,
                'function_name', 'log_admin_action_trigger',
                'timestamp', extract(epoch from NOW()),
                'context', 'guest_claim_processing'
            );
        ELSE
            action_name := TG_OP::TEXT;
            -- Standardized logging format for generic operations
            action_details := CASE 
                WHEN TG_OP = 'INSERT' THEN jsonb_build_object(
                    'severity', 'INFO',
                    'action_type', 'record_creation',
                    'record_id', NEW.id,
                    'table', TG_TABLE_NAME,
                    'operation', 'INSERT',
                    'function_name', 'log_admin_action_trigger',
                    'timestamp', extract(epoch from NOW()),
                    'context', 'database_operation'
                )
                WHEN TG_OP = 'DELETE' THEN jsonb_build_object(
                    'severity', 'INFO',
                    'action_type', 'record_deletion',
                    'record_id', OLD.id,
                    'table', TG_TABLE_NAME,
                    'operation', 'DELETE',
                    'function_name', 'log_admin_action_trigger',
                    'timestamp', extract(epoch from NOW()),
                    'context', 'database_operation'
                )
                ELSE jsonb_build_object(
                    'severity', 'WARNING',
                    'action_type', 'unknown_operation',
                    'operation', 'UNKNOWN',
                    'function_name', 'log_admin_action_trigger',
                    'timestamp', extract(epoch from NOW()),
                    'context', 'database_operation'
                )
            END;
        END IF;
        
        -- Use the main log_admin_action function
        PERFORM public.log_admin_action(
            action_name,
            TG_TABLE_NAME::TEXT,
            COALESCE(NEW.id::TEXT, OLD.id::TEXT),
            action_details
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Add audit triggers for critical tables
CREATE TRIGGER audit_payment_transactions
    AFTER INSERT OR UPDATE OR DELETE ON seller_main.payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION log_admin_action_trigger();

CREATE TRIGGER audit_guest_purchases_updates
    AFTER UPDATE ON seller_main.guest_purchases
    FOR EACH ROW
    EXECUTE FUNCTION log_admin_action_trigger();

-- =============================================================================
-- SIMPLE MONITORING SYSTEM
-- =============================================================================
-- This monitoring system provides real-time alerting for critical events and
-- batch alerting for warning events via email notifications using pg_notify.
-- 
-- Key Features:
-- - Immediate email alerts for every CRITICAL severity event
-- - Batch email alerts for WARNING events when thresholds are exceeded
-- - Rate limiting to prevent email spam
-- - Extensible design for future integrations (SMTP, Slack, Discord, etc.)
-- 
-- Architecture:
-- - logs_monitoring_trigger() -> logs_monitoring_check() -> send_*_email()
-- - Single trigger function calls unified monitoring logic
-- - Easy to modify thresholds and logic without touching triggers

-- Simple email notification function (placeholder for future SMTP integration)
-- 
-- Purpose: Base email sending function using PostgreSQL's pg_notify
-- Usage: Called by other monitoring functions to send alerts
-- Integration: External service should listen to 'monitoring_alerts' channel
-- Future: Replace pg_notify with direct SMTP/API calls when needed
CREATE OR REPLACE FUNCTION send_monitoring_email(
    alert_type TEXT,
    alert_details JSONB
) RETURNS VOID AS $$
BEGIN
    -- Security check: Only allow service_role and authenticated users
    IF (select auth.role()) NOT IN ('service_role', 'authenticated') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    
    -- TODO: Integrate with email service (SMTP, SendGrid, etc.)
    -- For now, we'll use pg_notify to send to external service
    
    PERFORM pg_notify(
        'monitoring_alerts',
        jsonb_build_object(
            'alert_type', alert_type,
            'alert_details', alert_details,
            'timestamp', extract(epoch from NOW()),
            'urgent', CASE 
                WHEN alert_type = 'critical_errors' THEN true
                ELSE false
            END
        )::text
    );
    
EXCEPTION 
    WHEN OTHERS THEN
        -- If email fails, don't break anything
        NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '1s';

-- Unified monitoring function - handles both immediate CRITICAL alerts and batch WARNING alerts
-- 
-- Purpose: Central monitoring logic that handles all alert types
-- Parameters:
--   - new_action_details: JSONB details of the triggering event (from trigger)
--   - Can be called manually with NULL for periodic checks
-- 
-- Behavior:
--   - CRITICAL events: Sends immediate email (no rate limiting)
--   - WARNING events: Counts recent warnings, sends batch email if threshold exceeded
--   - Rate limiting: Prevents spam for batch alerts (15min cooldown for payment warnings)
-- 
-- Thresholds (easily configurable):
--   - Payment warnings: 5+ in 5 minutes triggers batch alert
--   - Email cooldown: 15 minutes between payment warning emails
-- 
-- Usage:
--   - Automatic: Called by logs_monitoring_trigger() for every CRITICAL/WARNING event
--   - Manual: Can be called with logs_monitoring_check(NULL) for health checks
CREATE OR REPLACE FUNCTION logs_monitoring_check(
    new_action_details JSONB DEFAULT NULL
) 
RETURNS VOID AS $$
DECLARE
    warning_count INTEGER;
    last_email_sent TIMESTAMPTZ;
BEGIN
    -- If this is a CRITICAL event passed from trigger - send immediate email!
    IF new_action_details IS NOT NULL AND (new_action_details->>'severity') = 'CRITICAL' THEN
        -- Send immediate email for every critical event
        BEGIN
            PERFORM public.send_monitoring_email(
                'critical_event_immediate',
                jsonb_build_object(
                    'severity', 'CRITICAL',
                    'event_type', 'immediate_critical_alert',
                    'action_details', new_action_details,
                    'timestamp', extract(epoch from NOW()),
                    'message', 'CRITICAL: Immediate attention required',
                    'action_required', 'Please investigate immediately',
                    'dashboard_link', '/admin/monitoring',
                    'urgent', true
                )
            );
        EXCEPTION 
            WHEN OTHERS THEN
                NULL; -- Never break the main operation
        END;
    END IF;
    
    -- For WARNING events OR regular monitoring check - handle batch warnings
    IF new_action_details IS NULL OR (new_action_details->>'severity') = 'WARNING' THEN
        -- Count warnings in last 5 minutes (for batch alerts)
        SELECT COUNT(*) INTO warning_count
        FROM public.admin_actions
        WHERE (details->>'severity') = 'WARNING'
          AND (details->>'context') LIKE '%payment%'
          AND created_at > NOW() - INTERVAL '5 minutes';
        
        -- Check when we last sent payment alert email
        SELECT MAX(created_at) INTO last_email_sent
        FROM public.admin_actions
        WHERE action = 'monitoring_email_sent'
          AND (details->>'alert_type') = 'payment_issues';
        
        -- If too many payment warnings AND we haven't sent email recently
        IF warning_count >= 5 AND 
           (last_email_sent IS NULL OR last_email_sent < NOW() - INTERVAL '15 minutes') THEN
            
            -- Send email about payment issues
            PERFORM public.send_monitoring_email(
                'payment_issues',
                jsonb_build_object(
                    'warning_count', warning_count,
                    'time_window', '5 minutes',
                    'severity', 'MEDIUM',
                    'message', 'Payment system has ' || warning_count || ' warnings in last 5 minutes',
                    'action_required', 'Please review payment processing',
                    'dashboard_link', '/admin/payments'
                )
            );
            
            -- Log that we sent email (just once)
            PERFORM public.log_admin_action(
                'monitoring_email_sent',
                'admin_actions',
                'email_notification', 
                jsonb_build_object(
                    'severity', 'INFO',
                    'alert_type', 'payment_issues',
                    'warning_count', warning_count,
                    'email_sent_at', extract(epoch from NOW()),
                    'function_name', 'logs_monitoring_check',
                    'context', 'email_notification'
                )
            );
        END IF;
    END IF;
    
EXCEPTION 
    WHEN OTHERS THEN
        -- Don't break anything if monitoring fails
        NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

-- Simple trigger - one function handles all monitoring logic
-- 
-- Purpose: Trigger function that activates monitoring for admin_actions events
-- Triggers on: INSERT operations on admin_actions table
-- Filters: Only processes CRITICAL and WARNING severity events
-- 
-- Design Philosophy:
-- - Keep trigger logic minimal - all business logic in logs_monitoring_check()
-- - Never break the main database operation (extensive error handling)
-- - Single function call makes it easy to modify monitoring behavior
-- 
-- Performance Notes:
-- - Very lightweight - just one function call with severity check
-- - Uses AFTER INSERT to avoid blocking main transaction
-- - Exception handling ensures database operations never fail due to monitoring
CREATE OR REPLACE FUNCTION logs_monitoring_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Call unified monitoring function for any CRITICAL or WARNING event
    IF TG_TABLE_NAME = 'admin_actions' AND 
       (NEW.details->>'severity') IN ('CRITICAL', 'WARNING') THEN
        
        -- Pass the event details to the monitoring function
        BEGIN
            PERFORM public.logs_monitoring_check(NEW.details);
        EXCEPTION 
            WHEN OTHERS THEN
                NULL; -- Never break the main operation
        END;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- Add monitoring trigger only to admin_actions
-- 
-- Trigger Setup: Activates monitoring system for admin_actions table
-- When: AFTER INSERT (ensures main operation completes first)
-- What: Calls logs_monitoring_trigger() for every new admin action
-- 
-- Integration Points:
-- - log_admin_action() -> INSERT into admin_actions -> logs_monitoring_trigger()
-- - All payment functions, optimistic locking, guest claims generate admin_actions
-- - Automatic monitoring without manual intervention
CREATE TRIGGER logs_monitoring_trigger
    AFTER INSERT ON admin_actions
    FOR EACH ROW
    EXECUTE FUNCTION logs_monitoring_trigger();

-- Grant permissions
-- 
-- Security: service_role needs access for automated payment processing
-- Usage: External services can call these functions via service_role
-- Manual: Admins can call logs_monitoring_check(NULL) for manual health checks
GRANT EXECUTE ON FUNCTION logs_monitoring_check TO service_role;
GRANT EXECUTE ON FUNCTION send_monitoring_email TO service_role;

-- =============================================================================
-- ADDITIONAL SECURITY FUNCTIONS
-- =============================================================================

-- Function to validate payment transaction integrity
CREATE OR REPLACE FUNCTION seller_main.validate_payment_transaction(transaction_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    transaction_record RECORD;
    current_user_id UUID;
BEGIN
    -- Enhanced UUID validation
    IF transaction_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check for null UUID or invalid patterns
    IF transaction_id = '00000000-0000-0000-0000-000000000000'::UUID THEN
        RETURN FALSE; -- Reject null UUID
    END IF;
    
    -- Additional validation: ensure UUID string format is canonical
    -- PostgreSQL automatically validates UUID format on cast, but this adds extra safety
    BEGIN
        -- This will raise an exception if transaction_id cannot be converted to text and back
        IF (transaction_id::TEXT)::UUID != transaction_id THEN
            RETURN FALSE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE; -- Invalid UUID format or conversion error
    END;
    
    -- Get current user
    current_user_id := auth.uid();
    
    -- Get transaction with access control
    SELECT * INTO transaction_record
    FROM seller_main.payment_transactions
    WHERE id = transaction_id
      AND (
        -- User can validate their own transactions
        user_id = current_user_id OR
        -- Admins can validate any transaction
        (select public.is_admin()) OR
        -- Service role can validate any transaction
        (select auth.role()) = 'service_role'
      );
    
    IF NOT FOUND THEN
        RETURN FALSE; -- Transaction not found or access denied
    END IF;
    
    -- Validate transaction integrity
    IF transaction_record.amount <= 0 THEN
        RETURN FALSE;
    END IF;
    
    IF transaction_record.refunded_amount > transaction_record.amount THEN
        RETURN FALSE;
    END IF;
    
    IF transaction_record.status = 'refunded' AND transaction_record.refunded_at IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Validate refunded_amount is non-negative
    IF transaction_record.refunded_amount < 0 THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '2s';

-- Function to get payment statistics (admin only)
CREATE OR REPLACE FUNCTION seller_main.get_payment_statistics(
    start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
    end_date TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB AS $$
DECLARE
    stats JSONB;
BEGIN
    -- Security check: only admins can access payment statistics
    IF NOT ( select public.is_admin() ) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    
    -- Enhanced input validation for dates
    IF start_date IS NULL OR end_date IS NULL THEN
        RAISE EXCEPTION 'Start date and end date are required';
    END IF;
    
    IF start_date > end_date THEN
        RAISE EXCEPTION 'Start date must be before or equal to end date';
    END IF;
    
    -- Prevent future dates (data sanity check)
    IF start_date > NOW() OR end_date > NOW() + INTERVAL '1 day' THEN
        RAISE EXCEPTION 'Dates cannot be in the future';
    END IF;
    
    -- Prevent unreasonably old dates (prevent excessive processing)
    IF start_date < NOW() - INTERVAL '10 years' THEN
        RAISE EXCEPTION 'Start date cannot be more than 10 years in the past';
    END IF;
    
    -- Limit date range to prevent excessive data processing (max 1 year)
    IF end_date - start_date > INTERVAL '1 year' THEN
        RAISE EXCEPTION 'Date range too large (maximum 1 year)';
    END IF;
    
    -- Return sanitized statistics without exposing sensitive details
    SELECT jsonb_build_object(
        'period_start', start_date,
        'period_end', end_date,
        'total_transactions', COUNT(*),
        'total_revenue_range', CASE 
            WHEN COALESCE(SUM(amount), 0) = 0 THEN 'No revenue'
            WHEN COALESCE(SUM(amount), 0) < 100000 THEN 'Under $1,000'
            WHEN COALESCE(SUM(amount), 0) < 1000000 THEN '$1,000 - $10,000'
            ELSE 'Over $10,000'
        END,
        'transaction_status', jsonb_build_object(
            'completed', COUNT(*) FILTER (WHERE status = 'completed'),
            'refunded', COUNT(*) FILTER (WHERE status = 'refunded'),
            'disputed', COUNT(*) FILTER (WHERE status = 'disputed')
        ),
        'guest_purchase_summary', jsonb_build_object(
            'total_guest_purchases', (
                SELECT COUNT(*) 
                FROM seller_main.guest_purchases 
                WHERE created_at BETWEEN start_date AND end_date
            ),
            'claimed_percentage', CASE 
                WHEN (SELECT COUNT(*) FROM seller_main.guest_purchases WHERE created_at BETWEEN start_date AND end_date) = 0 
                THEN 0
                ELSE ROUND(
                    (SELECT COUNT(*) FROM seller_main.guest_purchases WHERE claimed_at BETWEEN start_date AND end_date)::numeric * 100.0 /
                    (SELECT COUNT(*) FROM seller_main.guest_purchases WHERE created_at BETWEEN start_date AND end_date), 1
                )
            END
        ),
        'generated_at', NOW()
    ) INTO stats
    FROM seller_main.payment_transactions
    WHERE created_at BETWEEN start_date AND end_date;
    
    RETURN stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

-- Function to cleanup old admin actions for maintenance (admin only)
CREATE OR REPLACE FUNCTION cleanup_old_admin_actions(
    retention_days INTEGER DEFAULT 90
) RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Security check: only admins can cleanup audit logs
    IF NOT ( select public.is_admin() ) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    
    -- Input validation
    IF retention_days IS NULL OR retention_days < 30 THEN
        RAISE EXCEPTION 'Retention period must be at least 30 days';
    END IF;
    
    -- Delete old admin actions
    DELETE FROM public.admin_actions 
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- VACUUM workaround: Reset statistics to encourage autovacuum after bulk deletion
    -- Note: This is a safe workaround since we can't execute VACUUM directly in functions
    -- PostgreSQL autovacuum will handle actual space reclamation based on updated statistics
    IF deleted_count > 100 THEN
        -- Check dead tuple count and reset statistics if significant cleanup is needed
        IF (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'admin_actions') > 1000 THEN
            -- Reset statistics to encourage autovacuum daemon to process this table
            PERFORM pg_stat_reset_single_table_counters('admin_actions'::regclass);
        END IF;
    END IF;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

-- Function to cleanup old rate limits for maintenance (admin only)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits(
    retention_hours INTEGER DEFAULT 24
) RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Security check: only admins can cleanup rate limits
    IF NOT ( select public.is_admin() ) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    
    -- Input validation
    IF retention_hours IS NULL OR retention_hours < 1 THEN
        RAISE EXCEPTION 'Retention period must be at least 1 hour';
    END IF;
    
    -- Delete old rate limit records (leverages BRIN index for efficiency)
    DELETE FROM public.rate_limits 
    WHERE window_start < NOW() - (retention_hours || ' hours')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- VACUUM workaround: Reset statistics to encourage autovacuum after bulk deletion
    -- Note: This is a safe workaround since we can't execute VACUUM directly in functions
    -- PostgreSQL autovacuum will handle actual space reclamation based on updated statistics
    IF deleted_count > 1000 THEN
        -- Check dead tuple count and reset statistics if significant cleanup is needed
        IF (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'rate_limits') > 5000 THEN
            -- Reset statistics to encourage autovacuum daemon to process this table
            PERFORM pg_stat_reset_single_table_counters('rate_limits'::regclass);
        END IF;
    END IF;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '60s';

-- Function to cleanup old guest purchases (claimed ones older than retention period)
CREATE OR REPLACE FUNCTION seller_main.cleanup_old_guest_purchases(
    retention_days INTEGER DEFAULT 365
) RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Security check: only admins can cleanup guest purchases
    IF NOT ( select public.is_admin() ) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    
    -- Input validation
    IF retention_days IS NULL OR retention_days < 30 THEN
        RAISE EXCEPTION 'Retention period must be at least 30 days';
    END IF;
    
    -- Delete old claimed guest purchases (leverages BRIN index for efficiency)
    -- Only delete claimed purchases to preserve unclaimed ones
    DELETE FROM seller_main.guest_purchases 
    WHERE claimed_at IS NOT NULL 
      AND claimed_at < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- VACUUM workaround: Reset statistics to encourage autovacuum after bulk deletion
    -- Note: This is a safe workaround since we can't execute VACUUM directly in functions
    -- PostgreSQL autovacuum will handle actual space reclamation based on updated statistics
    IF deleted_count > 100 THEN
        -- Check dead tuple count and reset statistics if significant cleanup is needed
        IF (SELECT n_dead_tup FROM pg_stat_user_tables WHERE schemaname = 'seller_main' AND relname = 'guest_purchases') > 1000 THEN
            -- Reset statistics to encourage autovacuum daemon to process this table
            PERFORM pg_stat_reset_single_table_counters('seller_main.guest_purchases'::regclass);
        END IF;
    END IF;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

-- =============================================================================
-- MONITORING AND ANALYTICS VIEWS
-- =============================================================================

-- View for monitoring rate limit usage (admin only)
CREATE VIEW rate_limit_summary
WITH (security_invoker=on) AS
SELECT 
    function_name,
    COUNT(DISTINCT user_id) as unique_users,
    SUM(call_count) as total_calls,
    MAX(window_start) as last_activity,
    AVG(call_count) as avg_calls_per_user,
    MAX(call_count) as max_calls_per_user
FROM public.rate_limits
WHERE window_start > NOW() - INTERVAL '1 hour'
GROUP BY function_name
ORDER BY total_calls DESC;

-- View for payment system health monitoring (admin only)
CREATE VIEW payment_system_health
WITH (security_invoker=on) AS
SELECT 
    'payment_transactions' as table_name,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as records_last_24h,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_transactions,
    COUNT(*) FILTER (WHERE status = 'refunded') as refunded_transactions,
    COUNT(*) FILTER (WHERE status = 'disputed') as disputed_transactions,
    ROUND(AVG(amount) / 100.0, 2) as avg_transaction_amount,
    NOW() as snapshot_time
FROM seller_main.payment_transactions
UNION ALL
SELECT 
    'guest_purchases' as table_name,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as records_last_24h,
    COUNT(*) FILTER (WHERE claimed_by_user_id IS NOT NULL) as claimed_purchases,
    COUNT(*) FILTER (WHERE claimed_by_user_id IS NULL) as unclaimed_purchases,
    0 as disputed_transactions, -- Not applicable
    ROUND(AVG(transaction_amount) / 100.0, 2) as avg_transaction_amount,
    NOW() as snapshot_time
FROM seller_main.guest_purchases
UNION ALL
SELECT 
    'admin_actions' as table_name,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as records_last_24h,
    COUNT(*) FILTER (WHERE action = 'payment_refunded') as refund_actions,
    COUNT(*) FILTER (WHERE action = 'payment_updated') as update_actions,
    0 as disputed_transactions, -- Not applicable
    0 as avg_transaction_amount, -- Not applicable
    NOW() as snapshot_time
FROM public.admin_actions;


-- =============================================================================
-- REFUND REQUESTS SYSTEM
-- =============================================================================

-- Create refund_requests table for customer-initiated refund requests
CREATE TABLE IF NOT EXISTS seller_main.refund_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transaction_id UUID REFERENCES seller_main.payment_transactions(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for guest purchases
    customer_email TEXT NOT NULL CHECK (public.validate_email_format(customer_email)),
    product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,

    -- Request details
    reason TEXT CHECK (reason IS NULL OR length(reason) <= 2000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

    -- Request amounts
    requested_amount NUMERIC NOT NULL CHECK (requested_amount > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3),

    -- Admin response
    admin_id UUID REFERENCES auth.users(id), -- Admin who processed the request
    admin_response TEXT CHECK (admin_response IS NULL OR length(admin_response) <= 2000),
    processed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Prevent duplicate pending requests for same transaction
    CONSTRAINT unique_pending_request UNIQUE (transaction_id) DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE seller_main.refund_requests IS 'Customer-initiated refund requests that require admin approval';

-- Indexes for refund_requests
CREATE INDEX IF NOT EXISTS idx_refund_requests_user_id ON seller_main.refund_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON seller_main.refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_created_at ON seller_main.refund_requests USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_refund_requests_transaction_id ON seller_main.refund_requests(transaction_id);
CREATE INDEX IF NOT EXISTS idx_products_is_refundable ON seller_main.products(is_refundable) WHERE is_refundable = true;

-- RLS for refund_requests
ALTER TABLE seller_main.refund_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own refund requests
CREATE POLICY "Users can view own refund requests" ON seller_main.refund_requests
    FOR SELECT
    USING (
        user_id = (SELECT auth.uid()) OR
        customer_email = (SELECT email FROM auth.users WHERE id = (SELECT auth.uid())) OR
        ( select public.is_admin() ) OR
        (SELECT auth.role()) = 'service_role'
    );

-- Users can create refund requests for their own transactions
CREATE POLICY "Users can create refund requests" ON seller_main.refund_requests
    FOR INSERT
    WITH CHECK (
        (user_id = (SELECT auth.uid())) OR
        (SELECT auth.role()) = 'service_role'
    );

-- Admins can update refund requests (approve/reject)
CREATE POLICY "Admins can update refund requests" ON seller_main.refund_requests
    FOR UPDATE
    USING (
        ( select public.is_admin() ) OR
        (SELECT auth.role()) = 'service_role'
    );

-- Check if a transaction is eligible for customer-initiated refund
CREATE OR REPLACE FUNCTION seller_main.check_refund_eligibility(
    transaction_id_param UUID
) RETURNS JSONB AS $$
DECLARE
    transaction_record RECORD;
    days_since_purchase INTEGER;
    existing_request RECORD;
BEGIN
    -- Get transaction details with product info
    SELECT pt.*, p.is_refundable, p.refund_period_days, p.name as product_name
    INTO transaction_record
    FROM seller_main.payment_transactions pt
    JOIN seller_main.products p ON pt.product_id = p.id
    WHERE pt.id = transaction_id_param;

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
    FROM seller_main.refund_requests
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s';

GRANT EXECUTE ON FUNCTION seller_main.check_refund_eligibility TO authenticated, service_role;

-- Create a refund request (customer-initiated)
CREATE OR REPLACE FUNCTION seller_main.create_refund_request(
    transaction_id_param UUID,
    reason_param TEXT DEFAULT NULL
) RETURNS JSONB AS $$
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
    eligibility := seller_main.check_refund_eligibility(transaction_id_param);

    IF NOT (eligibility->>'eligible')::boolean THEN
        RETURN jsonb_build_object('success', false, 'error', eligibility->>'reason', 'details', eligibility);
    END IF;

    -- Get transaction for ownership check
    SELECT pt.*, p.name as product_name
    INTO transaction_record
    FROM seller_main.payment_transactions pt
    JOIN seller_main.products p ON pt.product_id = p.id
    WHERE pt.id = transaction_id_param;

    -- Verify ownership
    IF transaction_record.user_id != current_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You can only request refunds for your own purchases');
    END IF;

    -- Create the refund request
    INSERT INTO seller_main.refund_requests (
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

GRANT EXECUTE ON FUNCTION seller_main.create_refund_request TO authenticated;

-- Process refund request (admin only) - approve or reject
CREATE OR REPLACE FUNCTION seller_main.process_refund_request(
    request_id_param UUID,
    action_param TEXT,
    admin_response_param TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    current_admin_id UUID;
    request_record RECORD;
BEGIN
    current_admin_id := auth.uid();

    -- Check admin permission
    IF NOT (select public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Admin privileges required');
    END IF;

    IF action_param NOT IN ('approve', 'reject') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Must be "approve" or "reject"');
    END IF;

    -- Get request details
    SELECT rr.*, pt.stripe_payment_intent_id, p.name as product_name
    INTO request_record
    FROM seller_main.refund_requests rr
    JOIN seller_main.payment_transactions pt ON rr.transaction_id = pt.id
    JOIN seller_main.products p ON rr.product_id = p.id
    WHERE rr.id = request_id_param;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Refund request not found');
    END IF;

    IF request_record.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request already processed', 'current_status', request_record.status);
    END IF;

    -- Update request status
    UPDATE seller_main.refund_requests
    SET
        status = CASE WHEN action_param = 'approve' THEN 'approved' ELSE 'rejected' END,
        admin_id = current_admin_id,
        admin_response = admin_response_param,
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = request_id_param;

    IF action_param = 'approve' THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', 'approved',
            'message', 'Refund request approved. Process refund via Stripe.',
            'transaction_id', request_record.transaction_id,
            'stripe_payment_intent_id', request_record.stripe_payment_intent_id,
            'amount', request_record.requested_amount,
            'currency', request_record.currency
        );
    ELSE
        RETURN jsonb_build_object(
            'success', true,
            'status', 'rejected',
            'message', 'Refund request rejected',
            'admin_response', admin_response_param
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

GRANT EXECUTE ON FUNCTION seller_main.process_refund_request TO authenticated;

-- Get user's purchase history with refund eligibility
CREATE OR REPLACE FUNCTION seller_main.get_user_purchases_with_refund_status(
    user_id_param UUID DEFAULT NULL
) RETURNS TABLE (
    transaction_id UUID,
    product_id UUID,
    product_name TEXT,
    product_slug TEXT,
    product_icon TEXT,
    amount NUMERIC,
    currency TEXT,
    purchase_date TIMESTAMPTZ,
    status TEXT,
    refunded_amount NUMERIC,
    is_refundable BOOLEAN,
    refund_period_days INTEGER,
    days_since_purchase INTEGER,
    refund_eligible BOOLEAN,
    refund_request_status TEXT,
    refund_request_id UUID
) AS $$
DECLARE
    target_user_id UUID;
BEGIN
    target_user_id := COALESCE(user_id_param, auth.uid());

    IF target_user_id IS NULL THEN
        RETURN;
    END IF;

    -- Only allow users to view their own purchases (or admins to view any)
    IF target_user_id != auth.uid() THEN
        IF NOT ( select public.is_admin() ) THEN
            RETURN;
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        pt.id as transaction_id,
        p.id as product_id,
        p.name as product_name,
        p.slug as product_slug,
        p.icon as product_icon,
        pt.amount,
        pt.currency,
        pt.created_at as purchase_date,
        pt.status,
        pt.refunded_amount,
        p.is_refundable,
        p.refund_period_days,
        EXTRACT(DAY FROM NOW() - pt.created_at)::INTEGER as days_since_purchase,
        CASE
            WHEN pt.status = 'refunded' THEN false
            WHEN NOT p.is_refundable THEN false
            WHEN p.refund_period_days IS NOT NULL AND
                 EXTRACT(DAY FROM NOW() - pt.created_at) > p.refund_period_days THEN false
            ELSE true
        END as refund_eligible,
        rr.status as refund_request_status,
        rr.id as refund_request_id
    FROM seller_main.payment_transactions pt
    JOIN seller_main.products p ON pt.product_id = p.id
    LEFT JOIN seller_main.refund_requests rr ON pt.id = rr.transaction_id AND rr.status IN ('pending', 'approved', 'rejected')
    WHERE pt.user_id = target_user_id
    ORDER BY pt.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

GRANT EXECUTE ON FUNCTION seller_main.get_user_purchases_with_refund_status TO authenticated;

-- Admin function to get all refund requests with filtering
CREATE OR REPLACE FUNCTION seller_main.get_admin_refund_requests(
    status_filter TEXT DEFAULT NULL,
    limit_param INTEGER DEFAULT 50,
    offset_param INTEGER DEFAULT 0
) RETURNS TABLE (
    request_id UUID,
    transaction_id UUID,
    user_id UUID,
    customer_email TEXT,
    product_id UUID,
    product_name TEXT,
    reason TEXT,
    status TEXT,
    requested_amount NUMERIC,
    currency TEXT,
    admin_id UUID,
    admin_response TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    purchase_date TIMESTAMPTZ,
    stripe_payment_intent_id TEXT
) AS $$
BEGIN
    -- Check admin permission
    IF NOT ( select public.is_admin() ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        rr.id as request_id,
        rr.transaction_id,
        rr.user_id,
        rr.customer_email,
        rr.product_id,
        p.name as product_name,
        rr.reason,
        rr.status,
        rr.requested_amount,
        rr.currency,
        rr.admin_id,
        rr.admin_response,
        rr.processed_at,
        rr.created_at,
        pt.created_at as purchase_date,
        pt.stripe_payment_intent_id
    FROM seller_main.refund_requests rr
    JOIN seller_main.products p ON rr.product_id = p.id
    JOIN seller_main.payment_transactions pt ON rr.transaction_id = pt.id
    WHERE (status_filter IS NULL OR rr.status = status_filter)
    ORDER BY
        CASE WHEN rr.status = 'pending' THEN 0 ELSE 1 END,
        rr.created_at DESC
    LIMIT limit_param
    OFFSET offset_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

GRANT EXECUTE ON FUNCTION seller_main.get_admin_refund_requests TO authenticated;

-- Update updated_at on refund_requests changes
CREATE OR REPLACE FUNCTION update_refund_request_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE TRIGGER trigger_update_refund_request_timestamp
    BEFORE UPDATE ON seller_main.refund_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_refund_request_timestamp();

-- =============================================================================
-- PROXY VIEWS FOR BACKWARD COMPATIBILITY
-- =============================================================================
-- These views allow existing code referencing public.* tables to continue working
-- while the actual data lives in seller_main schema.

CREATE OR REPLACE VIEW public.payment_transactions WITH (security_invoker = on) AS SELECT * FROM seller_main.payment_transactions;
CREATE OR REPLACE VIEW public.guest_purchases WITH (security_invoker = on) AS SELECT * FROM seller_main.guest_purchases;
CREATE OR REPLACE VIEW public.refund_requests WITH (security_invoker = on) AS SELECT * FROM seller_main.refund_requests;

-- =============================================================================
-- EXPLICIT TABLE GRANTS (Security Rule #5: never rely on blanket default privileges)
-- =============================================================================
-- payment_transactions: authenticated users SELECT own + admin UPDATE for refunds (RLS enforced)
REVOKE ALL ON seller_main.payment_transactions FROM anon, authenticated;
GRANT SELECT, UPDATE ON seller_main.payment_transactions TO authenticated;
-- guest_purchases: authenticated admin can DELETE for refund revocation (RLS enforced)
REVOKE ALL ON seller_main.guest_purchases FROM anon, authenticated;
GRANT DELETE ON seller_main.guest_purchases TO authenticated;
-- refund_requests: authenticated users SELECT + INSERT own + admin UPDATE status (RLS enforced)
REVOKE ALL ON seller_main.refund_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON seller_main.refund_requests TO authenticated;

COMMIT;


