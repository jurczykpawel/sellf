-- Unpaid transfer lifecycle: timed reservation, reminder, release, declaration, invoice hold, late acceptance.
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE p uuid; plain uuid; sid uuid; tid uuid; tx jsonb; o uuid; o2 uuid; input jsonb; lines jsonb; lines80 jsonb; plain_lines jsonb;
  admin_id uuid; coupon uuid; r jsonb; t0 timestamptz := now(); row public.payment_transactions%ROWTYPE; n integer;
BEGIN
  -- privileges: lifecycle functions are server-only
  ASSERT NOT has_function_privilege('anon','public.release_unpaid_transfer(uuid,timestamptz)','execute');
  ASSERT NOT has_function_privilege('authenticated','public.release_unpaid_transfer(uuid,timestamptz)','execute');
  ASSERT NOT has_function_privilege('anon','public.declare_transfer(uuid,text,timestamptz)','execute');
  ASSERT NOT has_function_privilege('authenticated','public.hold_transfer_for_invoice(uuid,timestamptz)','execute');
  ASSERT NOT has_function_privilege('authenticated','public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean)','execute');
  SELECT user_id INTO admin_id FROM public.admin_users LIMIT 1;
  IF admin_id IS NULL THEN
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(gen_random_uuid(),'unpaid-admin@example.com',now()) RETURNING id INTO admin_id;
    INSERT INTO public.admin_users(user_id) VALUES(admin_id);
  END IF;
  -- defaults and validation of seller settings
  ASSERT (SELECT reservation_enabled AND reservation_reminder_hours=24 AND reservation_release_hours=48 AND declared_hold_hours=72 FROM public.bank_transfer_config);
  BEGIN
    UPDATE public.bank_transfer_config SET reservation_reminder_hours=48,reservation_release_hours=48;
    RAISE EXCEPTION 'release must follow reminder';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_account_holder='Example workshop',
    bank_account_number='PL61109010140000071219812874',bank_transfer_max_unpaid_per_email=50;
  INSERT INTO public.products(name,slug,price,currency,event_mode,checkout_profile)
    VALUES ('Unpaid workshop','unpaid-sql-test',50,'PLN',true,'{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}') RETURNING id INTO p;
  INSERT INTO public.product_sessions(product_id,starts_at,capacity) VALUES(p,'2099-01-01',4) RETURNING id INTO sid;
  INSERT INTO public.product_price_tiers(session_id,price,seats,sort) VALUES(sid,50,2,0) RETURNING id INTO tid;
  INSERT INTO public.product_price_tiers(session_id,price,seats,sort) VALUES(sid,80,NULL,1);
  input:=jsonb_build_object('product_id',p,'currency','PLN','customer_email','unpaid-sql@example.com',
    'order_details',jsonb_build_object('v',1,'buyer',jsonb_build_object('type','organization','terms_accepted',true)));
  lines:=jsonb_build_array(jsonb_build_object('product_id',p,'item_type','main_product','quantity',1,'unit_price',50,'total_price',50,'discounted_total',50,'currency','PLN','session_id',sid));

  -- (1) event transfer gets a timed reservation: reminder 24 h, release 48 h; the payment term is unchanged
  tx:=public.bank_transfer_order(input,lines); o:=(tx->>'transaction_id')::uuid;
  SELECT * INTO row FROM public.payment_transactions WHERE id=o;
  ASSERT row.reminder_at=t0+interval '24 hours', 'reminder_at';
  ASSERT row.release_at=t0+interval '48 hours', 'release_at';
  ASSERT row.payment_due_at=t0+interval '14 days', 'payment term stays the seller due days';
  ASSERT (tx->>'dueAt')::timestamptz=row.payment_due_at, 'returned due date';
  ASSERT (tx->>'releaseAt')::timestamptz=row.release_at, 'returned release';

  -- (2) release boundaries: before the window nothing happens; at the exact moment the seat returns
  r:=public.release_unpaid_transfer(o,t0+interval '48 hours'-interval '1 second');
  ASSERT (r->>'released')::boolean=false, 'early release';
  ASSERT (SELECT status FROM public.payment_transactions WHERE id=o)='awaiting_payment';
  -- (3) declaration extends once by 72 h from declaration time, never shortens
  r:=public.declare_transfer(o,'Przelew wysłany 3.11',t0+interval '30 hours');
  ASSERT (r->>'success')::boolean AND (r->>'releaseAt')::timestamptz=t0+interval '102 hours', 'declared extension';
  r:=public.declare_transfer(o,'drugi raz',t0+interval '40 hours');
  ASSERT (r->>'already_declared')::boolean, 'declared twice';
  SELECT * INTO row FROM public.payment_transactions WHERE id=o;
  ASSERT row.release_at=t0+interval '102 hours' AND row.transfer_declared_note='Przelew wysłany 3.11', 'declaration once';
  BEGIN
    PERFORM public.declare_transfer(o,repeat('x',201),t0);
    RAISE EXCEPTION 'long note accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r:=public.release_unpaid_transfer(o,t0+interval '101 hours');
  ASSERT (r->>'released')::boolean=false, 'declared hold respected';
  r:=public.release_unpaid_transfer(o,t0+interval '102 hours');
  ASSERT (r->>'released')::boolean, 'release at boundary';
  SELECT * INTO row FROM public.payment_transactions WHERE id=o;
  ASSERT row.status='cancelled' AND row.cancel_reason='payment_window_expired', 'cancel reason';
  ASSERT (SELECT status FROM public.seat_reservations WHERE transaction_id=o)='released', 'seat released';
  ASSERT NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=o), 'access withdrawn';
  -- idempotent: second release does nothing
  ASSERT (public.release_unpaid_transfer(o,t0+interval '200 hours')->>'released')::boolean=false;
  ASSERT (SELECT count(*) FROM public.business_events WHERE event_type='seats.released' AND payload->'order'->>'orderId'=o::text)=1;

  -- (4) late transfer after release: admin must explicitly accept the cancelled order
  ASSERT (public.admin_bank_transfer_order(o,'mark-paid',5000,t0,NULL,admin_id)->>'success')::boolean=false, 'silent late completion';
  BEGIN
    PERFORM public.admin_bank_transfer_order(o,'mark-paid',5000,t0,'',admin_id,true);
    RAISE EXCEPTION 'acceptance without reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT (public.admin_bank_transfer_order(o,'mark-paid',4000,t0,'Przelew po terminie',admin_id,true)->>'success')::boolean=false, 'amount must match';
  -- the promo seats are taken by two other buyers in the meantime
  tx:=public.bank_transfer_order(input||'{"customer_email":"other-1@example.com"}',lines);
  tx:=public.bank_transfer_order(input||'{"customer_email":"other-2@example.com"}',lines);
  r:=public.admin_bank_transfer_order(o,'mark-paid',5000,t0,'Przelew po terminie',admin_id,true);
  ASSERT (r->>'success')::boolean AND (r->>'reopened')::boolean AND r->>'previous_status'='cancelled', 'late acceptance';
  SELECT * INTO row FROM public.payment_transactions WHERE id=o;
  ASSERT row.status='completed' AND row.reopened_at IS NOT NULL AND row.amount=5000, 'reopened at order price';
  ASSERT (row.metadata->>'oversold')::boolean, 'over the limit is marked oversold';
  ASSERT EXISTS(SELECT 1 FROM public.audit_log WHERE new_values->>'action'='order.reopened' AND new_values->>'transaction_id'=o::text);
  ASSERT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=o), 'access granted again';
  -- second click is idempotent
  ASSERT (public.admin_bank_transfer_order(o,'mark-paid',5000,t0,'Przelew po terminie',admin_id,true)->>'success')::boolean;
  ASSERT (SELECT count(*) FROM public.audit_log WHERE new_values->>'action'='order.reopened' AND new_values->>'transaction_id'=o::text)=1;

  -- (5) issued invoice = held without expiry; only cancellation releases
  lines80:=jsonb_build_array(jsonb_build_object('product_id',p,'item_type','main_product','quantity',1,'unit_price',80,'total_price',80,'discounted_total',80,'currency','PLN','session_id',sid));
  tx:=public.bank_transfer_order(input||'{"customer_email":"invoice@example.com"}',lines80);
  o2:=(tx->>'transaction_id')::uuid;
  INSERT INTO public.invoices(transaction_id,provider,provider_domain,external_key,status) VALUES(o2,'fakturownia','x.fakturownia.pl','sql:'||o2,'issued');
  SELECT * INTO row FROM public.payment_transactions WHERE id=o2;
  ASSERT row.invoice_hold_at IS NOT NULL AND row.release_at IS NULL AND row.reminder_at IS NULL, 'invoice clears the timer';
  ASSERT (public.release_unpaid_transfer(o2,t0+interval '10 years')->>'released')::boolean=false, 'invoice never expires';
  ASSERT (SELECT status FROM public.seat_reservations WHERE transaction_id=o2)='held';
  r:=public.admin_bank_transfer_order(o2,'cancel',NULL,NULL,'Rezygnacja',admin_id);
  ASSERT (r->>'success')::boolean AND (r->>'invoice_correction_required')::boolean, 'cancel flags correction';
  ASSERT (SELECT cancel_reason FROM public.payment_transactions WHERE id=o2)='admin';
  UPDATE public.invoices SET status='corrected' WHERE transaction_id=o2;
  ASSERT (public.admin_bank_transfer_order(o2,'mark-paid',8000,t0,'Po korekcie',admin_id,true)->>'error')='invoice_corrected', 'corrected blocks';
  -- explicit invoice mark for external invoicing (integrator via API)
  tx:=public.bank_transfer_order(input||'{"customer_email":"ext-invoice@example.com"}',lines80);
  o2:=(tx->>'transaction_id')::uuid;
  r:=public.admin_bank_transfer_order(o2,'invoice-issued',NULL,NULL,NULL,admin_id);
  ASSERT (r->>'success')::boolean AND (SELECT release_at IS NULL AND invoice_hold_at IS NOT NULL FROM public.payment_transactions WHERE id=o2);
  ASSERT (public.declare_transfer(o2,NULL,t0)->>'success')::boolean, 'declaration without timer';
  ASSERT (SELECT release_at IS NULL FROM public.payment_transactions WHERE id=o2), 'declaration keeps invoice hold';

  -- (6) coupon use returns to the pool on release; late acceptance re-uses it even past its limit
  INSERT INTO public.coupons(code,discount_type,discount_value,usage_limit_global) VALUES('UNPAID_SQL','percentage',10,1) RETURNING id INTO coupon;
  INSERT INTO public.coupon_reservations(coupon_id,customer_email,expires_at) VALUES(coupon,'coupon@example.com','2099-01-01');
  INSERT INTO public.product_sessions(product_id,starts_at,capacity) VALUES(p,'2099-02-01',10) RETURNING id INTO sid;
  INSERT INTO public.product_price_tiers(session_id,price,sort) VALUES(sid,50,0);
  lines:=jsonb_set(lines,'{0,session_id}',to_jsonb(sid));
  tx:=public.bank_transfer_order(input||jsonb_build_object('customer_email','coupon@example.com','coupon_id',coupon),lines); o:=(tx->>'transaction_id')::uuid;
  ASSERT (SELECT current_usage_count FROM public.coupons WHERE id=coupon)=1;
  ASSERT (public.release_unpaid_transfer(o,t0+interval '48 hours')->>'released')::boolean;
  ASSERT (SELECT current_usage_count FROM public.coupons WHERE id=coupon)=0, 'coupon returned';
  UPDATE public.coupons SET current_usage_count=1 WHERE id=coupon;
  r:=public.admin_bank_transfer_order(o,'mark-paid',(SELECT amount FROM public.payment_transactions WHERE id=o),t0,'Spóźniony',admin_id,true);
  ASSERT (r->>'success')::boolean, 'coupon past limit still accepted';
  ASSERT (SELECT count(*) FROM public.coupon_redemptions WHERE transaction_id=o)=1 AND (SELECT current_usage_count FROM public.coupons WHERE id=coupon)=2;
  ASSERT (SELECT status FROM public.seat_reservations WHERE transaction_id=o)='confirmed', 'seat available is re-taken';
  ASSERT NOT coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=o),false);

  -- (7) regular product: no timer, no release
  INSERT INTO public.products(name,slug,price,currency,checkout_profile) VALUES('Unpaid course','unpaid-plain-test',100,'PLN',
    '{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}') RETURNING id INTO plain;
  plain_lines:=jsonb_build_array(jsonb_build_object('product_id',plain,'item_type','main_product','quantity',1,'unit_price',100,'total_price',100,'discounted_total',100,'currency','PLN'));
  tx:=public.bank_transfer_order(input||jsonb_build_object('product_id',plain),plain_lines); o:=(tx->>'transaction_id')::uuid;
  ASSERT (SELECT release_at IS NULL AND reminder_at IS NULL AND payment_due_at=t0+interval '14 days' FROM public.payment_transactions WHERE id=o), 'plain product';
  ASSERT (public.release_unpaid_transfer(o,t0+interval '10 years')->>'released')::boolean=false;

  -- (8) seller switched timers off; session starting before the window refuses a transfer
  UPDATE public.bank_transfer_config SET reservation_enabled=false;
  tx:=public.bank_transfer_order(input||'{"customer_email":"off@example.com"}',lines);
  ASSERT (SELECT release_at IS NULL FROM public.payment_transactions WHERE id=(tx->>'transaction_id')::uuid), 'disabled timer';
  UPDATE public.bank_transfer_config SET reservation_enabled=true,reservation_reminder_hours=2,reservation_release_hours=6;
  tx:=public.bank_transfer_order(input||'{"customer_email":"custom@example.com"}',lines);
  ASSERT (SELECT release_at=t0+interval '6 hours' AND reminder_at=t0+interval '2 hours' FROM public.payment_transactions WHERE id=(tx->>'transaction_id')::uuid), 'seller windows';
  UPDATE public.product_sessions SET starts_at=t0+interval '5 hours' WHERE id=sid;
  BEGIN
    PERFORM public.bank_transfer_order(input||'{"customer_email":"late@example.com"}',lines);
    RAISE EXCEPTION 'transfer offered too close to the session';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- (9) declaration only for unpaid orders
  ASSERT (public.declare_transfer(o,NULL,t0)->>'success')::boolean;
  UPDATE public.payment_transactions SET status='cancelled' WHERE id=o;
  ASSERT (public.declare_transfer(o,NULL,t0)->>'success')::boolean=false, 'declare on cancelled';
END $$;
ROLLBACK;
