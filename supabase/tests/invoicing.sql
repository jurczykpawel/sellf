-- Transactional invoice access and uniqueness acceptance. @see ../migrations/20261023100000_invoicing_provider.sql
BEGIN;
DO $$
DECLARE admin_id uuid; invoice_count integer;
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
