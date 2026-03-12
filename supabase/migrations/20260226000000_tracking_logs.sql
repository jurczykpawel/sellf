-- Tracking Logs: persistent logging for server-side conversion events
-- Supports two destinations: GTM Server-Side container + Facebook CAPI
--
-- Two sources:
--   'server'       — trackServerSideConversion() from Stripe webhook / grant-access
--   'client_proxy'  — /api/tracking/fb-capi route (browser → server → destinations)

CREATE TABLE IF NOT EXISTS public.tracking_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('server', 'client_proxy')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  destination TEXT,
  -- Request context
  order_id TEXT,
  product_id UUID,
  customer_email TEXT,
  value NUMERIC,
  currency TEXT,
  event_source_url TEXT,
  -- Response from destination
  http_status INT,
  events_received INT,
  error_message TEXT,
  -- Metadata
  skip_reason TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON COLUMN public.tracking_logs.destination
  IS 'Where the event was sent: gtm_ss, fb_capi, or both';

CREATE INDEX idx_tracking_logs_created_at ON public.tracking_logs(created_at DESC);
CREATE INDEX idx_tracking_logs_event_name ON public.tracking_logs(event_name);
CREATE INDEX idx_tracking_logs_status ON public.tracking_logs(status);
CREATE INDEX idx_tracking_logs_order_id ON public.tracking_logs(order_id);

-- RLS: service_role only (admin data, no public access)
ALTER TABLE public.tracking_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tracking_logs FROM anon, authenticated;
GRANT ALL ON public.tracking_logs TO service_role;

-- GTM Server-Side tracking: toggle for server-to-server event sending
-- (gtm_server_container_url already exists for client-side GTM script URL)
ALTER TABLE seller_main.integrations_config
  ADD COLUMN IF NOT EXISTS gtm_ss_enabled BOOLEAN DEFAULT FALSE;

-- Refresh proxy view to include new column
CREATE OR REPLACE VIEW public.integrations_config WITH (security_invoker = on) AS SELECT * FROM seller_main.integrations_config;

COMMENT ON COLUMN seller_main.integrations_config.gtm_ss_enabled
  IS 'Enable sending server-side conversion events to GTM SS container';

-- ============================================================================
-- Security hardening (audit findings)
-- ============================================================================

-- Add 'partially_refunded' to payment_transactions CHECK constraint.
-- Without this, partial refunds via API v1 fail at DB level while Stripe
-- has already processed the refund — causing data inconsistency.
ALTER TABLE seller_main.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_status_check;

ALTER TABLE seller_main.payment_transactions
  ADD CONSTRAINT payment_transactions_status_check
  CHECK (status IN ('pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned'));

-- Restrict process_stripe_payment_completion_with_bump to service_role only.
-- Previously callable by any authenticated user, which allows bypassing
-- Stripe payment verification for PWYW products with price=NULL.
REVOKE EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion_with_bump FROM authenticated;

-- Restrict verify_api_key to service_role only.
-- Prevents anon/authenticated users from probing API key hashes via RPC.
REVOKE EXECUTE ON FUNCTION public.verify_api_key FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.verify_api_key TO service_role;

-- Restrict check_application_rate_limit to service_role only.
-- Prevents direct RPC calls that could pollute rate limit state.
REVOKE EXECUTE ON FUNCTION public.check_application_rate_limit FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.check_application_rate_limit TO service_role;

-- Fix product_price_history INSERT policy.
-- Old policy allowed auth.uid() IS NULL which means anon callers could
-- insert arbitrary price history records.
DROP POLICY IF EXISTS "Only system or admins can insert price history" ON seller_main.product_price_history;

CREATE POLICY "Only system or admins can insert price history"
  ON seller_main.product_price_history FOR INSERT
  WITH CHECK (
    current_setting('role', true) = 'service_role'
    OR EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  );

-- Fix SECURITY DEFINER functions missing SET search_path.
ALTER FUNCTION public.handle_new_user_registration() SET search_path = '';
ALTER FUNCTION seller_main.migrate_guest_payment_data_to_profile(UUID) SET search_path = '';
