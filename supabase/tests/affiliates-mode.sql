-- Mode-specific payout accounting. Run on the disposable seeded project.
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE member uuid := 'af000000-0000-4000-a000-000000000001'; sample public.affiliate_commissions; p public.affiliate_payouts; totals record; portal jsonb;
BEGIN
 SELECT * INTO sample FROM public.affiliate_commissions WHERE payment_id='af000000-0000-4000-a000-000000000010' AND livemode;
 IF NOT EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=sample.payment_id AND NOT livemode) THEN
 INSERT INTO public.affiliate_commissions(id,payment_id,line_item_id,member_id,rule_id,binding_id,livemode,session_created_at,paid_at,currency,base_minor,accrued_minor,self_referral,is_refundable,refund_period_days,hold_days,buffer_days,eligible_at,observed_refunded_gross,observed_status)
 VALUES(gen_random_uuid(),sample.payment_id,sample.line_item_id,sample.member_id,sample.rule_id,sample.binding_id,false,sample.session_created_at,sample.paid_at,sample.currency,sample.base_minor,1234,false,sample.is_refundable,sample.refund_period_days,sample.hold_days,sample.buffer_days,sample.eligible_at,sample.observed_refunded_gross,sample.observed_status) RETURNING * INTO sample;
 INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
 VALUES(member,sample.id,'accrual',1234,'PLN','mode-sample:'||sample.id);
 END IF;
 SELECT * INTO totals FROM public.affiliate_preview(member,'PLN',now(),p_livemode=>false);
 ASSERT totals.payable_minor='1234', 'Test mode includes test earnings';
 SELECT * INTO totals FROM public.affiliate_preview(member,'PLN',now(),p_livemode=>true);
 ASSERT totals.payable_minor='2000', 'Live mode excludes test earnings';
 portal := public.affiliate_portal_summary(member,now(),p_livemode=>false);
 ASSERT (SELECT value->>'eligible' FROM jsonb_array_elements(portal->'balances') WHERE value->>'currency'='PLN')='1234', 'Test portal matches preview';
 portal := public.affiliate_portal_summary(member,now(),p_livemode=>true);
 ASSERT (SELECT value->>'eligible' FROM jsonb_array_elements(portal->'balances') WHERE value->>'currency'='PLN')='2000', 'Live portal excludes test earnings';
 SELECT * INTO p FROM public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000',member,'PLN',now(),1,1,'Test partner',p_livemode=>false);
 ASSERT p.earnings_minor=1234 AND NOT p.livemode, 'Test reservation uses test earnings';
 SELECT * INTO totals FROM public.affiliate_preview(member,'PLN',now(),p_livemode=>true);
 ASSERT totals.available, 'Test reservation leaves live availability unchanged';
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 ASSERT NOT EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE a.payout_id=p.id AND c.livemode), 'Test reservation contains only test entries';
 PERFORM public.affiliate_mark_paid('dddddddd-0000-4000-a000-000000000000',p.id,1,'mode-test-bank','mode-test-invoice',1234,'PLN',now(),true,p_livemode=>false);
 SELECT * INTO totals FROM public.affiliate_preview(member,'PLN',now(),p_livemode=>true);
 ASSERT totals.paid='0' AND totals.balance='4000' AND totals.payable_minor='2000', 'Test settlement leaves live balances unchanged';
 SELECT * INTO totals FROM public.affiliate_preview(member,'PLN',now(),p_livemode=>false);
 ASSERT totals.paid='1234' AND totals.payable_minor='0', 'Test settlement updates test balances';
 SELECT * INTO p FROM public.affiliate_reserve('dddddddd-0000-4000-a000-000000000000',member,'PLN',now(),1,1,'Live partner',p_livemode=>true);
 ASSERT p.earnings_minor=2000 AND p.livemode, 'Live reservation excludes test earnings';
 ASSERT NOT EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE a.payout_id=p.id AND NOT c.livemode), 'Live reservation contains only live entries';
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
