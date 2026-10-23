-- Deterministic availability and event model checks; no fixture survives this file.
BEGIN;
DO $$
DECLARE
  pid uuid := gen_random_uuid(); sid uuid := gen_random_uuid();
  first_tier uuid := gen_random_uuid(); second_tier uuid := gen_random_uuid();
  at_time timestamptz := '2040-03-01T12:00:00Z'; a jsonb;
BEGIN
  INSERT INTO public.products(id,name,slug,price,currency,event_mode,allow_repeat_purchase)
    VALUES(pid,'Event SQL fixture','event-sql-'||pid,67,'PLN',true,false);
  ASSERT (SELECT allow_repeat_purchase FROM public.products WHERE id=pid);
  UPDATE public.products SET allow_repeat_purchase=false WHERE id=pid;
  ASSERT NOT (SELECT allow_repeat_purchase FROM public.products WHERE id=pid);
  BEGIN
    UPDATE public.products SET is_bundle=true WHERE id=pid;
    RAISE EXCEPTION 'Expected event bundle rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.products SET allow_custom_price=true WHERE id=pid;
    RAISE EXCEPTION 'Expected event custom price rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.products SET product_type='subscription' WHERE id=pid;
    RAISE EXCEPTION 'Expected event subscription rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.product_sessions(id,product_id,starts_at,capacity,online_url)
    VALUES(sid,pid,at_time+interval '30 days',60,'https://example.com/meeting');
  INSERT INTO public.product_price_tiers(id,session_id,price,seats,sale_ends_at,sort) VALUES
    (first_tier,sid,47,30,at_time+interval '7 days',0), (second_tier,sid,67,NULL,NULL,1);
  a := public.event_availability(pid,at_time)->0;
  ASSERT a->'current_tier'->>'id'=first_tier::text;
  ASSERT (a->>'remaining')::integer=60;
  ASSERT (a->>'current_tier_seats_left')::integer=30;
  ASSERT (a->>'next_tier_price')::numeric=67;
  ASSERT NOT (a->>'cheaper_sold_out')::boolean;
  ASSERT NOT (a->>'sold_out')::boolean;
  a := public.event_availability(pid,at_time+interval '7 days')->0;
  ASSERT a->'current_tier'->>'id'=second_tier::text;
  ASSERT (a->>'cheaper_sold_out')::boolean;
  ASSERT a->'next_tier_price'='null'::jsonb;
  UPDATE public.product_price_tiers SET sale_ends_at=at_time WHERE id=second_tier;
  a := public.event_availability(pid,at_time+interval '7 days')->0;
  ASSERT a->'current_tier'='null'::jsonb;
  ASSERT NOT (a->>'sold_out')::boolean;
  UPDATE public.product_price_tiers SET sale_ends_at=NULL WHERE id=second_tier;
  UPDATE public.product_sessions SET sales_open=false WHERE id=sid;
  ASSERT public.event_availability(pid,at_time)->0->'current_tier'='null'::jsonb;
  UPDATE public.product_sessions SET sales_open=true,capacity=NULL WHERE id=sid;
  ASSERT public.event_availability(pid,at_time)->0->'remaining'='null'::jsonb;
  ASSERT public.event_availability(pid,at_time+interval '30 days')->0->'current_tier'='null'::jsonb;
  ASSERT public.event_availability(gen_random_uuid(),at_time)='[]'::jsonb;
  ASSERT NOT has_function_privilege('anon','public.event_availability(uuid,timestamptz)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.event_hold_limits(uuid,text,text)','EXECUTE');
  ASSERT NOT has_table_privilege('anon','public.product_sessions','SELECT');
  ASSERT NOT has_table_privilege('anon','public.seat_reservations','SELECT');
  ASSERT NOT has_function_privilege('service_role','public._place_order_without_event(jsonb,jsonb)','EXECUTE');
  RAISE NOTICE 'PASS event model, availability branches and role privileges';
END $$;
ROLLBACK;
