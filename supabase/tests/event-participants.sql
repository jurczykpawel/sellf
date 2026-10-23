-- Participant recording grants use the same registration claim as buyer recording grants.
BEGIN;
DO $$
DECLARE
  pid uuid := gen_random_uuid(); recording uuid := gen_random_uuid(); component uuid := gen_random_uuid();
  bump uuid := gen_random_uuid(); sid uuid := gen_random_uuid(); tid uuid := gen_random_uuid(); tx uuid;
  buyer uuid := gen_random_uuid(); existing uuid := gen_random_uuid(); participant uuid; participant_email text; result jsonb;
BEGIN
  INSERT INTO public.products(id,name,slug,price,currency,event_mode) VALUES(pid,'Workshop','participants-'||pid,47,'PLN',true);
  INSERT INTO public.products(id,name,slug,price,currency,is_bundle) VALUES(recording,'Recording bundle','recording-'||recording,10,'PLN',true);
  INSERT INTO public.products(id,name,slug,price,currency) VALUES(component,'Recording','component-'||component,10,'PLN');
  INSERT INTO public.order_bumps(id,main_product_id,bump_product_id,bump_title,bump_price,is_active) VALUES(bump,pid,recording,'Recording',10,true);
  INSERT INTO public.bundle_items(bundle_product_id,component_product_id) VALUES(recording,component);
  INSERT INTO public.product_sessions(id,product_id,starts_at,capacity) VALUES(sid,pid,'2099-06-01',50);
  INSERT INTO public.product_price_tiers(id,session_id,price,sort) VALUES(tid,sid,47,0);
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(buyer,buyer||'@example.com',now());
  SELECT public.place_order(jsonb_build_object('product_id',pid,'currency','PLN','customer_email',buyer||'@example.com','session_id','cs_test_participants_'||replace(pid::text,'-','')),jsonb_build_array(
    jsonb_build_object('product_id',pid,'item_type','main_product','quantity',3,'unit_price',47,'total_price',141,'discounted_total',141,'currency','PLN','product_name','Workshop','session_id',sid),
    jsonb_build_object('product_id',recording,'item_type','order_bump','order_bump_id',bump,'quantity',1,'unit_price',10,'total_price',10,'discounted_total',10,'currency','PLN','product_name','Recording')
  )) INTO result;
  tx := (result->>'transaction_id')::uuid;
  UPDATE public.payment_transactions SET order_details='{"participants":{"people":{}}}'::jsonb WHERE id=tx;
  PERFORM public._order_grant_and_record(tx,buyer,NULL,buyer,NULL,'none');
  ASSERT NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=tx);

  UPDATE public.products SET event_mode=false WHERE id=pid;
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(existing,'one-'||pid||'@example.com',now());
  UPDATE public.payment_transactions SET order_details = jsonb_build_object('participants',jsonb_build_object('people',jsonb_build_array(
    jsonb_build_object('email','one-'||pid||'@example.com'),jsonb_build_object('email','two-'||pid||'@example.com'),jsonb_build_object('email','three-'||pid||'@example.com')
  ))) WHERE id=tx;
  PERFORM public._order_grant_and_record(tx,buyer,NULL,buyer,NULL,'none');
  ASSERT (SELECT count(*) FROM public.guest_purchases WHERE transaction_id=tx)=3, 'Three participant claims required';
  ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=existing AND product_id=recording), 'Existing participant receives access immediately';
  FOR participant_email IN SELECT customer_email FROM public.guest_purchases WHERE transaction_id=tx LOOP
    SELECT id INTO participant FROM auth.users u WHERE u.email=participant_email;
    IF participant IS NULL THEN
      participant := gen_random_uuid();
      INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(participant,participant_email,now());
    END IF;
    ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=participant AND product_id=recording), 'Recording access required';
    ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=participant AND product_id=component), 'Bundle component access required';
    ASSERT NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=participant AND product_id=pid), 'Participant claim only covers included products';
    ASSERT (SELECT user_id FROM public.payment_transactions WHERE id=tx) IS NULL, 'Participant must not claim buyer transaction';
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',participant)::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) FROM public.user_product_access WHERE product_id IN (recording,component))=2, 'Participant reads included access only';
  BEGIN
    ASSERT (SELECT count(*) FROM public.guest_purchases WHERE transaction_id=tx)<=1, 'Participant claim reads remain scoped';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    ASSERT (SELECT count(*) FROM public.guest_purchases WHERE transaction_id=tx)=0, 'Anonymous claim reads empty';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  UPDATE public.payment_transactions SET status='refunded' WHERE id=tx;
  ASSERT NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=tx), 'Refund removes participant claims';
  ASSERT NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id<>buyer AND product_id IN (recording,component)), 'Refund removes participant recording access';
  RAISE NOTICE 'PASS three participant registrations and recording bundle access';
END $$;
ROLLBACK;
