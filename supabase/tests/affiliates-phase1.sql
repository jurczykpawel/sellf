\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_that(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.rejects(statement text, expected_code text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN expected_code IS NULL OR SQLSTATE=expected_code; END $$;
SELECT pg_temp.check_that((SELECT count(*)=11 FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'affiliate_%'),'eleven affiliate tables');
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"dddddddd-0000-4000-a000-000000000000"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.check_that(pg_temp.rejects('UPDATE public.affiliate_rules SET enabled=false'),'rules remain immutable');
SELECT pg_temp.check_that(pg_temp.rejects('DELETE FROM public.affiliate_ledger'),'ledger remains immutable');
RESET ROLE;
DO $$ DECLARE t text; r text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'affiliate_%' LOOP
  PERFORM pg_temp.check_that((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass),t||' RLS');
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.check_that(NOT has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE'),r||' has no direct '||t);
  END LOOP;
 END LOOP;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.check_that(pg_temp.rejects('SELECT * FROM public.affiliate_memberships'),'anonymous table read denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bbbbbbbb-0000-4000-a000-000000000000"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_that(pg_temp.rejects('SELECT * FROM public.affiliate_commissions'),'member table read denied');
SELECT pg_temp.check_that(pg_temp.rejects('SELECT public.affiliate_claim_work(1)'),'member work RPC denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"dddddddd-0000-4000-a000-000000000000"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_that(pg_temp.rejects('SELECT * FROM public.affiliate_memberships'),'session admin table read denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"dddddddd-0000-4000-a000-000000000000"}',true);
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_apply('dddddddd-0000-4000-a000-000000000000','test-partner','Partner',NULL,'stale-terms')$q$,'PT409'),'affiliate_apply conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_program_update('dddddddd-0000-4000-a000-000000000000',0,false,'x','{"en":"Terms","pl":"Warunki"}',30,2,'{"PLN":"1000"}')$q$,'PT409'),'affiliate_program_update conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_member_update('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000001',0,'approved','Test')$q$,'PT409'),'affiliate_member_update conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_rule_create('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000002',0,true,1000,NULL,NULL)$q$,'PT409'),'affiliate_rule_create conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_coupon_bind('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000005','af000000-0000-4000-a000-000000000001',0)$q$,'PT409'),'affiliate_coupon_bind conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000001','PLN',now(),0,1,'Test')$q$,'PT409'),'affiliate_reserve conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_mark_paid('dddddddd-0000-4000-a000-000000000000','00000000-0000-4000-a000-000000000000',0,'bank','invoice',1000,'PLN',now(),true)$q$,'PT409'),'affiliate_mark_paid conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_cancel_payout('dddddddd-0000-4000-a000-000000000000','00000000-0000-4000-a000-000000000000',0,true,'Test')$q$,'PT409'),'affiliate_cancel_payout conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_manual_adjustment('dddddddd-0000-4000-a000-000000000000','00000000-0000-4000-a000-000000000000',0,1,'Test','Test',false)$q$,'PT409'),'affiliate_manual_adjustment conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_work_retry('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000010',0,'Test')$q$,'PT409'),'affiliate_work_retry conflict SQLSTATE');
SELECT pg_temp.check_that(pg_temp.rejects($q$DELETE FROM public.products WHERE slug='affiliate-pln-course'$q$),'rule product retains history');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.affiliate_work WHERE payment_id='af000000-0000-4000-a000-000000000010'),'redemption enqueues payment');
DO $$ BEGIN FOR i IN 1..20 LOOP
 UPDATE public.payment_transactions SET refunded_amount=i WHERE id='af000000-0000-4000-a000-000000000010';
