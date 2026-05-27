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

ALTER TABLE public.products
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'one_time'
    CHECK (product_type IN ('one_time', 'subscription')),
  ADD COLUMN billing_interval TEXT
    CHECK (billing_interval IS NULL OR billing_interval IN ('day', 'week', 'month', 'year')),
  ADD COLUMN billing_interval_count INTEGER
    CHECK (billing_interval_count IS NULL OR billing_interval_count > 0),
  ADD COLUMN recurring_price NUMERIC(10,2)
    CHECK (recurring_price IS NULL OR recurring_price >= 0),
  ADD COLUMN trial_days INTEGER
    CHECK (trial_days IS NULL OR (trial_days >= 0 AND trial_days <= 730)),
  -- durable Stripe Price binding. Created lazily on first checkout
  -- by getOrCreateStripePriceForProduct, then reused. Webhook handlers verify
  -- sub.items.data[0].price.id against this column to prove product identity
  -- before granting access — defends against mutable subscription metadata.
  ADD COLUMN stripe_price_id TEXT;

CREATE UNIQUE INDEX idx_products_stripe_price_id_unique
  ON public.products(stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;

-- Cross-field constraint: subscription products require full recurring config.
ALTER TABLE public.products
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

ALTER TABLE public.coupons
  ADD COLUMN duration TEXT NOT NULL DEFAULT 'once'
    CHECK (duration IN ('once', 'repeating', 'forever')),
  ADD COLUMN duration_in_months INTEGER
    CHECK (duration_in_months IS NULL OR duration_in_months > 0);

ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_repeating_has_months CHECK (
    duration <> 'repeating' OR duration_in_months IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 3. stripe_customers: Sellf user -> Stripe Customer mapping
-- ---------------------------------------------------------------------------

CREATE TABLE public.stripe_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_customers_stripe_id
  ON public.stripe_customers(stripe_customer_id);

ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stripe_customers FROM anon, authenticated;
GRANT SELECT ON public.stripe_customers TO authenticated;
GRANT ALL ON public.stripe_customers TO service_role;

CREATE POLICY "Service role full access stripe_customers"
  ON public.stripe_customers
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users read own stripe_customer mapping"
  ON public.stripe_customers
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. subscriptions: Stripe Subscription mirror
-- ---------------------------------------------------------------------------

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  -- per-subscription Stripe Price id (immutable, set at first webhook).
  -- The webhook handler validates incoming sub.items.data[0].price.id against this
  -- column rather than the mutable products.stripe_price_id, so admin price drift
  -- never blocks revocation of an existing subscription.
  stripe_price_id TEXT,
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
  ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_product_id
  ON public.subscriptions(product_id);
CREATE INDEX idx_subscriptions_status
  ON public.subscriptions(status);
CREATE INDEX idx_subscriptions_period_end_active
  ON public.subscriptions(current_period_end)
  WHERE status IN ('active', 'trialing');
CREATE INDEX idx_subscriptions_stripe_price_id
  ON public.subscriptions(stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

CREATE POLICY "Service role full access subscriptions"
  ON public.subscriptions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users read own subscriptions"
  ON public.subscriptions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. payment_transactions: subscription invoice fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_transactions
  ADD COLUMN subscription_id UUID
    REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN stripe_invoice_id TEXT;

CREATE UNIQUE INDEX idx_payment_transactions_stripe_invoice_unique
  ON public.payment_transactions(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX idx_payment_transactions_subscription_id
  ON public.payment_transactions(subscription_id)
  WHERE subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. user_product_access: subscription link
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_product_access
  ADD COLUMN subscription_id UUID
    REFERENCES public.subscriptions(id) ON DELETE SET NULL;

CREATE INDEX idx_user_product_access_subscription_id
  ON public.user_product_access(subscription_id)
  WHERE subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Refresh public views to expose new columns + add views for new tables
-- ---------------------------------------------------------------------------
-- Views are bound to columns at CREATE VIEW time; ALTER TABLE on the underlying
-- relation does not refresh them. CREATE OR REPLACE re-binds with the current
-- column set. Same security_invoker pattern as existing views (see migration
-- 20250101000000_core_schema.sql:1379+).













-- ---------------------------------------------------------------------------
-- 8. Helper: find_user_id_by_email
-- ---------------------------------------------------------------------------
-- Used by the subscription webhook handlers (invoice.paid) to map a Stripe
-- customer email to an existing auth.users row when a passwordless create
-- attempt collides with an existing account. Service-role only.

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.find_user_id_by_email(TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. payment_transactions.session_id: allow Stripe invoice IDs
-- ---------------------------------------------------------------------------
-- Subscription renewal invoices don't have a Stripe Checkout Session — we
-- store the invoice id (in_*) directly. Extend the existing prefix whitelist
-- so 'in_' is valid alongside 'cs_' and 'pi_'.

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_session_id_check;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_session_id_check
  CHECK (
    length(session_id) >= 1
    AND length(session_id) <= 255
    AND session_id ~* '^(cs_|pi_|in_)[a-zA-Z0-9_]+$'
  );

-- ---------------------------------------------------------------------------
-- 10. product_type immutability after first sale
-- ---------------------------------------------------------------------------
-- DB-level invariant: product_type cannot change once the product has any
-- payment_transactions / user_product_access / subscriptions row.
-- Application-level enforcement lives in
-- admin-panel/src/lib/validations/product-type-guard.ts; this trigger holds
-- the invariant for every writer — direct DB access, future API routes, and
-- any path that bypasses the application guard.

CREATE OR REPLACE FUNCTION public.enforce_product_type_immutable_after_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- No-op when product_type is unchanged. Cheap path for the common case
  -- (price/name/description edits).
  IF OLD.product_type IS NOT DISTINCT FROM NEW.product_type THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_transactions WHERE product_id = NEW.id LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM public.user_product_access WHERE product_id = NEW.id LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM public.subscriptions WHERE product_id = NEW.id LIMIT 1
  ) THEN
    RAISE EXCEPTION 'product_type cannot be changed after the product has any payment, access, or subscription record'
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_product_type_immutable_after_sale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_product_type_immutable_after_sale() TO service_role;

DROP TRIGGER IF EXISTS enforce_product_type_immutable_after_sale ON public.products;
CREATE TRIGGER enforce_product_type_immutable_after_sale
  BEFORE UPDATE OF product_type ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_type_immutable_after_sale();

COMMENT ON FUNCTION public.enforce_product_type_immutable_after_sale() IS
  'BEFORE UPDATE trigger on public.products: rejects product_type changes once any payment_transactions / user_product_access / subscriptions row references the product.';
