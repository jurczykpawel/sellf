\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_that(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.sale(p_product uuid DEFAULT 'af000000-0000-4000-a000-000000000003',p_coupon uuid DEFAULT 'af000000-0000-4000-a000-000000000005',p_net bigint DEFAULT 10000,p_pending boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE payment uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id,fulfillment_pending)
 VALUES(payment,p_product,'fixture@example.test',12300,'EUR','completed','cs_test_'||replace(payment::text,'-',''),p_pending);
 INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency,net_amount)
 VALUES(payment,p_product,'main_product',1,123,123,'EUR',p_net);
 INSERT INTO public.coupon_redemptions(coupon_id,transaction_id,customer_email,discount_amount,redeemed_at)
 VALUES(p_coupon,payment,'fixture@example.test',10,now()-interval '90 days');
 RETURN payment;
END $$;
CREATE FUNCTION pg_temp.sync(p_payment uuid,p_session timestamptz DEFAULT '2026-01-02',p_live boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w public.affiliate_work;
BEGIN
 UPDATE public.affiliate_work SET next_attempt_at=now() WHERE payment_id=p_payment;
 SELECT * INTO w FROM public.affiliate_claim_work(100) WHERE payment_id=p_payment;
 PERFORM public.affiliate_apply_sync(w.payment_id,w.lease_token,w.requested_generation,p_session,p_live);
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SAVEPOINT history;
DELETE FROM public.audit_log WHERE table_name LIKE 'affiliate_%';
DO $$ DECLARE payment uuid; BEGIN
 payment:=pg_temp.sale();
 PERFORM pg_temp.sync(payment);
 PERFORM pg_temp.check_that((SELECT count(*)=1 FROM public.affiliate_commissions WHERE payment_id=payment),'historical sale accrues after audit cleanup');
 payment:=pg_temp.sale();
 PERFORM pg_temp.sync(payment,now());
 PERFORM pg_temp.check_that((SELECT count(*)=1 FROM public.affiliate_commissions WHERE payment_id=payment),'new sale accrues after audit cleanup');
END $$;
DO $$ BEGIN
 BEGIN
  UPDATE public.affiliate_program_versions SET enabled=false;
  RAISE EXCEPTION 'History update accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  DELETE FROM public.affiliate_membership_events;
  RAISE EXCEPTION 'History deletion accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.affiliate_program_update('dddddddd-0000-4000-a000-000000000000',1,true,'demo-v1','{"en":"Changed","pl":"Zmienione"}',30,2,'{"EUR":"1000"}');
  RAISE EXCEPTION 'Changed terms accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
ROLLBACK TO history;
SAVEPOINT deletion;
DO $$ DECLARE product uuid; coupon uuid; payment uuid; BEGIN
 INSERT INTO public.products(name,slug,price,currency) VALUES('Ordinary coupon product','ordinary-coupon-product',123,'EUR') RETURNING id INTO product;
 INSERT INTO public.coupons(code,name,discount_type,discount_value) VALUES('ORDINARYFIX','Ordinary','percentage',10) RETURNING id INTO coupon;
 payment:=pg_temp.sale(product,coupon);
 PERFORM pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.affiliate_work WHERE payment_id=payment),'unbound redemption does not enqueue');
 UPDATE public.payment_transactions SET refunded_amount=100 WHERE id=payment;
 PERFORM pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.affiliate_work WHERE payment_id=payment),'unbound payment update does not enqueue');
 INSERT INTO public.affiliate_work(payment_id,status,dispute_seen) VALUES(payment,'pending',true);
 DELETE FROM public.products WHERE id=product;
 PERFORM pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=payment),'ordinary coupon product deletes with pending work');
END $$;
ROLLBACK TO deletion;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