END LOOP; END $$;
SELECT pg_temp.check_that((SELECT requested_generation=21 FROM public.affiliate_work WHERE payment_id='af000000-0000-4000-a000-000000000010'),'twenty enqueues keep one row and generation');
UPDATE public.payment_transactions SET refunded_amount=0 WHERE id='af000000-0000-4000-a000-000000000010';
CREATE TEMP TABLE claimed AS SELECT * FROM public.affiliate_claim_work(100);
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true)
FROM claimed;
SELECT pg_temp.check_that((SELECT accrued_minor=2000 AND base_minor=10000 AND eligible_at IS NOT NULL FROM public.affiliate_commissions WHERE payment_id='af000000-0000-4000-a000-000000000010'),'canonical gross/net accrual');
SELECT pg_temp.check_that((SELECT eligible_at IS NULL FROM public.affiliate_commissions WHERE payment_id='af000000-0000-4000-a000-000000000012'),'unlimited refunds never mature');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='af000000-0000-4000-a000-000000000010' AND kind='accrual'),'one accrual per line');
CREATE TEMP TABLE reserved AS SELECT * FROM public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000001','PLN',now(),1,1,'demo-payee');
SELECT pg_temp.check_that((SELECT earnings_minor=2000 AND status='reserved' FROM reserved),'reserve full earnings');
SELECT pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.affiliate_ledger WHERE kind='settlement'),'reservation does not settle');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000001','PLN',now(),1,1,'demo-payee')$q$),'one open payout');
UPDATE public.payment_transactions SET refunded_amount=6150 WHERE id='af000000-0000-4000-a000-000000000010';
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000001','PLN',now(),1,1,'Test')$q$,'PT409'),'dirty sync conflict SQLSTATE');
TRUNCATE claimed;
INSERT INTO claimed SELECT * FROM public.affiliate_claim_work(100);
UPDATE public.payment_transactions SET refunded_amount=3075 WHERE id='af000000-0000-4000-a000-000000000010';
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true) FROM claimed;
SELECT pg_temp.check_that((SELECT status='pending' AND requested_generation>processed_generation FROM public.affiliate_work WHERE payment_id='af000000-0000-4000-a000-000000000010'),'enqueue during lease remains due');
SELECT pg_temp.check_that((SELECT sum(l.amount_minor)=1500 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='af000000-0000-4000-a000-000000000010'),'sync reads current refund');
TRUNCATE claimed;
INSERT INTO claimed SELECT * FROM public.affiliate_claim_work(100);
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true) FROM claimed;
UPDATE public.payment_transactions SET refunded_amount=6150 WHERE id='af000000-0000-4000-a000-000000000010';
TRUNCATE claimed;
INSERT INTO claimed SELECT * FROM public.affiliate_claim_work(100);
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true) FROM claimed;
SELECT pg_temp.check_that((SELECT sum(l.amount_minor)=1000 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='af000000-0000-4000-a000-000000000010'),'half gross refund reverses half commission');
SELECT pg_temp.check_that((SELECT needs_review AND status='reserved' FROM public.affiliate_payouts WHERE id=(SELECT id FROM reserved)),'refund keeps reviewed reservation');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.affiliate_payout_allocations WHERE payout_id=(SELECT id FROM reserved) AND released_at IS NULL),'refund retains allocations');
SELECT public.affiliate_mark_paid('dddddddd-0000-4000-a000-000000000000',id,version,'bank-demo-pln','invoice-demo-pln',2460,'PLN',now(),true,'Full reservation settled','bank-record') FROM public.affiliate_payouts WHERE id=(SELECT id FROM reserved);
SELECT public.affiliate_mark_paid('dddddddd-0000-4000-a000-000000000000',id,1,'bank-demo-pln','invoice-demo-pln',2460,'PLN',now(),true) FROM public.affiliate_payouts WHERE id=(SELECT id FROM reserved);
SELECT pg_temp.check_that((SELECT sum(l.amount_minor)=-1000 FROM public.affiliate_ledger l LEFT JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='af000000-0000-4000-a000-000000000010' OR l.payout_id=(SELECT id FROM reserved)),'old reservation paid after refund creates debt');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.affiliate_ledger WHERE payout_id=(SELECT id FROM reserved)),'paid retry keeps one settlement');
UPDATE public.payment_transactions SET status='disputed' WHERE id='af000000-0000-4000-a000-000000000010';
UPDATE public.payment_transactions SET status='completed',refunded_amount=0 WHERE id='af000000-0000-4000-a000-000000000010';
TRUNCATE claimed;
INSERT INTO claimed SELECT * FROM public.affiliate_claim_work(100);
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true) FROM claimed;
SELECT pg_temp.check_that((SELECT sum(l.amount_minor)=0 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='af000000-0000-4000-a000-000000000010'),'dispute before drain remains latched');
SELECT pg_temp.check_that(pg_temp.rejects($q$UPDATE public.affiliate_commissions SET base_minor=1$q$),'commission money remains immutable');
SELECT pg_temp.check_that(NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'affiliate_%' AND column_name IN ('customer_email','buyer_email','buyer_id','metadata')),'explicit snapshots');
SELECT public.affiliate_manual_adjustment('dddddddd-0000-4000-a000-000000000000',id,version,2000,'Dispute reviewed','case-demo',true)
FROM public.affiliate_commissions WHERE payment_id='af000000-0000-4000-a000-000000000010';
SELECT pg_temp.check_that((SELECT dispute_seen AND dispute_reviewed_at IS NOT NULL FROM public.affiliate_commissions WHERE payment_id='af000000-0000-4000-a000-000000000010'),'manual review preserves dispute latch');
CREATE TEMP TABLE euro AS SELECT * FROM public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000001','EUR',now(),1,1,'demo-eur');
SELECT public.affiliate_cancel_payout('dddddddd-0000-4000-a000-000000000000',id,version,true,'No transfer') FROM euro;
SELECT pg_temp.check_that((SELECT bool_and(released_at IS NOT NULL) FROM public.affiliate_payout_allocations WHERE payout_id=(SELECT id FROM euro)),'cancel releases allocations');
SELECT public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000001','EUR',now(),1,1,'demo-eur');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_program_update('bbbbbbbb-0000-4000-a000-000000000000',1,false,'x','{"en":"Terms","pl":"Warunki"}',30,2,'{"PLN":"1000"}')$q$),'member cannot update program');
CREATE FUNCTION pg_temp.audit_unavailable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.table_name='affiliate_programs' THEN RAISE EXCEPTION 'Audit unavailable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER affiliate_test_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_unavailable();
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_program_update('dddddddd-0000-4000-a000-000000000000',1,false,'x','{"en":"Terms","pl":"Warunki"}',30,2,'{"PLN":"1000"}')$q$),'audit failure rolls mutation back');
SELECT pg_temp.check_that((SELECT version=1 AND enabled FROM public.affiliate_programs),'audit failure preserves original version');
DROP TRIGGER affiliate_test_audit ON public.audit_log;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'affiliate_%' LOOP
  PERFORM pg_temp.check_that(NOT has_function_privilege('anon',f.signature,'EXECUTE') AND NOT has_function_privilege('authenticated',f.signature,'EXECUTE'),'service-only '||f.signature);
 END LOOP;
