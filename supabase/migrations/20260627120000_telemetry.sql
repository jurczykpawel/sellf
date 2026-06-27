-- Telemetry: singleton state (random instance id + claim-then-confirm debounce)
-- and a single hardened collection RPC. Anonymous by design — no domain/license
-- hash, no PII. See docs/superpowers/specs/2026-06-27-telemetry-and-generic-receiver-design.md

CREATE TABLE public.telemetry_state (
  id              text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  instance_id     uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id       uuid,
  last_attempt_at timestamptz,
  last_sent_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telemetry_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "telemetry_state service role only" ON public.telemetry_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.telemetry_state FROM anon, authenticated;
GRANT ALL ON public.telemetry_state TO service_role;
INSERT INTO public.telemetry_state (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

-- One round-trip, all counts. Exact (capped at the receiver). plpgsql counts only —
-- never sums amounts, never selects emails/customer rows.
CREATE OR REPLACE FUNCTION public.get_telemetry_metrics()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'products_total',          (SELECT count(*) FROM public.products),
    'products_active',         (SELECT count(*) FROM public.products WHERE is_active),
    'products_subscription',   (SELECT count(*) FROM public.products WHERE product_type = 'subscription'),
    'products_bundle',         (SELECT count(*) FROM public.products WHERE is_bundle),
    'products_pwyw',           (SELECT count(*) FROM public.products WHERE allow_custom_price),
    'products_free',           (SELECT count(*) FROM public.products WHERE price = 0),
    'users_with_access',       (SELECT count(DISTINCT user_id) FROM public.user_product_access),
    'admin_users',             (SELECT count(*) FROM public.admin_users),
    'transactions_completed',  (SELECT count(*) FROM public.payment_transactions WHERE status = 'completed'),
    'transactions_last_30d',   (SELECT count(*) FROM public.payment_transactions WHERE created_at >= now() - interval '30 days'),
    'guest_purchases',         (SELECT count(*) FROM public.guest_purchases),
    'subscriptions_active',    (SELECT count(*) FROM public.subscriptions WHERE status IN ('active','trialing','past_due')),
    'oto_offers',              (SELECT count(*) FROM public.oto_offers WHERE is_active),
    'order_bumps',             (SELECT count(*) FROM public.order_bumps WHERE is_active),
    'license_keys_issued',     (SELECT count(*) FROM public.issued_licenses WHERE revoked_at IS NULL),
    'coupons',                 (SELECT count(*) FROM public.coupons WHERE is_active),
    'webhooks_configured',     (SELECT count(*) FROM public.webhook_endpoints WHERE is_active),
    'api_keys',                (SELECT count(*) FROM public.api_keys WHERE is_active AND revoked_at IS NULL),
    'distinct_currencies',     (SELECT count(DISTINCT currency) FROM public.products)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_telemetry_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_telemetry_metrics() TO service_role;

-- Atomic claim-then-confirm send gate. The single UPDATE ... RETURNING is the sole
-- gate: a row comes back only when the window has elapsed AND the retry lease is free,
-- so concurrent callers can never both win. report_id is minted once and reused across
-- retry attempts until a confirm clears it.
CREATE OR REPLACE FUNCTION public.telemetry_claim_send(p_window_ms bigint, p_lease_ms bigint)
RETURNS TABLE(instance_id uuid, report_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.telemetry_state
     SET last_attempt_at = now(),
         report_id = COALESCE(report_id, gen_random_uuid())
   WHERE id = 'singleton'
     AND (last_sent_at IS NULL OR last_sent_at < now() - make_interval(secs => p_window_ms / 1000.0))
     AND (last_attempt_at IS NULL OR last_attempt_at < now() - make_interval(secs => p_lease_ms / 1000.0))
   RETURNING instance_id, report_id;
$$;
REVOKE EXECUTE ON FUNCTION public.telemetry_claim_send(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telemetry_claim_send(bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.telemetry_confirm_send()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.telemetry_state SET last_sent_at = now(), report_id = NULL WHERE id = 'singleton';
$$;
REVOKE EXECUTE ON FUNCTION public.telemetry_confirm_send() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telemetry_confirm_send() TO service_role;
