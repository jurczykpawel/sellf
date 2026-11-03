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
-- Reminder stages: 24 h after purchase, then 2 days before the event; never more than two; dateless products only the first.
DO $$
DECLARE p uuid; dated uuid; plain uuid; sid uuid; base timestamptz := '2030-01-01 10:00+00'; ev timestamptz := '2030-01-20 18:00+00';
  profile jsonb := '{"v":1,"modules":[{"id":"quantity","min":1,"max":5,"mode":"checkout"},{"id":"participants","required":true,"prefill_from_buyer":false,"allow_later":true}]}';
  det jsonb := '{"quantity":{"v":1,"value":2},"participants":{"v":1,"people":[]}}';
  stage integer;
BEGIN
  INSERT INTO public.products(name,slug,price,currency,checkout_profile,event_mode) VALUES ('Dated','stage-dated',100,'PLN',profile,true) RETURNING id INTO p;
  INSERT INTO public.product_sessions(product_id,starts_at,capacity) VALUES (p,ev,50) RETURNING id INTO sid;
  INSERT INTO public.products(name,slug,price,currency,checkout_profile) VALUES ('Dateless','stage-dateless',100,'PLN',profile) RETURNING id INTO plain;
  INSERT INTO public.payment_transactions(session_id,product_id,customer_email,amount,currency,status,order_details,paid_at)
    VALUES ('cs_stage_'||replace(gen_random_uuid()::text,'-',''),p,'a@example.com',100,'PLN','completed',det,base) RETURNING id INTO dated;
  INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency,session_id)
    VALUES (dated,p,'main_product',2,50,100,'PLN',sid);
  INSERT INTO public.payment_transactions(session_id,product_id,customer_email,amount,currency,status,order_details,paid_at)
    VALUES ('cs_stage2_'||replace(gen_random_uuid()::text,'-',''),plain,'b@example.com',100,'PLN','completed',det,base) RETURNING id INTO plain;

  IF EXISTS (SELECT 1 FROM public.list_participants_reminders_due(base + interval '23 hours', 500) WHERE id IN (dated, plain)) THEN RAISE EXCEPTION 'due before 24 h'; END IF;
  SELECT r.stage INTO stage FROM public.list_participants_reminders_due(base + interval '25 hours', 500) r WHERE r.id = dated;
  IF stage IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM public.list_participants_reminders_due(base + interval '25 hours', 500) r WHERE r.id = plain AND r.stage = 1) THEN
    RAISE EXCEPTION 'stage 1 missing'; END IF;
  UPDATE public.payment_transactions SET participants_mail_sent_at = base + interval '25 hours' WHERE id IN (dated, plain);
  IF EXISTS (SELECT 1 FROM public.list_participants_reminders_due(ev - interval '3 days', 500) WHERE id IN (dated, plain)) THEN RAISE EXCEPTION 'repeat of stage 1'; END IF;
  SELECT r.stage INTO stage FROM public.list_participants_reminders_due(ev - interval '47 hours', 500) r WHERE r.id = dated;
  IF stage IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'stage 2 missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.list_participants_reminders_due(ev - interval '47 hours', 500) WHERE id = plain) THEN RAISE EXCEPTION 'dateless got stage 2'; END IF;
  UPDATE public.payment_transactions SET participants_reminder2_sent_at = ev - interval '47 hours' WHERE id = dated;
  IF EXISTS (SELECT 1 FROM public.list_participants_reminders_due(ev - interval '1 hour', 500) WHERE id IN (dated, plain)) THEN RAISE EXCEPTION 'third mail'; END IF;
  IF EXISTS (SELECT 1 FROM public.list_participants_reminders_due(ev + interval '1 hour', 500) WHERE id IN (dated, plain)) THEN RAISE EXCEPTION 'mail after the event'; END IF;
  -- Bought late: stage 2 supersedes stage 1, and a saved list stops everything.
  UPDATE public.payment_transactions SET participants_mail_sent_at = NULL, participants_reminder2_sent_at = NULL, paid_at = ev - interval '10 hours' WHERE id = dated;
  SELECT r.stage INTO stage FROM public.list_participants_reminders_due(ev - interval '1 hour', 500) r WHERE r.id = dated;
  IF stage IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'late purchase not stage 2'; END IF;
  UPDATE public.payment_transactions SET order_details = '{"quantity":{"v":1,"value":2},"participants":{"v":1,"people":[{"first_name":"A","last_name":"B","email":"a@x.pl"},{"first_name":"C","last_name":"D","email":"c@x.pl"}]}}' WHERE id = dated;
  IF EXISTS (SELECT 1 FROM public.list_participants_reminders_due(ev - interval '1 hour', 500) WHERE id = dated) THEN RAISE EXCEPTION 'mail after list saved'; END IF;
END $$;
-- prepare_event_mail stays a superset of every branch: transfer notice fields, participants link and (when present) license_key.
DO $$
DECLARE def text := pg_get_functiondef('public.prepare_event_mail(text,jsonb)'::regprocedure); meta jsonb; tok text := '1893456000.' || repeat('a', 43);
BEGIN
  INSERT INTO auth.users(id,email,instance_id,aud,role) VALUES (gen_random_uuid(),'superset@example.com','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  PERFORM public.prepare_event_mail('superset@example.com', jsonb_build_object('locale','pl','mail_kind','payment_reminder','release_text','Do piatku',
    'purchase_product','Kurs','transfer_text','Dane','pay_url','https://shop.example/pl/order/10000000-0000-4000-8000-000000000001/transfer?token='||tok));
  SELECT raw_user_meta_data INTO meta FROM auth.users WHERE email='superset@example.com';
  IF meta->>'pay_url' IS NULL OR meta->>'release_text' <> 'Do piatku' OR meta->>'mail_kind' <> 'payment_reminder' THEN RAISE EXCEPTION 'transfer fields lost: %', meta; END IF;
  PERFORM public.prepare_event_mail('superset@example.com', jsonb_build_object('locale','en','mail_kind','participants_needed',
    'participants_url','https://shop.example/en/order/10000000-0000-4000-8000-000000000001/participants?token='||tok));
  SELECT raw_user_meta_data INTO meta FROM auth.users WHERE email='superset@example.com';
  IF meta->>'participants_url' IS NULL OR meta->>'mail_kind' <> 'participants_needed' OR meta ? 'pay_url' THEN RAISE EXCEPTION 'participants fields wrong: %', meta; END IF;
  IF position('license_key' IN def) > 0 THEN
    PERFORM public.prepare_event_mail('superset@example.com', '{"locale":"en","license_key":"abc.def"}');
    IF (SELECT raw_user_meta_data->>'license_key' FROM auth.users WHERE email='superset@example.com') <> 'abc.def' THEN RAISE EXCEPTION 'license_key lost'; END IF;
  END IF;
END $$;
ROLLBACK;