END $$;
UPDATE public.payment_transactions SET refunded_amount=1 WHERE id='af000000-0000-4000-a000-000000000011';
TRUNCATE claimed;
INSERT INTO claimed SELECT * FROM public.affiliate_claim_work(100);
UPDATE public.affiliate_work SET leased_until=now()-interval '1 second' WHERE payment_id='af000000-0000-4000-a000-000000000011';
CREATE TEMP TABLE recovered AS SELECT * FROM public.affiliate_claim_work(100);
SELECT pg_temp.check_that(NOT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true),'old lease cannot finish') FROM claimed;
SELECT pg_temp.check_that((SELECT r.lease_token<>c.lease_token FROM recovered r JOIN claimed c USING(payment_id)),'expired lease receives a new token');
SELECT pg_temp.check_that(public.affiliate_retry_work(payment_id,lease_token,requested_generation,'temporary_failure'),'retry releases current lease') FROM recovered;
SELECT pg_temp.check_that((SELECT status='pending' AND next_attempt_at>now() FROM public.affiliate_work WHERE payment_id='af000000-0000-4000-a000-000000000011'),'retry remains durable');
SELECT pg_temp.check_that(pg_temp.rejects($q$DELETE FROM public.affiliate_work WHERE payment_id='af000000-0000-4000-a000-000000000011'$q$),'unfinished work cannot be deleted');
INSERT INTO public.affiliate_rules(product_id,revision,enabled,percentage_bps,created_at)
VALUES('af000000-0000-4000-a000-000000000002',2,false,1000,'2026-01-03 00:00:00+00');
INSERT INTO public.affiliate_memberships(id,user_id,code,status,display_name,accepted_terms_version,accepted_at)
VALUES('af000000-0000-4000-a000-000000000020','dddddddd-0000-4000-a000-000000000000','second-partner','approved','Second Partner','demo-v1',now());
SELECT public.affiliate_coupon_bind('dddddddd-0000-4000-a000-000000000000','af000000-0000-4000-a000-000000000005','af000000-0000-4000-a000-000000000020',1);
INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id,fulfillment_pending)
VALUES('af000000-0000-4000-a000-000000000030','af000000-0000-4000-a000-000000000002','buyer@demo.sellf.app',12300,'PLN','completed','cs_affiliate_self_test',true),
 ('af000000-0000-4000-a000-000000000031','af000000-0000-4000-a000-000000000002','other@example.com',12300,'PLN','completed','cs_affiliate_disabled_test',false);
INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id)
SELECT 'af000000-0000-4000-a000-000000000032',id,'other@example.com',12300,'PLN','completed','cs_affiliate_subscription_test' FROM public.products WHERE slug='pro-membership-monthly';
INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency,net_amount)
SELECT id,product_id,'main_product',1,123,123,currency,10000 FROM public.payment_transactions WHERE id IN
 ('af000000-0000-4000-a000-000000000030','af000000-0000-4000-a000-000000000031','af000000-0000-4000-a000-000000000032');
INSERT INTO public.coupon_redemptions(coupon_id,transaction_id,customer_email,discount_amount)
SELECT 'af000000-0000-4000-a000-000000000005',id,customer_email,10 FROM public.payment_transactions WHERE id IN
 ('af000000-0000-4000-a000-000000000030','af000000-0000-4000-a000-000000000031','af000000-0000-4000-a000-000000000032');
TRUNCATE claimed;
INSERT INTO claimed SELECT * FROM public.affiliate_claim_work(100);
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-04 00:00:00+00',false) FROM claimed WHERE payment_id='af000000-0000-4000-a000-000000000031';
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true) FROM claimed WHERE payment_id<>'af000000-0000-4000-a000-000000000031';
SELECT pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id IN ('af000000-0000-4000-a000-000000000031','af000000-0000-4000-a000-000000000032')),'disabled revision and subscription give zero commissions');
SELECT pg_temp.check_that((SELECT status='pending' AND processed_generation=0 FROM public.affiliate_work WHERE payment_id='af000000-0000-4000-a000-000000000030'),'fulfillment waits durably');
UPDATE public.payment_transactions SET fulfillment_pending=false WHERE id='af000000-0000-4000-a000-000000000030';
TRUNCATE claimed;
INSERT INTO claimed SELECT * FROM public.affiliate_claim_work(100);
SELECT public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02 00:00:00+00',true) FROM claimed;
SELECT pg_temp.check_that((SELECT self_referral AND accrued_minor=0 AND member_id='af000000-0000-4000-a000-000000000001' FROM public.affiliate_commissions WHERE payment_id='af000000-0000-4000-a000-000000000030'),'historical binding and final self referral');
SELECT pg_temp.check_that((SELECT bool_and(metadata='{}'::jsonb) FROM public.payment_transactions WHERE session_id LIKE 'cs_affiliate_%'),'payment metadata remains unchanged');
SELECT pg_temp.check_that(pg_temp.rejects('SELECT public.affiliate_claim_work(NULL)'),'claim limit is bounded');
SELECT pg_temp.check_that(pg_temp.rejects($q$SELECT public.affiliate_program_update('dddddddd-0000-4000-a000-000000000000',NULL,false,'x','{"en":"Terms","pl":"Warunki"}',30,2,'{"PLN":"1000"}')$q$,'PT409'),'program requires expected version');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
