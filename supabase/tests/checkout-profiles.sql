\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.set_payment_order_details(jsonb,uuid,integer,text,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.set_payment_order_details(jsonb,uuid,integer,text,text)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.set_payment_order_details(jsonb,uuid,integer,text,text)', 'EXECUTE');
  ASSERT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.set_payment_order_details(jsonb,uuid,integer,text,text)'::regprocedure);
END $$;
INSERT INTO public.products(id,name,slug,price,currency,checkout_profile) VALUES
  ('eeeeeeee-1111-4111-8111-111111111111','Profile SQL','profile-sql-check',50,'PLN','{"v":1,"modules":[]}');
INSERT INTO public.payment_transactions(id,product_id,session_id,stripe_payment_intent_id,customer_email,amount,currency,status,order_details) VALUES
  ('eeeeeeee-2222-4222-8222-222222222222','eeeeeeee-1111-4111-8111-111111111111','cs_test_profileSql','pi_profileSql','profile@example.com',10000,'PLN','pending','{"retained":true}');
INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency) VALUES
  ('eeeeeeee-2222-4222-8222-222222222222','eeeeeeee-1111-4111-8111-111111111111','main_product',2,50,100,'PLN');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ BEGIN
  ASSERT public.set_payment_order_details('{"phone":{"v":1,"value":"+48501234567"}}','eeeeeeee-1111-4111-8111-111111111111',2,'cs_test_profileSql') = 1;
  ASSERT (SELECT order_details->>'retained'='true' FROM public.payment_transactions WHERE id='eeeeeeee-2222-4222-8222-222222222222');
  ASSERT public.set_payment_order_details('{"buyer":{"v":1}}','eeeeeeee-1111-4111-8111-111111111111',2,NULL,'pi_profileSql') = 1;
  ASSERT public.set_payment_order_details(jsonb_build_object('participants', jsonb_build_object('v',1,'people',(SELECT jsonb_agg(jsonb_build_object('first_name',repeat('A',100),'last_name',repeat('B',100),'email','p'||i||'@example.com')) FROM generate_series(1,100) i))), 'eeeeeeee-1111-4111-8111-111111111111',2,'cs_test_profileSql') = 1;
  ASSERT (SELECT order_details ? 'phone' AND order_details ? 'buyer' FROM public.payment_transactions WHERE id='eeeeeeee-2222-4222-8222-222222222222');
  ASSERT public.set_payment_order_details('{}','eeeeeeee-1111-4111-8111-111111111111',3,'cs_test_profileSql') = -1;
  ASSERT public.set_payment_order_details('{}','eeeeeeee-1111-4111-8111-111111111112',2,'cs_test_profileSql') = 0;
  BEGIN
    PERFORM public.set_payment_order_details(jsonb_build_object('large',repeat('a',65537)), 'eeeeeeee-1111-4111-8111-111111111111',2,'cs_test_profileSql');
    RAISE EXCEPTION 'Expected order size refusal';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    UPDATE public.payment_transactions SET order_details=jsonb_build_object('large',repeat('a',65537)) WHERE id='eeeeeeee-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'Expected order size constraint';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.payment_transactions SET status='completed'  WHERE id='eeeeeeee-2222-4222-8222-222222222222';
  ASSERT public.set_payment_order_details('{}','eeeeeeee-1111-4111-8111-111111111111',2,'cs_test_profileSql') = 0;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN
  PERFORM public.set_payment_order_details('{}','eeeeeeee-1111-4111-8111-111111111111',2,'cs_test_profileSql');
  RAISE EXCEPTION 'Expected anon refusal';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
DO $$ BEGIN
  PERFORM public.set_payment_order_details('{}','eeeeeeee-1111-4111-8111-111111111111',2,'cs_test_profileSql');
  RAISE EXCEPTION 'Expected authenticated refusal';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*)=1 FROM public.audit_log WHERE new_values @> '{"action":"product.checkout_profile.update","product_id":"eeeeeeee-1111-4111-8111-111111111111"}');
  UPDATE public.products SET checkout_profile=NULL WHERE id='eeeeeeee-1111-4111-8111-111111111111';
  ASSERT (SELECT count(*)=2 FROM public.audit_log WHERE new_values @> '{"action":"product.checkout_profile.update","product_id":"eeeeeeee-1111-4111-8111-111111111111"}');
  BEGIN
    UPDATE public.products SET checkout_profile='[]' WHERE id='eeeeeeee-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'Expected object constraint';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.products SET checkout_profile=jsonb_build_object('large',repeat('a',8193)) WHERE id='eeeeeeee-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'Expected size constraint';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
