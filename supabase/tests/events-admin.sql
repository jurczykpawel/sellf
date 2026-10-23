\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  ASSERT NOT has_function_privilege('authenticated','public.prepare_event_mail(text,jsonb)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.prepare_event_mail(text,jsonb)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.prepare_event_mail(text,jsonb)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.event_session_admin(uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.event_session_admin(uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.my_event_sessions(uuid)','EXECUTE');
  ASSERT has_function_privilege('authenticated','public.my_event_sessions(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.event_mail_access(text,uuid,uuid)','EXECUTE');
  ASSERT (SELECT tier_label='Promocja' FROM public.payment_line_items WHERE transaction_id='e3000000-0000-4000-a000-000000000010');
END $$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE p uuid := 'e3000000-0000-4000-a000-000000000001'; s uuid := 'e3000000-0000-4000-a000-000000000002';
  actor uuid := 'dddddddd-0000-4000-a000-000000000000'; info jsonb;
BEGIN
  info := public.event_session_admin(s);
  ASSERT info->>'sold'='2' AND info->>'held'='0' AND info->'availability'->>'remaining'='58';
  ASSERT jsonb_array_length(info->'orders')=1;
  ASSERT info->'orders'->0->'order_details'->'participants'->'people'->0->>'email'='anna.events@example.com';
  BEGIN
    PERFORM public.mutate_product_with_audit('UPDATE','{"name":"Changed","sessions":[]}',p,actor);
    RAISE EXCEPTION 'expected reserved session rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  ASSERT (SELECT name='Warsztat automatyzacji' FROM public.products WHERE id=p);
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bbbbbbbb-0000-4000-a000-000000000000"}',true);
DO $$ BEGIN ASSERT public.my_event_sessions('e3000000-0000-4000-a000-000000000001')='[]'::jsonb; END $$;
ROLLBACK;
