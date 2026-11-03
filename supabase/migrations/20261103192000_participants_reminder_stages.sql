-- Participants reminders: first 24 h after purchase, second 2 days before the event (max two mails per order).
-- Products without an event date get only the first. Related: admin-panel/src/lib/orders/participants-service.ts
ALTER TABLE public.payment_transactions ADD COLUMN participants_reminder2_sent_at timestamptz;

CREATE FUNCTION public.list_participants_reminders_due(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, stage integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH waiting AS (
    SELECT t.id, t.participants_mail_sent_at AS first_sent, t.participants_reminder2_sent_at AS second_sent,
      coalesce(t.paid_at, t.created_at) AS bought_at,
      (SELECT min(s.starts_at) FROM public.payment_line_items l JOIN public.product_sessions s ON s.id = l.session_id
        WHERE l.transaction_id = t.id) AS event_at
    FROM public.payment_transactions t JOIN public.products p ON p.id = t.product_id
    WHERE public.order_awaits_participants(t.order_details, p.checkout_profile, t.status)
  )
  SELECT w.id, CASE
      WHEN w.event_at IS NOT NULL AND w.second_sent IS NULL AND p_now >= w.event_at - interval '2 days' AND p_now < w.event_at THEN 2
      WHEN w.first_sent IS NULL AND p_now >= w.bought_at + interval '24 hours' AND (w.event_at IS NULL OR p_now < w.event_at) THEN 1
    END
  FROM waiting w
  WHERE (w.event_at IS NOT NULL AND w.second_sent IS NULL AND p_now >= w.event_at - interval '2 days' AND p_now < w.event_at)
     OR (w.first_sent IS NULL AND p_now >= w.bought_at + interval '24 hours' AND (w.event_at IS NULL OR p_now < w.event_at))
  ORDER BY w.bought_at, w.id LIMIT greatest(1, least(p_limit, 500));
END $$;
REVOKE ALL ON FUNCTION public.list_participants_reminders_due(timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_participants_reminders_due(timestamptz,integer) TO service_role;

-- Seller panel shows the latest reminder.
CREATE OR REPLACE FUNCTION public.list_orders_missing_participants(p_unsent_only boolean DEFAULT false, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, order_number bigint, customer_email text, product_id uuid, product_name text, quantity integer,
  created_at timestamptz, mail_sent_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.order_number, t.customer_email, t.product_id, p.name,
    coalesce((t.order_details->'quantity'->>'value')::integer, 1), t.created_at,
    coalesce(t.participants_reminder2_sent_at, t.participants_mail_sent_at)
  FROM public.payment_transactions t JOIN public.products p ON p.id = t.product_id
  WHERE public.order_awaits_participants(t.order_details, p.checkout_profile, t.status)
    AND (NOT p_unsent_only OR t.participants_mail_sent_at IS NULL)
  ORDER BY t.created_at, t.id LIMIT greatest(1, least(p_limit, 500));
END $$;
