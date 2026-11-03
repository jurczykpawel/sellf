-- Participants added after payment ("add later"): storage, outbox event, reminder queue, buyer mail data.
-- Related: admin-panel/src/lib/orders/participants-service.ts, supabase/tests/participants-later.sql
ALTER TABLE public.payment_transactions
  ADD COLUMN participants_mail_sent_at timestamptz,
  ADD COLUMN participants_completed_at timestamptz;

-- Extend the allowed event types in place, so event types added by other migrations stay valid.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname = 'business_events_event_type_check' AND conrelid = 'public.business_events'::regclass;
  IF def IS NULL OR def NOT LIKE '%])))' THEN RAISE EXCEPTION 'Unexpected business_events constraint: %', def; END IF;
  ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
  EXECUTE 'ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check '
    || left(def, length(def) - 4) || ', ''order.participants_updated''::text])))';
END $$;

-- A paid order whose product lets the buyer add participants later and which has none yet.
CREATE FUNCTION public.order_awaits_participants(p_order_details jsonb, p_profile jsonb, p_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_status = 'completed'
    AND jsonb_typeof(p_profile->'modules') = 'array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_profile->'modules') m
      WHERE m->>'id' = 'participants' AND m->'required' = 'true'::jsonb AND m->'allow_later' = 'true'::jsonb)
    AND coalesce(jsonb_array_length(p_order_details->'participants'->'people'), 0) = 0
    AND coalesce((p_order_details->'quantity'->>'value')::integer, 1) >= 1;
$$;
REVOKE ALL ON FUNCTION public.order_awaits_participants(jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_awaits_participants(jsonb,jsonb,text) TO service_role;

CREATE FUNCTION public.list_orders_missing_participants(p_unsent_only boolean DEFAULT false, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, order_number bigint, customer_email text, product_id uuid, product_name text, quantity integer,
  created_at timestamptz, mail_sent_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.order_number, t.customer_email, t.product_id, p.name,
    coalesce((t.order_details->'quantity'->>'value')::integer, 1), t.created_at, t.participants_mail_sent_at
  FROM public.payment_transactions t JOIN public.products p ON p.id = t.product_id
  WHERE public.order_awaits_participants(t.order_details, p.checkout_profile, t.status)
    AND (NOT p_unsent_only OR t.participants_mail_sent_at IS NULL)
  ORDER BY t.created_at, t.id LIMIT greatest(1, least(p_limit, 500));
END $$;
REVOKE ALL ON FUNCTION public.list_orders_missing_participants(boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_orders_missing_participants(boolean,integer) TO service_role;

-- One atomic completion: stores the list and commits the webhook event with it.
CREATE FUNCTION public.submit_order_participants(p_order_id uuid, p_people jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; prod public.products; qty integer; person jsonb;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  SELECT * INTO prod FROM public.products WHERE id = tx.product_id;
  IF tx.status <> 'completed' THEN RETURN jsonb_build_object('ok', false, 'code', 'not_paid'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(prod.checkout_profile->'modules', '[]')) m
      WHERE m->>'id' = 'participants' AND m->'allow_later' = 'true'::jsonb) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_allowed');
  END IF;
  IF coalesce(jsonb_array_length(tx.order_details->'participants'->'people'), 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_complete');
  END IF;
  qty := coalesce((tx.order_details->'quantity'->>'value')::integer, 1);
  IF p_people IS NULL OR jsonb_typeof(p_people) <> 'array' OR jsonb_array_length(p_people) <> qty THEN
    RETURN jsonb_build_object('ok', false, 'code', 'participant_count');
  END IF;
  FOR person IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    IF jsonb_typeof(person) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(person)) <> 3
       OR jsonb_typeof(person->'first_name') <> 'string' OR jsonb_typeof(person->'last_name') <> 'string'
       OR jsonb_typeof(person->'email') <> 'string' OR length(person->>'email') > 254 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid');
    END IF;
  END LOOP;
  UPDATE public.payment_transactions SET
    order_details = coalesce(order_details, '{}'::jsonb) || jsonb_build_object('participants', jsonb_build_object('v', 1, 'people', p_people)),
    participants_completed_at = now(), updated_at = now()
  WHERE id = tx.id;
  INSERT INTO public.business_events(event_type, product_id, payload, deduplication_key)
  VALUES ('order.participants_updated', tx.product_id, jsonb_build_object(
    'customer', jsonb_build_object('userId', tx.user_id, 'email', tx.customer_email),
    'order', jsonb_build_object('orderId', tx.id, 'orderNumber', tx.order_number, 'status', tx.status),
    'product', jsonb_build_object('id', prod.id, 'name', prod.name, 'slug', prod.slug),
    'orderDetails', jsonb_build_object('quantity', tx.order_details->'quantity', 'participants', jsonb_build_object('v', 1, 'people', p_people)),
    'reason', 'participants_added_after_payment',
    'actor', jsonb_build_object('type', 'customer', 'id', NULL),
    'occurredAt', clock_timestamp()), 'order.participants_updated:' || tx.id)
  ON CONFLICT (deduplication_key) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.submit_order_participants(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_participants(uuid,jsonb) TO service_role;

-- Buyer mail data: new notice kind and its signed participants link. The current definition is patched in
-- place (not replaced), so fields added by other migrations (mail_kind/pay_url/release_text, license_key, ...) survive.
DO $$
DECLARE def text := pg_get_functiondef('public.prepare_event_mail(text,jsonb)'::regprocedure); patched text := def;
BEGIN
  patched := replace(patched, $a$'order_cancelled'$a$, $b$'order_cancelled','participants_needed'$b$);
  patched := replace(patched, $a$    OR length(p_data->>'release_text')>500$a$,
    $b$    OR length(p_data->>'participants_url')>2048
    OR (p_data->>'participants_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/participants\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'release_text')>500$b$);
  patched := replace(patched, $a$-'release_text'$a$, $b$-'release_text'-'participants_url'$b$);
  patched := replace(patched, $a$'release_text',p_data->>'release_text',$a$, $b$'release_text',p_data->>'release_text','participants_url',p_data->>'participants_url',$b$);
  IF patched NOT LIKE '%''participants_needed''%' OR patched NOT LIKE '%OR length(p_data->>''participants_url'')>2048%'
     OR patched NOT LIKE '%-''participants_url''%' OR patched NOT LIKE '%''participants_url'',p_data->>''participants_url''%' THEN
    RAISE EXCEPTION 'prepare_event_mail has an unexpected shape';
  END IF;
  EXECUTE patched;
END $$;
