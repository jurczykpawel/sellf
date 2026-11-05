ALTER TABLE public.shop_config ADD COLUMN supabase_buyer_emails boolean NOT NULL DEFAULT false;
-- Existing shops keep their mail channel during upgrade. Fresh installations have no shop row yet.
UPDATE public.shop_config SET supabase_buyer_emails = true;
-- An existing installation may have sold products before saving shop settings.
INSERT INTO public.shop_config(supabase_buyer_emails)
  SELECT true WHERE NOT EXISTS (SELECT 1 FROM public.shop_config)
    AND (EXISTS (SELECT 1 FROM public.products) OR EXISTS (SELECT 1 FROM auth.users));

CREATE OR REPLACE FUNCTION public.enqueue_webhook_delivery(
  p_id uuid, p_endpoint_id uuid, p_event_type text, p_payload jsonb,
  p_delivery_key text, p_max_attempts integer DEFAULT 5
) RETURNS SETOF public.webhook_logs
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.webhook_logs(
    id, endpoint_id, event_type, payload, delivery_key, status,
    attempt_count, max_attempts, next_retry_at
  ) VALUES (
    p_id, p_endpoint_id, p_event_type, CASE WHEN jsonb_typeof(p_payload) = 'array' THEN p_payload
      ELSE p_payload || jsonb_build_object('id', p_id) END,
    p_delivery_key, 'pending_retry', 0, p_max_attempts, now() + interval '60 seconds'
  ) ON CONFLICT DO NOTHING
  RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) TO service_role;
