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
SAVEPOINT readiness;
DO $$ DECLARE payment uuid; BEGIN
 payment:=pg_temp.sale(p_net=>NULL,p_pending=>true);
 PERFORM pg_temp.sync(payment);
 PERFORM pg_temp.check_that((SELECT status='pending' AND attempts=1 AND last_error_code='awaiting_fulfillment' FROM public.affiliate_work WHERE payment_id=payment),'pending fulfillment retains attempt count');
 UPDATE public.payment_transactions SET fulfillment_pending=false WHERE id=payment;
 PERFORM pg_temp.sync(payment);
 PERFORM pg_temp.check_that((SELECT status='needs_review' AND attempts=2 AND last_error_code='net_unavailable' AND processed_generation=0 FROM public.affiliate_work WHERE payment_id=payment),'fulfilled missing net requires review');
END $$;
ROLLBACK TO readiness;
SAVEPOINT stale;
DO $$ DECLARE payment uuid; coupon uuid; member uuid; payout public.affiliate_payouts; BEGIN
 INSERT INTO public.affiliate_memberships(user_id,code,status,display_name,accepted_terms_version,accepted_at)
 VALUES('dddddddd-0000-4000-a000-000000000000','stale-fixture','approved','Fixture','demo-v1',now()) RETURNING id INTO member;
 INSERT INTO public.affiliate_membership_events(member_id,version,status,created_at) VALUES(member,1,'approved','2026-01-01');
 INSERT INTO public.coupons(code,name,discount_type,discount_value) VALUES('STALEFIX','Fixture','percentage',10) RETURNING id INTO coupon;
 INSERT INTO public.affiliate_coupon_bindings(coupon_id,member_id,version,created_at) VALUES(coupon,member,1,'2026-01-01');
 SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE public.affiliate_ledger ALTER COLUMN created_at SET DEFAULT now()-interval '2 days'; SET CONSTRAINTS ALL DEFERRED;
 payment:=pg_temp.sale(p_coupon=>coupon); PERFORM pg_temp.sync(payment);
 SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE public.affiliate_ledger ALTER COLUMN created_at SET DEFAULT now(); SET CONSTRAINTS ALL DEFERRED;
 UPDATE public.payment_transactions SET refunded_amount=12300 WHERE id=payment;
 PERFORM pg_temp.sync(payment);
 BEGIN
  PERFORM public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000',member,'EUR',now()-interval '1 day',1,1,'Fixture');
  RAISE EXCEPTION 'Stale refunded earnings reserved';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.affiliate_payouts WHERE member_id=member),'refund after cutoff leaves no payout');
 -- Paid earnings produce debt against a different sale with an earlier preview cutoff.
 SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE public.affiliate_ledger ALTER COLUMN created_at SET DEFAULT now()-interval '2 days'; SET CONSTRAINTS ALL DEFERRED;
 payment:=pg_temp.sale(p_coupon=>coupon); PERFORM pg_temp.sync(payment);
 SELECT * INTO payout FROM public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000',member,'EUR',now()-interval '1 day',1,1,'Fixture');
 PERFORM public.affiliate_mark_paid('dddddddd-0000-4000-a000-000000000000',payout.id,1,'stale-bank','stale-invoice',2000,'EUR',now(),true);
 PERFORM pg_temp.sync(pg_temp.sale(p_coupon=>coupon));
 SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE public.affiliate_ledger ALTER COLUMN created_at SET DEFAULT now(); SET CONSTRAINTS ALL DEFERRED;
 UPDATE public.payment_transactions SET refunded_amount=12300 WHERE id=payment; PERFORM pg_temp.sync(payment);
 BEGIN
  PERFORM public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000',member,'EUR',now()-interval '1 day',1,1,'Fixture');
  RAISE EXCEPTION 'Current debt excluded from old cutoff';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
ROLLBACK TO stale;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
