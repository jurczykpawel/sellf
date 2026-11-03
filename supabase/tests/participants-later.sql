-- Participants added after payment. Run after the release migrations; everything is rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE p uuid; plain uuid; t uuid; t2 uuid; r jsonb; n integer; ev jsonb;
  people jsonb := '[{"first_name":"Jan","last_name":"Nowak","email":"jan@example.com"},{"first_name":"Anna","last_name":"Kowalska","email":"anna@example.com"}]';
BEGIN
  IF has_function_privilege('anon','public.submit_order_participants(uuid,jsonb)','execute')
     OR has_function_privilege('authenticated','public.submit_order_participants(uuid,jsonb)','execute')
     OR has_function_privilege('authenticated','public.list_orders_missing_participants(boolean,integer)','execute') THEN
    RAISE EXCEPTION 'Unexpected grants';
  END IF;
  INSERT INTO public.products(name,slug,price,currency,checkout_profile) VALUES ('Later seats','later-sql-test',100,'PLN',
    '{"v":1,"modules":[{"id":"quantity","min":1,"max":5,"mode":"checkout"},{"id":"participants","required":true,"prefill_from_buyer":false,"allow_later":true}]}') RETURNING id INTO p;
  INSERT INTO public.products(name,slug,price,currency,checkout_profile) VALUES ('Strict seats','strict-sql-test',100,'PLN',
    '{"v":1,"modules":[{"id":"quantity","min":1,"max":5,"mode":"checkout"},{"id":"participants","required":true,"prefill_from_buyer":false}]}') RETURNING id INTO plain;
  INSERT INTO public.payment_transactions(session_id,product_id,customer_email,amount,currency,status,order_details)
    VALUES ('cs_later_'||replace(gen_random_uuid()::text,'-',''),p,'buyer@example.com',20000,'PLN','completed',
      '{"quantity":{"v":1,"value":2},"participants":{"v":1,"people":[]}}') RETURNING id INTO t;
  INSERT INTO public.payment_transactions(session_id,product_id,customer_email,amount,currency,status,order_details)
    VALUES ('cs_strict_'||replace(gen_random_uuid()::text,'-',''),plain,'buyer@example.com',20000,'PLN','completed',
      '{"quantity":{"v":1,"value":2},"participants":{"v":1,"people":[]}}') RETURNING id INTO t2;

  -- Only the allow-later product with no participants is listed.
  SELECT count(*) INTO n FROM public.list_orders_missing_participants(false,500) WHERE id IN (t,t2);
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.list_orders_missing_participants(true,500) WHERE id=t) THEN RAISE EXCEPTION 'Listing wrong: %', n; END IF;

  -- Refusals leave the order untouched and emit nothing.
  IF (public.submit_order_participants(t2,people)->>'code') <> 'not_allowed' THEN RAISE EXCEPTION 'strict product accepted'; END IF;
  IF (public.submit_order_participants(t,people->0 || '[]'::jsonb)->>'code') <> 'participant_count' THEN RAISE EXCEPTION 'count unchecked'; END IF;
  IF (public.submit_order_participants(t,'[{"first_name":"A","last_name":"B","email":"a@x.pl","extra":1},{"first_name":"A","last_name":"B","email":"b@x.pl"}]')->>'code') <> 'invalid' THEN RAISE EXCEPTION 'shape unchecked'; END IF;
  UPDATE public.payment_transactions SET status='pending' WHERE id=t;
  IF (public.submit_order_participants(t,people)->>'code') <> 'not_paid' THEN RAISE EXCEPTION 'unpaid accepted'; END IF;
  UPDATE public.payment_transactions SET status='completed' WHERE id=t;
  IF EXISTS (SELECT 1 FROM public.business_events WHERE event_type='order.participants_updated') THEN RAISE EXCEPTION 'event on refusal'; END IF;

  -- Success stores the list, stamps completion and commits exactly one event.
  r := public.submit_order_participants(t,people);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Rejected: %', r; END IF;
  IF (SELECT order_details->'participants'->'people' FROM public.payment_transactions WHERE id=t) <> people
     OR (SELECT participants_completed_at FROM public.payment_transactions WHERE id=t) IS NULL THEN RAISE EXCEPTION 'List not stored'; END IF;
  SELECT payload INTO ev FROM public.business_events WHERE event_type='order.participants_updated' AND product_id=p;
  IF ev#>>'{order,orderId}' <> t::text OR ev#>'{orderDetails,participants,people}' <> people OR ev->>'reason' <> 'participants_added_after_payment' THEN
    RAISE EXCEPTION 'Event payload wrong: %', ev;
  END IF;

  -- One-time completion; the order leaves the missing list.
  IF (public.submit_order_participants(t,people)->>'code') <> 'already_complete' THEN RAISE EXCEPTION 'overwritten'; END IF;
  IF (SELECT count(*) FROM public.business_events WHERE event_type='order.participants_updated' AND product_id=p) <> 1 THEN RAISE EXCEPTION 'duplicate event'; END IF;
  IF EXISTS (SELECT 1 FROM public.list_orders_missing_participants(false,500) WHERE id=t) THEN RAISE EXCEPTION 'still listed'; END IF;

  -- Buyer mail data accepts the participants kind and link only in their exact shape.
  PERFORM public.prepare_event_mail('nobody@example.com','{"locale":"pl","mail_kind":"participants_needed","participants_url":"https://shop.example/pl/order/10000000-0000-4000-8000-000000000001/participants?token=1893456000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
  BEGIN
    PERFORM public.prepare_event_mail('nobody@example.com','{"locale":"pl","mail_kind":"participants_needed","participants_url":"https://evil.example/anything"}');
    RAISE EXCEPTION 'Bad link accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
ROLLBACK;
