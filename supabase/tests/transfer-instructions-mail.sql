-- Auth mail metadata is maintained only by the server role.
BEGIN;
DO $$
DECLARE mail text; uid uuid;
BEGIN
 SELECT id,email INTO STRICT uid,mail FROM auth.users WHERE email='demo@sellf.app';
 SET LOCAL ROLE anon;
 BEGIN
   PERFORM public.prepare_event_mail(mail,'{"transfer_text":"not allowed"}');
   RAISE EXCEPTION 'anonymous mail preparation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',uid)::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN
   PERFORM public.prepare_event_mail(mail,'{}');
   RAISE EXCEPTION 'authenticated mail preparation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 PERFORM public.prepare_event_mail(mail,'{"transfer_text":"Test bank\nPL61109010140000071219812874\n100 PLN"}');
 RESET ROLE;
 ASSERT (SELECT raw_user_meta_data->>'transfer_text' FROM auth.users WHERE id=uid) LIKE 'Test bank%';
 SET LOCAL ROLE service_role;
 PERFORM public.prepare_event_mail(mail,'{"event_date":"2099-06-01"}');
 BEGIN
   PERFORM public.prepare_event_mail(mail,jsonb_build_object('transfer_text',repeat('x',2001)));
   RAISE EXCEPTION 'oversize instructions accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 RESET ROLE;
 ASSERT NOT (SELECT raw_user_meta_data ? 'transfer_text' FROM auth.users WHERE id=uid);
 ASSERT (SELECT raw_user_meta_data->>'event_date' FROM auth.users WHERE id=uid)='2099-06-01';
 ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_transactions' AND column_name='transfer_mail_sent_at');
END $$;
ROLLBACK;
