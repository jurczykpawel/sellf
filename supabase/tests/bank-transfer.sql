BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE p uuid; sid uuid; tid uuid; tx jsonb; order_input jsonb; lines jsonb; n integer; admin_id uuid; buyer_id uuid:=gen_random_uuid();
BEGIN
  IF has_function_privilege('anon','public.bank_transfer_order(jsonb,jsonb)','execute') THEN RAISE EXCEPTION 'public placement'; END IF;
  SELECT user_id INTO admin_id FROM public.admin_users LIMIT 1;
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_account_holder='Example workshop',bank_account_number='PL61109010140000071219812874';
  INSERT INTO public.products(name,slug,price,currency,event_mode,checkout_profile)
    VALUES ('Transfer workshop','transfer-sql-test',47,'PLN',true,'{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}') RETURNING id INTO p;
  UPDATE public.products SET sale_price=47 WHERE id=p;
  INSERT INTO public.product_sessions(product_id,starts_at,capacity) VALUES(p,'2099-01-01',5) RETURNING id INTO sid;
  INSERT INTO public.product_price_tiers(session_id,price,seats,sort) VALUES(sid,47,5,0) RETURNING id INTO tid;
  order_input:=jsonb_build_object('product_id',p,'currency','PLN','customer_email','transfer-sql@example.com','order_details',jsonb_build_object('v',1,'buyer',jsonb_build_object('type','organization','terms_accepted',true)));
  lines:=jsonb_build_array(jsonb_build_object('product_id',p,'item_type','main_product','quantity',2,'unit_price',47,'total_price',94,'discounted_total',94,'currency','PLN','session_id',sid));
  tx:=public.bank_transfer_order(order_input,lines);
  IF (tx->>'amount')::numeric<>9400 THEN RAISE EXCEPTION 'price'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.seat_reservations WHERE transaction_id=(tx->>'transaction_id')::uuid AND status='held' AND expires_at IS NULL) THEN RAISE EXCEPTION 'persistent hold'; END IF;
  ASSERT (public.event_session_admin(sid)->>'held')::integer=2;
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(buyer_id,'transfer-sql@example.com',now());
  PERFORM set_config('request.jwt.claim.sub',buyer_id::text,true);
  ASSERT jsonb_array_length(public.my_event_sessions(p))=1;
  PERFORM public.expire_seat_reservations();
  IF (public.event_availability(p)->0->>'remaining')::integer<>3 THEN RAISE EXCEPTION 'hold availability'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=(tx->>'transaction_id')::uuid) THEN RAISE EXCEPTION 'early entitlement'; END IF;
  IF (public.admin_bank_transfer_order((tx->>'transaction_id')::uuid,'mark-paid',9300,now(),NULL,admin_id)->>'success')::boolean THEN RAISE EXCEPTION 'amount mismatch'; END IF;
  IF NOT (public.admin_bank_transfer_order((tx->>'transaction_id')::uuid,'mark-paid',9400,now(),NULL,admin_id)->>'success')::boolean THEN RAISE EXCEPTION 'completion'; END IF;
  PERFORM public.admin_bank_transfer_order((tx->>'transaction_id')::uuid,'mark-paid',9400,now(),NULL,admin_id);
  IF (SELECT sale_quantity_sold FROM public.products WHERE id=p)<>2 THEN RAISE EXCEPTION 'completion idempotency'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.seat_reservations WHERE transaction_id=(tx->>'transaction_id')::uuid AND status='confirmed') THEN RAISE EXCEPTION 'confirm'; END IF;
  tx:=public.bank_transfer_order(order_input,lines);
  PERFORM public.admin_bank_transfer_order((tx->>'transaction_id')::uuid,'cancel',NULL,NULL,'Customer request',admin_id);
  PERFORM public.admin_bank_transfer_order((tx->>'transaction_id')::uuid,'cancel',NULL,NULL,'Customer request',admin_id);
  IF EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=(tx->>'transaction_id')::uuid) THEN RAISE EXCEPTION 'cancel claims'; END IF;
  IF (public.event_availability(p)->0->>'remaining')::integer<>3 THEN RAISE EXCEPTION 'cancel seats'; END IF;
  UPDATE public.bank_transfer_config SET bank_transfer_max_unpaid_per_email=1;
  tx:=public.bank_transfer_order(order_input,lines);
  BEGIN
    PERFORM public.bank_transfer_order(order_input,lines);
    RAISE EXCEPTION 'missing unpaid limit';
  EXCEPTION WHEN SQLSTATE 'P0429' THEN NULL; END;
END $$;
DO $$
DECLARE p uuid; recording uuid; bump uuid; buyer uuid:=gen_random_uuid(); participant uuid:=gen_random_uuid(); prior uuid:=gen_random_uuid();
  tx jsonb; input jsonb; lines jsonb; coupon uuid;
