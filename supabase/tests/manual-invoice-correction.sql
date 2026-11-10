BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE p uuid; tx uuid; r boolean; actor uuid;
BEGIN
  ASSERT NOT has_function_privilege('anon','public.record_invoice_correction(uuid,uuid)','execute');
  ASSERT NOT has_function_privilege('authenticated','public.record_invoice_correction(uuid,uuid)','execute');
  SELECT user_id INTO actor FROM public.admin_users LIMIT 1;
  IF actor IS NULL THEN
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(gen_random_uuid(),'correction-admin@example.com',now()) RETURNING id INTO actor;
    INSERT INTO public.admin_users(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.products(name,slug,price,currency) VALUES('Invoice test','manual-correction-test',10,'PLN') RETURNING id INTO p;
  INSERT INTO public.payment_transactions(product_id,amount,currency,status,payment_provider,customer_email,invoice_hold_at,pricing_snapshot_version)
    VALUES(p,1000,'PLN','cancelled','bank_transfer','buyer@example.com',now(),1) RETURNING id INTO tx;
  r := public.record_invoice_correction(tx, actor);
  ASSERT r, 'manual correction recorded';
  ASSERT (SELECT status='corrected' AND provider='manual' FROM public.invoices WHERE transaction_id=tx), 'manual correction persisted';
  ASSERT public.record_invoice_correction(tx, actor), 'correction is idempotent';
  ASSERT (SELECT count(*) FROM public.invoices WHERE transaction_id=tx)=1;
  ASSERT NOT (public.admin_bank_transfer_order(tx,'mark-paid',1000,now(),'Received',actor,true)->>'success')::boolean, 'corrected order stays cancelled';
  DELETE FROM public.invoices WHERE transaction_id=tx;
  UPDATE public.payment_transactions SET invoice_hold_at=NULL WHERE id=tx;
  ASSERT NOT public.record_invoice_correction(tx, actor), 'no invoice to correct';
  UPDATE public.payment_transactions SET invoice_hold_at=now(),status='awaiting_payment' WHERE id=tx;
  ASSERT NOT public.record_invoice_correction(tx, actor), 'unpaid order needs no correction';
  UPDATE public.payment_transactions SET status='refunded' WHERE id=tx;
  ASSERT public.record_invoice_correction(tx, actor), 'refunded order supports correction';
END $$;
ROLLBACK;
