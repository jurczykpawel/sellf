-- Abandoned Cart Recovery System
-- Adds support for tracking pending and abandoned payment attempts

BEGIN;

-- 1. Add new payment statuses: 'pending' and 'abandoned'
ALTER TABLE seller_main.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_status_check;

ALTER TABLE seller_main.payment_transactions
  ADD CONSTRAINT payment_transactions_status_check
  CHECK (status IN ('pending', 'completed', 'refunded', 'disputed', 'abandoned'));

-- 2. Add abandoned_at timestamp to track when payment was abandoned
ALTER TABLE seller_main.payment_transactions
  ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ;

-- 3. Add expires_at to mark when pending payment expires (typically 24h)
ALTER TABLE seller_main.payment_transactions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Refresh proxy view to include new columns
CREATE OR REPLACE VIEW public.payment_transactions WITH (security_invoker = on) AS SELECT * FROM seller_main.payment_transactions;

-- 4. Create index for finding pending/abandoned payments efficiently
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status_created
  ON seller_main.payment_transactions(status, created_at DESC)
  WHERE status IN ('pending', 'abandoned');

-- 5. Create index for expired pending payments
CREATE INDEX IF NOT EXISTS idx_payment_transactions_expires
  ON seller_main.payment_transactions(expires_at)
  WHERE status = 'pending' AND expires_at IS NOT NULL;

-- 6. Add index for customer email to find all carts by email
CREATE INDEX IF NOT EXISTS idx_payment_transactions_customer_email_status
  ON seller_main.payment_transactions(customer_email, status, created_at DESC);

-- 7. Function to mark expired pending payments as abandoned
CREATE OR REPLACE FUNCTION seller_main.mark_expired_pending_payments()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  UPDATE seller_main.payment_transactions
  SET
    status = 'abandoned',
    abandoned_at = NOW(),
    updated_at = NOW()
  WHERE status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION seller_main.mark_expired_pending_payments() TO service_role;

-- 8. Function to get abandoned carts (admin only)
CREATE OR REPLACE FUNCTION seller_main.get_abandoned_carts(
  days_ago INTEGER DEFAULT 7,
  limit_count INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  customer_email TEXT,
  product_id UUID,
  product_name TEXT,
  amount NUMERIC,
  currency TEXT,
  created_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB
) AS $$
BEGIN
  -- Check if user is admin or service_role
  IF (SELECT auth.role()) != 'service_role' AND
     NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: Admin only';
  END IF;

  RETURN QUERY
  SELECT
    pt.id,
    pt.customer_email,
    pt.product_id,
    p.name AS product_name,
    pt.amount,
    pt.currency,
    pt.created_at,
    pt.abandoned_at,
    pt.expires_at,
    pt.metadata
  FROM seller_main.payment_transactions pt
  LEFT JOIN seller_main.products p ON pt.product_id = p.id
  WHERE pt.status IN ('pending', 'abandoned')
    AND pt.created_at > NOW() - (days_ago || ' days')::INTERVAL
  ORDER BY pt.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION seller_main.get_abandoned_carts(INTEGER, INTEGER) TO authenticated;

-- 9. Function to get abandoned cart statistics
CREATE OR REPLACE FUNCTION seller_main.get_abandoned_cart_stats(
  days_ago INTEGER DEFAULT 7
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  -- Check if user is admin or service_role
  IF (SELECT auth.role()) != 'service_role' AND
     NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: Admin only';
  END IF;

  SELECT jsonb_build_object(
    'total_abandoned', COUNT(*) FILTER (WHERE status = 'abandoned'),
    'total_pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'total_value', COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'abandoned')), 0),
    'avg_cart_value', COALESCE(AVG(amount) FILTER (WHERE status IN ('pending', 'abandoned')), 0),
    'period_days', days_ago
  ) INTO result
  FROM seller_main.payment_transactions
  WHERE status IN ('pending', 'abandoned')
    AND created_at > NOW() - (days_ago || ' days')::INTERVAL;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION seller_main.get_abandoned_cart_stats(INTEGER) TO authenticated;

-- 10. Add RLS policies for pending/abandoned transactions
-- Note: DROP IF EXISTS required before CREATE for policies (no IF NOT EXISTS support)
DROP POLICY IF EXISTS "Service role can manage all payment statuses" ON seller_main.payment_transactions;
CREATE POLICY "Service role can manage all payment statuses"
  ON seller_main.payment_transactions
  FOR ALL
  TO service_role
  USING (true);

-- Allow authenticated users to see their own pending payments
DROP POLICY IF EXISTS "Users can view their own pending payments" ON seller_main.payment_transactions;
CREATE POLICY "Users can view their own pending payments"
  ON seller_main.payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND status IN ('pending', 'completed', 'refunded')
  );

-- 11. Add comment explaining the status flow
COMMENT ON COLUMN seller_main.payment_transactions.status IS
'Payment status flow:
- pending: Payment Intent created, awaiting payment
- completed: Payment successful
- abandoned: Payment expired or user left without paying
- refunded: Payment was refunded
- disputed: Payment disputed (chargeback)';

COMMENT ON COLUMN seller_main.payment_transactions.abandoned_at IS
'Timestamp when payment was marked as abandoned (either manually or automatically after expiration)';

COMMENT ON COLUMN seller_main.payment_transactions.expires_at IS
'When this pending payment expires (typically 24 hours after creation). NULL for non-pending statuses.';

-- 12. Update pending transaction handling
-- NOTE: The modification to process_stripe_payment_completion_with_bump() has been moved
-- to the original function definition in 20250103000000_features.sql for better organization.
-- This keeps abandoned cart recovery migration focused on its domain (tracking pending/abandoned status)
-- while payment processing logic stays in the payment processing function.

COMMIT;
