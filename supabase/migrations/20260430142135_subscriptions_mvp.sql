-- ============================================================================
-- Subscriptions MVP
--
-- Adds Stripe subscription product type, recurring billing fields, and
-- supporting `stripe_customers` / `subscriptions` tables. Extends
-- `payment_transactions` and `user_product_access` with subscription FKs.
--
-- Single migration for the entire MVP cycle. Edited in place during this
-- feature branch (`feat/subscriptions-mvp`). Frozen on merge to main +
-- release v2026.5.0; further changes require a new migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. products: subscription fields
-- ---------------------------------------------------------------------------

ALTER TABLE seller_main.products
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'one_time'
    CHECK (product_type IN ('one_time', 'subscription')),
  ADD COLUMN billing_interval TEXT
    CHECK (billing_interval IS NULL OR billing_interval IN ('day', 'week', 'month', 'year')),
  ADD COLUMN billing_interval_count INTEGER
    CHECK (billing_interval_count IS NULL OR billing_interval_count > 0),
  ADD COLUMN recurring_price NUMERIC(10,2)
    CHECK (recurring_price IS NULL OR recurring_price >= 0),
  ADD COLUMN trial_days INTEGER
    CHECK (trial_days IS NULL OR (trial_days >= 0 AND trial_days <= 730));

-- Cross-field constraint: subscription products require full recurring config.
ALTER TABLE seller_main.products
  ADD CONSTRAINT products_subscription_complete CHECK (
    product_type = 'one_time'
    OR (
      product_type = 'subscription'
      AND billing_interval IS NOT NULL
      AND billing_interval_count IS NOT NULL
      AND recurring_price IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 2. coupons: Stripe duration semantics
-- ---------------------------------------------------------------------------

ALTER TABLE seller_main.coupons
  ADD COLUMN duration TEXT NOT NULL DEFAULT 'once'
    CHECK (duration IN ('once', 'repeating', 'forever')),
  ADD COLUMN duration_in_months INTEGER
    CHECK (duration_in_months IS NULL OR duration_in_months > 0);

ALTER TABLE seller_main.coupons
  ADD CONSTRAINT coupons_repeating_has_months CHECK (
    duration <> 'repeating' OR duration_in_months IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 3. stripe_customers: Sellf user -> Stripe Customer mapping
-- ---------------------------------------------------------------------------

CREATE TABLE seller_main.stripe_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_customers_stripe_id
  ON seller_main.stripe_customers(stripe_customer_id);

ALTER TABLE seller_main.stripe_customers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON seller_main.stripe_customers FROM anon, authenticated;
GRANT SELECT ON seller_main.stripe_customers TO authenticated;
GRANT ALL ON seller_main.stripe_customers TO service_role;

CREATE POLICY "Service role full access stripe_customers"
  ON seller_main.stripe_customers
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users read own stripe_customer mapping"
  ON seller_main.stripe_customers
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. subscriptions: Stripe Subscription mirror
-- ---------------------------------------------------------------------------

CREATE TABLE seller_main.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES seller_main.products(id) ON DELETE RESTRICT,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'canceled', 'unpaid', 'paused'
  )),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  latest_invoice_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_id
  ON seller_main.subscriptions(user_id);
CREATE INDEX idx_subscriptions_product_id
  ON seller_main.subscriptions(product_id);
CREATE INDEX idx_subscriptions_status
  ON seller_main.subscriptions(status);
CREATE INDEX idx_subscriptions_period_end_active
  ON seller_main.subscriptions(current_period_end)
  WHERE status IN ('active', 'trialing');

ALTER TABLE seller_main.subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON seller_main.subscriptions FROM anon, authenticated;
GRANT SELECT ON seller_main.subscriptions TO authenticated;
GRANT ALL ON seller_main.subscriptions TO service_role;

CREATE POLICY "Service role full access subscriptions"
  ON seller_main.subscriptions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users read own subscriptions"
  ON seller_main.subscriptions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. payment_transactions: subscription invoice fields
-- ---------------------------------------------------------------------------

ALTER TABLE seller_main.payment_transactions
  ADD COLUMN subscription_id UUID
    REFERENCES seller_main.subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN stripe_invoice_id TEXT,
  ADD COLUMN invoice_sequence_number INTEGER NOT NULL DEFAULT 0
    CHECK (invoice_sequence_number >= 0);

CREATE UNIQUE INDEX idx_payment_transactions_stripe_invoice_unique
  ON seller_main.payment_transactions(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX idx_payment_transactions_subscription_id
  ON seller_main.payment_transactions(subscription_id)
  WHERE subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. user_product_access: subscription link
-- ---------------------------------------------------------------------------

ALTER TABLE seller_main.user_product_access
  ADD COLUMN subscription_id UUID
    REFERENCES seller_main.subscriptions(id) ON DELETE SET NULL;

CREATE INDEX idx_user_product_access_subscription_id
  ON seller_main.user_product_access(subscription_id)
  WHERE subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Refresh public views to expose new columns + add views for new tables
-- ---------------------------------------------------------------------------
-- Views are bound to columns at CREATE VIEW time; ALTER TABLE on the underlying
-- relation does not refresh them. CREATE OR REPLACE re-binds with the current
-- column set. Same security_invoker pattern as existing views (see migration
-- 20250101000000_core_schema.sql:1379+).

CREATE OR REPLACE VIEW public.products
  WITH (security_invoker = on)
  AS SELECT * FROM seller_main.products;

CREATE OR REPLACE VIEW public.coupons
  WITH (security_invoker = on)
  AS SELECT * FROM seller_main.coupons;

CREATE OR REPLACE VIEW public.payment_transactions
  WITH (security_invoker = on)
  AS SELECT * FROM seller_main.payment_transactions;

CREATE OR REPLACE VIEW public.user_product_access
  WITH (security_invoker = on)
  AS SELECT * FROM seller_main.user_product_access;

CREATE OR REPLACE VIEW public.stripe_customers
  WITH (security_invoker = on)
  AS SELECT * FROM seller_main.stripe_customers;

CREATE OR REPLACE VIEW public.subscriptions
  WITH (security_invoker = on)
  AS SELECT * FROM seller_main.subscriptions;
