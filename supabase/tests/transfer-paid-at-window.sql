-- W146 B10: the receipt date of a bank transfer must fall between the order day and now.
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE p uuid; sid uuid; tid uuid; tx jsonb; r jsonb; admin_id uuid; o uuid;
BEGIN
  SELECT user_id INTO admin_id FROM public.admin_users LIMIT 1;
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_account_holder='Example workshop',bank_account_number='PL61109010140000071219812874';
  INSERT INTO public.products(name,slug,price,currency,event_mode,checkout_profile)
    VALUES ('Paid-at window','paid-at-window-sql',47,'PLN',true,'{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}') RETURNING id INTO p;
  INSERT INTO public.product_sessions(product_id,starts_at,capacity) VALUES(p,'2099-01-01',5) RETURNING id INTO sid;
  INSERT INTO public.product_price_tiers(session_id,price,seats,sort) VALUES(sid,47,5,0) RETURNING id INTO tid;
  tx:=public.bank_transfer_order(
    jsonb_build_object('product_id',p,'currency','PLN','customer_email','paid-at@example.com','order_details',jsonb_build_object('v',1,'buyer',jsonb_build_object('type','organization','terms_accepted',true))),
    jsonb_build_array(jsonb_build_object('product_id',p,'item_type','main_product','quantity',1,'unit_price',47,'total_price',47,'discounted_total',47,'currency','PLN','session_id',sid)));
  o:=(tx->>'transaction_id')::uuid;
  r:=public.admin_bank_transfer_order(o,'mark-paid',4700,'2020-01-01T00:00:00Z',NULL,admin_id);
  ASSERT r->>'error'='paid_at_before_order', 'receipt before the order is refused: '||r::text;
  r:=public.admin_bank_transfer_order(o,'mark-paid',4700,now()+interval '1 day',NULL,admin_id);
  ASSERT r->>'error'='paid_at_future', 'receipt in the future is refused with a code: '||r::text;
  ASSERT (SELECT status FROM public.payment_transactions WHERE id=o)='awaiting_payment', 'refusals change nothing';
  -- The admin form sends the chosen day at 00:00 UTC; the order day itself is valid.
  r:=public.admin_bank_transfer_order(o,'mark-paid',4700,date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',NULL,admin_id);
  ASSERT (r->>'success')::boolean, 'receipt on the order day is accepted: '||r::text;
END $$;
ROLLBACK;
