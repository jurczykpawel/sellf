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
ALTER TABLE public.integrations_config
  ADD COLUMN IF NOT EXISTS gtm_ss_enabled BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.integrations_config.gtm_ss_enabled
  IS 'Enable sending server-side conversion events to GTM SS container';
