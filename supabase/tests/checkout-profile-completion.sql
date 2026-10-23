\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.mark_checkout_details_missing()', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.mark_checkout_details_missing()', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.mark_checkout_details_missing()', 'EXECUTE');
  ASSERT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.mark_checkout_details_missing()'::regprocedure);
END $$;
INSERT INTO public.products(id,name,slug,price,currency,checkout_profile) VALUES
  ('e1999999-1111-4111-8111-111111111111','Completion example','profile-completion-sql',100,'PLN',
   '{"v":1,"modules":[{"id":"buyer","types":["person"],"gus":false},{"id":"phone","required":true},{"id":"quantity","min":1,"max":5,"mode":"checkout"},{"id":"participants","required":true,"prefill_from_buyer":true}]}');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE tx uuid; details jsonb;
BEGIN
  INSERT INTO public.payment_transactions(product_id,session_id,customer_email,amount,currency,status,order_details)
  VALUES ('e1999999-1111-4111-8111-111111111111','cs_test_profileCompletion','example@example.com',10000,'PLN','pending','{"retained":true}') RETURNING id INTO tx;
  UPDATE public.payment_transactions SET status='completed' WHERE id=tx;
  SELECT order_details INTO details FROM public.payment_transactions WHERE id=tx;
  ASSERT details @> '{"details_missing":true,"retained":true}';
  ASSERT (SELECT status='completed' FROM public.payment_transactions WHERE id=tx);
  INSERT INTO public.payment_transactions(product_id,session_id,customer_email,amount,currency,status,order_details)
  VALUES ('e1999999-1111-4111-8111-111111111111','cs_test_profileComplete','example@example.com',10000,'PLN','completed',
    '{"buyer":{"v":1,"type":"person","first_name":"Jan","last_name":"Nowak","email":"jan@example.com"},"phone":{"v":1,"value":"+48500100200"},"quantity":{"v":1,"value":1},"participants":{"v":1,"people":[{"first_name":"Jan","last_name":"Nowak","email":"jan@example.com"}]}}') RETURNING id INTO tx;
  ASSERT (SELECT NOT order_details ? 'details_missing' FROM public.payment_transactions WHERE id=tx);
END $$;
ROLLBACK;