BEGIN
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
    (buyer,'transfer-buyer@example.com',now()),(participant,'transfer-participant@example.com',now()),(prior,'transfer-prior@example.com',now());
  INSERT INTO public.products(name,slug,price,currency,checkout_profile) VALUES('Transfer course','transfer-access-test',100,'PLN',
    '{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}') RETURNING id INTO p;
  INSERT INTO public.products(name,slug,price,currency) VALUES('Recording','transfer-recording-test',20,'PLN') RETURNING id INTO recording;
  INSERT INTO public.order_bumps(main_product_id,bump_product_id,bump_title) VALUES(p,recording,'Recording') RETURNING id INTO bump;
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_transfer_max_unpaid_per_email=3;
  input:=jsonb_build_object('product_id',p,'currency','PLN','customer_email','transfer-buyer@example.com','order_details',
    '{"v":1,"buyer":{"type":"organization","terms_accepted":true},"participants":{"people":[{"email":"transfer-participant@example.com"}]}}'::jsonb);
  lines:=jsonb_build_array(jsonb_build_object('product_id',p,'item_type','main_product','quantity',1,'unit_price',100,'total_price',100,'discounted_total',100,'currency','PLN'),
    jsonb_build_object('product_id',recording,'item_type','order_bump','order_bump_id',bump,'quantity',1,'unit_price',20,'total_price',20,'discounted_total',20,'currency','PLN'));
  INSERT INTO public.coupons(code,discount_type,discount_value,usage_limit_global) VALUES('TRANSFER_SQL','percentage',10,10) RETURNING id INTO coupon;
  INSERT INTO public.coupon_reservations(coupon_id,customer_email,expires_at) VALUES(coupon,'transfer-buyer@example.com','2099-01-01');
  tx:=public.bank_transfer_order(input||jsonb_build_object('coupon_id',coupon),lines);
  ASSERT (tx->>'dueAt')::timestamptz=now()+interval '14 days';
  ASSERT (SELECT current_usage_count FROM public.coupons WHERE id=coupon)=1;
  ASSERT (SELECT count(*) FROM public.user_product_access WHERE user_id=buyer AND transfer_transaction_id=(tx->>'transaction_id')::uuid)=2;
  ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=participant AND product_id=recording AND transfer_transaction_id=(tx->>'transaction_id')::uuid);
  ASSERT (SELECT user_id FROM public.payment_transactions WHERE id=(tx->>'transaction_id')::uuid)=buyer;
  ASSERT NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=participant AND product_id=p);
  PERFORM public.cancel_unpaid_order((tx->>'transaction_id')::uuid,'Fixture cancellation');
  ASSERT NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id IN(buyer,participant) AND product_id IN(p,recording));
  ASSERT (SELECT current_usage_count FROM public.coupons WHERE id=coupon)=0;
  ASSERT NOT EXISTS(SELECT 1 FROM public.coupon_redemptions WHERE transaction_id=(tx->>'transaction_id')::uuid);
  PERFORM public.grant_product_and_bundle_components(prior,p);
  input:=input||jsonb_build_object('customer_email','transfer-prior@example.com','order_details','{"v":1,"buyer":{"type":"organization","terms_accepted":true}}'::jsonb);
  tx:=public.bank_transfer_order(input,lines);
  PERFORM public.cancel_unpaid_order((tx->>'transaction_id')::uuid,'Keep prior access');
  ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=prior AND product_id=p AND transfer_transaction_id IS NULL);
  input:=input||'{"customer_email":"transfer-buyer@example.com"}';
  tx:=public.bank_transfer_order(input,lines);
  DECLARE second_tx jsonb:=public.bank_transfer_order(input,lines);
  BEGIN
    PERFORM public.cancel_unpaid_order((tx->>'transaction_id')::uuid,'First of two orders');
    ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=buyer AND product_id=p);
    PERFORM public.cancel_unpaid_order((second_tx->>'transaction_id')::uuid,'Second order');
    ASSERT NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=buyer AND product_id=p);
  END;
  INSERT INTO public.user_product_access(user_id,product_id,access_granted_at,access_expires_at) VALUES(buyer,p,'1999-01-01','2000-01-01');
  tx:=public.bank_transfer_order(input,lines);
  ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=buyer AND product_id=p AND access_expires_at IS NULL);
  PERFORM public.cancel_unpaid_order((tx->>'transaction_id')::uuid,'Expired previous access');
  ASSERT NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=buyer AND product_id=p);
  UPDATE public.bank_transfer_config SET bank_transfer_grant_access_on_placement=false;
  tx:=public.bank_transfer_order(input||'{"customer_email":"transfer-deferred@example.com"}',lines);
  ASSERT NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=(tx->>'transaction_id')::uuid);
  PERFORM public.complete_offline_order((tx->>'transaction_id')::uuid,12000);
  ASSERT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=(tx->>'transaction_id')::uuid);
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=false;
  BEGIN
    PERFORM public.bank_transfer_order(input,lines); RAISE EXCEPTION 'Disabled transfer accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT NOT has_function_privilege('authenticated','public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean)','execute');
  ASSERT NOT has_table_privilege('anon','public.bank_transfer_config','select');
  RAISE NOTICE 'PASS transfer price, holds, expiry, limit, early/deferred access, participants, prior rights, coupon reversal and roles';
END $$;
ROLLBACK;
