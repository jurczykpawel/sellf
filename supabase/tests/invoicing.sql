-- Transactional invoice access and uniqueness acceptance. @see ../migrations/20261110235904_release_2026_11_0_events_transfers.sql
BEGIN;
DO $$
DECLARE admin_id uuid; invoice_count integer; first_auto timestamptz;
BEGIN
 SELECT user_id INTO STRICT admin_id FROM public.admin_users LIMIT 1;
 SELECT count(*) INTO invoice_count FROM public.invoices;
 ASSERT invoice_count > 0;
 PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',admin_id)::text, true);
 SET LOCAL ROLE authenticated;
 ASSERT (SELECT count(*) FROM public.invoices) = invoice_count;
 BEGIN
   UPDATE public.invoices SET number='not allowed';
   RAISE EXCEPTION 'authenticated write was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM * FROM public.invoicing_config;
   RAISE EXCEPTION 'authenticated settings read was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
 SET LOCAL ROLE authenticated;
 ASSERT (SELECT count(*) FROM public.invoices) = 0;
 RESET ROLE;
 SET LOCAL ROLE anon;
 BEGIN
   PERFORM * FROM public.invoices;
   RAISE EXCEPTION 'anonymous read was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 ASSERT (SELECT count(*) FROM public.invoices) = invoice_count;
 ASSERT (SELECT auto_since IS NULL FROM public.invoicing_config);
 UPDATE public.invoicing_config SET mode='auto' WHERE id;
 SELECT auto_since INTO first_auto FROM public.invoicing_config;
 ASSERT first_auto = now();
 UPDATE public.invoicing_config SET exemption='Sample exemption', auto_since='2000-01-01' WHERE id;
 ASSERT (SELECT auto_since = first_auto FROM public.invoicing_config);
 UPDATE public.invoicing_config SET domain='other.fakturownia.pl' WHERE id;
 ASSERT (SELECT auto_since = now() FROM public.invoicing_config);
 UPDATE public.invoicing_config SET provider='fakturownia' WHERE id;
 ASSERT (SELECT auto_since = now() FROM public.invoicing_config);
 UPDATE public.invoicing_config SET mode='manual' WHERE id;
 ASSERT (SELECT auto_since IS NULL FROM public.invoicing_config);
 UPDATE public.invoicing_config SET mode='auto' WHERE id;
 ASSERT (SELECT auto_since = now() FROM public.invoicing_config);
 ASSERT NOT has_function_privilege('anon', 'public.set_invoicing_auto_since()', 'EXECUTE');
 ASSERT NOT has_function_privilege('authenticated', 'public.set_invoicing_auto_since()', 'EXECUTE');
 BEGIN
   INSERT INTO public.invoices(transaction_id,provider,external_key,provider_domain)
   SELECT transaction_id,provider,'duplicate-test',provider_domain FROM public.invoices LIMIT 1;
   RAISE EXCEPTION 'duplicate transaction was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
   UPDATE public.invoices SET attempts=6;
   RAISE EXCEPTION 'sixth attempt was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 RESET ROLE;
END $$;
ROLLBACK;
