-- The service placement policy must preserve actual buyer consent.
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE p uuid; buyer uuid:=gen_random_uuid(); input jsonb; lines jsonb; placed jsonb;
BEGIN
  ASSERT NOT has_function_privilege('anon','public.bank_transfer_order(jsonb,jsonb)','execute');
  ASSERT NOT has_function_privilege('authenticated','public.bank_transfer_order(jsonb,jsonb)','execute');
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_transfer_grant_access_on_placement=false;
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(buyer,'consent-buyer@example.com','2026-01-01');
  INSERT INTO public.products(name,slug,price,currency,checkout_profile) VALUES('Company workshop','consent-workshop',100,'PLN',
    '{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}') RETURNING id INTO p;
  input:=jsonb_build_object('product_id',p,'currency','PLN','customer_email','consent-buyer@example.com','user_id',buyer,
    'order_details','{"v":1,"buyer":{"type":"organization","terms_accepted":false}}'::jsonb);
  lines:=jsonb_build_array(jsonb_build_object('product_id',p,'item_type','main_product','quantity',1,'unit_price',100,'total_price',100,'discounted_total',100,'currency','PLN'));
  placed:=public.bank_transfer_order(input||'{"terms_required":false}',lines);
  ASSERT EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=(placed->>'transaction_id')::uuid AND user_id=buyer
    AND status='awaiting_payment' AND amount=10000 AND order_details->'buyer'->>'terms_accepted'='false');
  -- Absent, required or non-boolean policies retain the strict default.
  FOR input IN SELECT value FROM jsonb_array_elements(jsonb_build_array(input,input||'{"terms_required":true}',input||'{"terms_required":"false"}')) LOOP
    BEGIN
      PERFORM public.bank_transfer_order(input,lines);
      RAISE EXCEPTION 'Missing required consent accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  RAISE NOTICE 'PASS placement preserves absent new consent and enforces required consent';
END $$;
ROLLBACK;
