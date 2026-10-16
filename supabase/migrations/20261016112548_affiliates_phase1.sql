-- Phase 1 affiliate accounting and work queue.
-- Related: supabase/tests/affiliates-phase1.sql

CREATE TABLE public.affiliate_programs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 hold_days integer NOT NULL DEFAULT 30 CHECK(hold_days BETWEEN 0 AND 3650),
 buffer_days integer NOT NULL DEFAULT 2 CHECK(buffer_days BETWEEN 0 AND 365),
 terms_version text NOT NULL, terms jsonb NOT NULL CHECK(jsonb_typeof(terms)='object'),
 thresholds jsonb NOT NULL DEFAULT '{"PLN":"10000"}' CHECK(jsonb_typeof(thresholds)='object')
);
CREATE TABLE public.affiliate_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
 code text NOT NULL UNIQUE CHECK(code ~ '^[a-z0-9_-]{3,40}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended','terminated')),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120), channel text CHECK(length(channel)<=500),
 accepted_terms_version text NOT NULL, accepted_at timestamptz NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.affiliate_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0), enabled boolean NOT NULL,
 percentage_bps integer CHECK(percentage_bps BETWEEN 0 AND 10000), fixed_minor bigint CHECK(fixed_minor>=0),
 currency text CHECK(currency ~ '^[A-Z]{3}$'), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(product_id,revision),
 CHECK((percentage_bps IS NOT NULL AND fixed_minor IS NULL AND currency IS NULL)
 OR (percentage_bps IS NULL AND fixed_minor IS NOT NULL AND currency IS NOT NULL))
);
CREATE TABLE public.affiliate_coupon_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id), version bigint NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), retired_at timestamptz, UNIQUE(coupon_id,version),
 CHECK(retired_at IS NULL OR retired_at>=created_at)
);
CREATE UNIQUE INDEX affiliate_coupon_owner ON public.affiliate_coupon_bindings(coupon_id) WHERE retired_at IS NULL;
CREATE TABLE public.affiliate_commissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
 line_item_id uuid NOT NULL REFERENCES public.payment_line_items(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id), rule_id uuid NOT NULL REFERENCES public.affiliate_rules(id),
 binding_id uuid NOT NULL REFERENCES public.affiliate_coupon_bindings(id), livemode boolean NOT NULL,
 session_created_at timestamptz NOT NULL, paid_at timestamptz NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 base_minor bigint NOT NULL CHECK(base_minor>=0), accrued_minor bigint NOT NULL CHECK(accrued_minor BETWEEN 0 AND base_minor),
 self_referral boolean NOT NULL, is_refundable boolean NOT NULL,
 refund_period_days integer CHECK(refund_period_days BETWEEN 1 AND 365),
 hold_days integer NOT NULL CHECK(hold_days BETWEEN 0 AND 3650), buffer_days integer NOT NULL CHECK(buffer_days BETWEEN 0 AND 365),
 eligible_at timestamptz, observed_refunded_gross bigint NOT NULL CHECK(observed_refunded_gross>=0), observed_status text NOT NULL,
 dispute_seen boolean NOT NULL DEFAULT false, dispute_reviewed_at timestamptz, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(payment_id,line_item_id,livemode), CHECK(NOT self_referral OR accrued_minor=0),
 CHECK(NOT(is_refundable AND refund_period_days IS NULL) OR eligible_at IS NULL)
);
CREATE TABLE public.affiliate_payouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), earnings_minor bigint NOT NULL CHECK(earnings_minor>0),
 status text NOT NULL CHECK(status IN ('reserved','paid','cancelled')), needs_review boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), cutoff timestamptz NOT NULL,
 payee_reference text NOT NULL, bank_reference text UNIQUE, invoice_reference text,
 bank_amount_minor bigint CHECK(bank_amount_minor>0), paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'paid' OR (bank_reference IS NOT NULL AND invoice_reference IS NOT NULL AND bank_amount_minor IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE UNIQUE INDEX affiliate_one_open_payout ON public.affiliate_payouts(member_id,currency) WHERE status='reserved';
CREATE TABLE public.affiliate_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id),
 commission_id uuid REFERENCES public.affiliate_commissions(id), payout_id uuid UNIQUE REFERENCES public.affiliate_payouts(id),
 kind text NOT NULL CHECK(kind IN ('accrual','reversal','restoration','settlement','manual_adjustment')),
 amount_minor bigint NOT NULL CHECK(amount_minor<>0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 economic_key text NOT NULL UNIQUE, reason text, evidence_reference text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='settlement' AND amount_minor<0 AND payout_id IS NOT NULL AND commission_id IS NULL)
 OR (kind IN ('accrual','reversal','restoration') AND commission_id IS NOT NULL AND payout_id IS NULL)
 OR (kind='manual_adjustment' AND commission_id IS NOT NULL AND payout_id IS NULL AND reason IS NOT NULL AND evidence_reference IS NOT NULL)),
 CHECK(kind NOT IN ('accrual','restoration') OR amount_minor>0), CHECK(kind<>'reversal' OR amount_minor<0)
);
CREATE UNIQUE INDEX affiliate_one_accrual ON public.affiliate_ledger(commission_id) WHERE kind='accrual';
CREATE TABLE public.affiliate_payout_allocations (
 payout_id uuid NOT NULL REFERENCES public.affiliate_payouts(id), entry_id uuid NOT NULL REFERENCES public.affiliate_ledger(id),
 released_at timestamptz, PRIMARY KEY(payout_id,entry_id)
);
CREATE UNIQUE INDEX affiliate_one_allocation ON public.affiliate_payout_allocations(entry_id) WHERE released_at IS NULL;
CREATE TABLE public.affiliate_work (
 payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'sync' CHECK(kind='sync'), requested_generation bigint NOT NULL DEFAULT 1,
 processed_generation bigint NOT NULL DEFAULT 0, dispute_seen boolean NOT NULL DEFAULT false,
 status text NOT NULL CHECK(status IN ('pending','leased','done','needs_review')), attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), leased_until timestamptz, lease_token uuid, last_error_code text,
 CHECK(processed_generation>=0 AND requested_generation>=processed_generation), CHECK(attempts>=0)
);
CREATE INDEX affiliate_maturity ON public.affiliate_commissions(member_id,currency,eligible_at,id);
CREATE INDEX affiliate_ledger_balance ON public.affiliate_ledger(member_id,currency,created_at,id);
CREATE INDEX affiliate_work_due ON public.affiliate_work(next_attempt_at,payment_id) WHERE status IN ('pending','leased');

CREATE INDEX affiliate_binding_member ON public.affiliate_coupon_bindings(member_id);
CREATE INDEX affiliate_commission_line ON public.affiliate_commissions(line_item_id);
CREATE INDEX affiliate_commission_rule ON public.affiliate_commissions(rule_id);
CREATE INDEX affiliate_commission_binding ON public.affiliate_commissions(binding_id);
CREATE INDEX affiliate_payout_member ON public.affiliate_payouts(member_id,currency);
CREATE INDEX affiliate_ledger_commission ON public.affiliate_ledger(commission_id);
CREATE INDEX affiliate_allocation_entry ON public.affiliate_payout_allocations(entry_id);
CREATE INDEX affiliate_history ON public.audit_log(table_name,performed_at,id) WHERE table_name LIKE 'affiliate_%';

CREATE FUNCTION public.affiliate_valid_reference(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT p_value IS NOT NULL AND length(btrim(p_value)) BETWEEN 1 AND 200 AND p_value !~ E'[\r\n]';
$$;
CREATE FUNCTION public.affiliate_valid_program(p_terms jsonb,p_thresholds jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
 IF octet_length(p_terms::text)>32768 OR octet_length(p_thresholds::text)>32768
 OR jsonb_typeof(p_terms)<>'object' OR jsonb_typeof(p_thresholds)<>'object'
 OR NOT (p_terms ?& ARRAY['en','pl']) OR (p_terms - ARRAY['en','pl'])<>'{}'::jsonb
 OR jsonb_typeof(p_terms->'en')<>'string' OR jsonb_typeof(p_terms->'pl')<>'string'
 OR length(btrim(p_terms->>'en'))=0 OR length(btrim(p_terms->>'pl'))=0 THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_each(p_thresholds) t
 WHERE t.key !~ '^[A-Z]{3}$' OR jsonb_typeof(t.value)<>'string' OR t.value#>>'{}' !~ '^[1-9][0-9]{0,18}$'
 OR (t.value#>>'{}')::numeric>9223372036854775807);
END $$;
ALTER TABLE public.affiliate_programs ADD CHECK(public.affiliate_valid_program(terms,thresholds)),
 ADD CHECK(public.affiliate_valid_reference(terms_version));
ALTER TABLE public.affiliate_commissions ADD CHECK(eligible_at IS NULL OR eligible_at>=paid_at+greatest(hold_days,
 CASE WHEN is_refundable THEN refund_period_days+buffer_days ELSE 0 END)*interval '1 day');
ALTER TABLE public.affiliate_memberships ADD CHECK(public.affiliate_valid_reference(accepted_terms_version));
ALTER TABLE public.affiliate_payouts ADD CHECK(public.affiliate_valid_reference(payee_reference)),
 ADD CHECK(bank_reference IS NULL OR public.affiliate_valid_reference(bank_reference)),
 ADD CHECK(invoice_reference IS NULL OR public.affiliate_valid_reference(invoice_reference));
ALTER TABLE public.affiliate_ledger ADD CHECK(length(economic_key) BETWEEN 1 AND 200),
 ADD CHECK(reason IS NULL OR public.affiliate_valid_reference(reason)),
 ADD CHECK(evidence_reference IS NULL OR public.affiliate_valid_reference(evidence_reference));
ALTER TABLE public.affiliate_work ADD CHECK(last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,80}$'),
 ADD CHECK((status='leased')=(lease_token IS NOT NULL AND leased_until IS NOT NULL)),
 ADD CHECK(requested_generation>0 AND (status<>'done' OR requested_generation=processed_generation));

CREATE FUNCTION public.affiliate_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_actor IS NULL
 OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_actor)
 OR NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN
 RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.affiliate_audit(p_table text,p_old jsonb,p_new jsonb,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO public.audit_log(table_name,operation,old_values,new_values,performed_by)
 VALUES(p_table,CASE WHEN p_old IS NULL THEN 'INSERT' ELSE 'UPDATE' END,p_old,p_new,p_actor);
END $$;
CREATE FUNCTION public.affiliate_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Append only record' USING ERRCODE='23514'; END $$;
CREATE FUNCTION public.affiliate_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_TABLE_NAME='affiliate_coupon_bindings' THEN
  IF (to_jsonb(NEW)-'retired_at')<>(to_jsonb(OLD)-'retired_at') OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL THEN
   RAISE EXCEPTION 'Binding already fixed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_commissions' THEN
  IF (to_jsonb(NEW)-ARRAY['observed_refunded_gross','observed_status','dispute_seen','dispute_reviewed_at','hold_days','eligible_at','version'])
   <>(to_jsonb(OLD)-ARRAY['observed_refunded_gross','observed_status','dispute_seen','dispute_reviewed_at','hold_days','eligible_at','version'])
   OR NEW.hold_days<OLD.hold_days OR (OLD.dispute_seen AND NOT NEW.dispute_seen)
   OR (OLD.eligible_at IS NULL AND NEW.eligible_at IS NOT NULL)
   OR NEW.eligible_at<OLD.eligible_at OR (OLD.dispute_reviewed_at IS NOT NULL AND NEW.dispute_reviewed_at IS NULL) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Commission snapshot fixed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_work' THEN
  IF OLD.status<>'done' OR OLD.requested_generation<>OLD.processed_generation OR OLD.dispute_seen THEN
   RAISE EXCEPTION 'Work remains due' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_payout_allocations' THEN
  IF NEW.payout_id<>OLD.payout_id OR NEW.entry_id<>OLD.entry_id OR OLD.released_at IS NOT NULL
   OR NEW.released_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.affiliate_payouts WHERE id=NEW.payout_id AND status='cancelled') THEN
   RAISE EXCEPTION 'Allocation remains reserved' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_payouts' THEN
  IF OLD.status<>'reserved' OR (to_jsonb(NEW)-ARRAY['status','needs_review','version','bank_reference','invoice_reference','bank_amount_minor','paid_at'])
   <>(to_jsonb(OLD)-ARRAY['status','needs_review','version','bank_reference','invoice_reference','bank_amount_minor','paid_at']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Payout fixed' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION public.affiliate_binding_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.coupons WHERE id=NEW.coupon_id FOR UPDATE;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.affiliate_memberships WHERE id=NEW.member_id AND status='approved' AND user_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Approved member required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_coupon_bindings b WHERE b.coupon_id=NEW.coupon_id AND b.id<>NEW.id
  AND tstzrange(b.created_at,b.retired_at,'[)') && tstzrange(NEW.created_at,NEW.retired_at,'[)')) THEN
  RAISE EXCEPTION 'Binding periods overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.affiliate_check_relations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; p public.affiliate_payouts; l public.affiliate_ledger; total numeric;
BEGIN
 IF TG_TABLE_NAME='affiliate_commissions' THEN
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.id;
  IF NOT EXISTS(SELECT 1 FROM public.payment_line_items li JOIN public.affiliate_rules r ON r.id=c.rule_id
   JOIN public.affiliate_coupon_bindings b ON b.id=c.binding_id
   JOIN public.payment_transactions pt ON pt.id=c.payment_id
   WHERE li.id=c.line_item_id AND li.transaction_id=c.payment_id AND li.product_id=r.product_id
    AND upper(li.currency)=c.currency AND upper(pt.currency)=c.currency AND b.member_id=c.member_id) THEN
   RAISE EXCEPTION 'Commission references differ' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_ledger' THEN
  SELECT * INTO l FROM public.affiliate_ledger WHERE id=NEW.id;
  IF l.commission_id IS NOT NULL THEN
   SELECT * INTO c FROM public.affiliate_commissions WHERE id=l.commission_id;
   IF l.member_id<>c.member_id OR l.currency<>c.currency OR (l.kind='accrual' AND l.amount_minor<>c.accrued_minor) THEN RAISE EXCEPTION 'Entry references differ' USING ERRCODE='23514'; END IF;
   SELECT coalesce(sum(amount_minor),0) INTO total FROM public.affiliate_ledger WHERE commission_id=c.id AND kind<>'manual_adjustment';
   IF total<0 OR total>c.accrued_minor THEN RAISE EXCEPTION 'Automatic total outside commission' USING ERRCODE='23514'; END IF;
   IF c.dispute_seen AND (SELECT coalesce(sum(amount_minor),0) FROM public.affiliate_ledger WHERE commission_id=c.id AND kind='manual_adjustment')>c.accrued_minor THEN
    RAISE EXCEPTION 'Adjustment outside commission' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO p FROM public.affiliate_payouts WHERE id=l.payout_id;
   IF l.member_id<>p.member_id OR l.currency<>p.currency OR l.amount_minor<>-p.earnings_minor OR p.status<>'paid' THEN
    RAISE EXCEPTION 'Settlement differs' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='affiliate_payouts' THEN
  SELECT * INTO p FROM public.affiliate_payouts WHERE id=NEW.id;
 ELSE
  SELECT * INTO p FROM public.affiliate_payouts WHERE id=NEW.payout_id;
 END IF;
 IF p.id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger e ON e.id=a.entry_id
    WHERE a.payout_id=p.id AND (e.member_id<>p.member_id OR e.currency<>p.currency OR e.kind='settlement'))
   OR (SELECT coalesce(sum(e.amount_minor),0) FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger e ON e.id=a.entry_id
    WHERE a.payout_id=p.id AND a.released_at IS NULL)<>(CASE WHEN p.status='cancelled' THEN 0 ELSE p.earnings_minor END)
   OR (p.status='paid' AND NOT EXISTS(SELECT 1 FROM public.affiliate_ledger WHERE payout_id=p.id)) THEN
   RAISE EXCEPTION 'Payout allocation differs' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.affiliate_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid; disputed boolean;
BEGIN
 IF TG_TABLE_NAME='coupon_redemptions' THEN
  pid:=NEW.transaction_id;
 ELSE
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.refunded_amount IS NOT DISTINCT FROM OLD.refunded_amount
    AND NEW.fulfillment_pending IS NOT DISTINCT FROM OLD.fulfillment_pending THEN RETURN NEW; END IF;
  pid:=NEW.id;
  IF NOT EXISTS(SELECT 1 FROM public.coupon_redemptions WHERE transaction_id=pid)
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=pid) THEN RETURN NEW; END IF;
 END IF;
 IF pid IS NULL THEN RETURN NEW; END IF;
 SELECT status='disputed' INTO disputed FROM public.payment_transactions WHERE id=pid;
 INSERT INTO public.affiliate_work(payment_id,status,dispute_seen) VALUES(pid,'pending',disputed)
 ON CONFLICT(payment_id) DO UPDATE SET requested_generation=public.affiliate_work.requested_generation+1,
  dispute_seen=public.affiliate_work.dispute_seen OR excluded.dispute_seen,
  status=CASE WHEN public.affiliate_work.status='leased' THEN 'leased' ELSE 'pending' END,next_attempt_at=now();
 UPDATE public.affiliate_payouts p SET needs_review=true,version=version+1
 WHERE p.status='reserved' AND NOT p.needs_review AND EXISTS(
  SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id
  JOIN public.affiliate_commissions c ON c.id=l.commission_id
  WHERE a.payout_id=p.id AND c.payment_id=pid AND a.released_at IS NULL);
 RETURN NEW;
END $$;

CREATE FUNCTION public.affiliate_claim_work(p_limit integer DEFAULT 25) RETURNS SETOF public.affiliate_work
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH due AS (
 SELECT payment_id FROM public.affiliate_work WHERE
 (status='pending' AND next_attempt_at<=now()) OR (status='leased' AND leased_until<=now())
 ORDER BY next_attempt_at,payment_id FOR UPDATE SKIP LOCKED LIMIT p_limit)
 UPDATE public.affiliate_work w SET status='leased',lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes',attempts=attempts+1
 FROM due WHERE w.payment_id=due.payment_id RETURNING w.*;
END $$;
CREATE FUNCTION public.affiliate_retry_work(p_payment uuid,p_token uuid,p_generation bigint,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.affiliate_work SET status=CASE WHEN attempts>=10 THEN 'needs_review' ELSE 'pending' END,
 next_attempt_at=now()+least(3600,60*power(2,least(attempts-1,6))) * interval '1 second',
 lease_token=NULL,leased_until=NULL,last_error_code=p_error
 WHERE payment_id=p_payment AND lease_token=p_token AND status='leased' AND leased_until>now()
 AND p_generation<=requested_generation AND p_generation>processed_generation;
 RETURN FOUND;
END $$;

CREATE FUNCTION public.affiliate_apply_sync(p_payment uuid,p_token uuid,p_generation bigint,p_session_created_at timestamptz,p_livemode boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pt public.payment_transactions; w public.affiliate_work; b public.affiliate_coupon_bindings;
 m public.affiliate_memberships; prog public.affiliate_programs; rule public.affiliate_rules;
 c public.affiliate_commissions; li record; red public.coupon_redemptions; history jsonb;
 base bigint; earned bigint; target bigint; automatic numeric; loss bigint; delta bigint;
 self_match boolean; mature timestamptz; waiting boolean:=false; blocked boolean:=false;
BEGIN
 SELECT * INTO pt FROM public.payment_transactions WHERE id=p_payment FOR UPDATE;
 SELECT * INTO w FROM public.affiliate_work WHERE payment_id=p_payment FOR UPDATE;
 IF w.payment_id IS NULL OR p_token IS NULL OR p_generation IS NULL OR w.status<>'leased' OR w.lease_token IS DISTINCT FROM p_token OR w.leased_until<=now()
  OR p_generation>w.requested_generation OR p_generation<=w.processed_generation THEN RETURN false; END IF;
 IF p_session_created_at IS NULL OR p_session_created_at>now() OR p_livemode IS NULL THEN
  RAISE EXCEPTION 'Session required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment
  AND (session_created_at<>p_session_created_at OR livemode<>p_livemode)) THEN
  RAISE EXCEPTION 'Session differs' USING ERRCODE='23514'; END IF;
 SELECT * INTO red FROM public.coupon_redemptions WHERE transaction_id=p_payment ORDER BY redeemed_at,id LIMIT 1;
 IF red.id IS NOT NULL THEN
  SELECT * INTO b FROM public.affiliate_coupon_bindings WHERE coupon_id=red.coupon_id
   AND created_at<=p_session_created_at AND (retired_at IS NULL OR retired_at>p_session_created_at) ORDER BY version DESC LIMIT 1;
 END IF;
 IF b.id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(b.member_id::text||upper(pt.currency),0));
  SELECT a.new_values INTO history FROM public.audit_log a WHERE a.table_name='affiliate_programs'
    AND a.performed_at<=p_session_created_at ORDER BY a.performed_at DESC,(a.new_values->>'version')::bigint DESC,a.id DESC LIMIT 1;
  prog:=jsonb_populate_record(NULL::public.affiliate_programs,history);
  SELECT a.new_values INTO history FROM public.audit_log a WHERE a.table_name='affiliate_memberships'
    AND a.new_values->>'id'=b.member_id::text AND a.performed_at<=p_session_created_at ORDER BY a.performed_at DESC,(a.new_values->>'version')::bigint DESC,a.id DESC LIMIT 1;
  m:=jsonb_populate_record(NULL::public.affiliate_memberships,history);
 END IF;
 IF pt.amount<>trunc(pt.amount) OR coalesce(pt.refunded_amount,0)<>trunc(coalesce(pt.refunded_amount,0)) THEN
  RAISE EXCEPTION 'Integer amounts required' USING ERRCODE='23514'; END IF;
 -- Existing corrections remain processable while new lines await fulfillment.
 FOR c IN SELECT * FROM public.affiliate_commissions WHERE payment_id=p_payment ORDER BY member_id,currency,id FOR UPDATE LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(c.member_id::text||c.currency,0));
  blocked:=c.dispute_seen OR w.dispute_seen OR pt.status='disputed';
  loss:=CASE WHEN c.base_minor=0 THEN 0 ELSE round(c.base_minor::numeric*least(pt.amount,greatest(0,coalesce(pt.refunded_amount,0)))/pt.amount)::bigint END;
  target:=CASE WHEN blocked OR c.base_minor=0 THEN 0 ELSE greatest(0,c.accrued_minor-round(c.accrued_minor::numeric*loss/c.base_minor)::bigint) END;
  SELECT coalesce(sum(amount_minor),0) INTO automatic FROM public.affiliate_ledger WHERE commission_id=c.id AND kind<>'manual_adjustment';
  delta:=target-automatic;
  IF delta<>0 THEN
   INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
    VALUES(c.member_id,c.id,CASE WHEN delta>0 THEN 'restoration' ELSE 'reversal' END,delta,c.currency,'sync:'||c.id||':'||p_generation);
  END IF;
  UPDATE public.affiliate_commissions SET observed_refunded_gross=coalesce(pt.refunded_amount,0)::bigint,observed_status=pt.status,
   dispute_seen=blocked,version=version+1 WHERE id=c.id;
  PERFORM public.affiliate_audit('affiliate_commissions',to_jsonb(c),(SELECT to_jsonb(updated) FROM public.affiliate_commissions updated WHERE id=c.id),NULL);
 END LOOP;
 IF b.id IS NOT NULL AND prog.enabled AND m.status='approved' AND pt.status IN ('completed','refunded','disputed') THEN
  SELECT EXISTS(SELECT 1 FROM public.affiliate_memberships am JOIN auth.users u ON u.id=am.user_id
   WHERE am.id=b.member_id AND (u.id=pt.user_id OR lower(btrim(u.email))=lower(btrim(pt.customer_email)))) INTO self_match;
  waiting:=pt.fulfillment_pending OR NOT EXISTS(SELECT 1 FROM public.payment_line_items WHERE transaction_id=p_payment)
   OR EXISTS(SELECT 1 FROM public.payment_line_items WHERE transaction_id=p_payment AND net_amount IS NULL);
  IF NOT waiting THEN
   FOR li IN SELECT l.*,p.is_refundable,p.refund_period_days,p.product_type FROM public.payment_line_items l
    JOIN public.products p ON p.id=l.product_id WHERE l.transaction_id=p_payment ORDER BY l.id LOOP
    IF li.product_type<>'one_time' THEN CONTINUE; END IF;
    SELECT * INTO rule FROM public.affiliate_rules WHERE product_id=li.product_id AND created_at<=p_session_created_at
     ORDER BY created_at DESC,revision DESC LIMIT 1;
    IF rule.id IS NULL OR NOT rule.enabled OR (rule.currency IS NOT NULL AND rule.currency<>upper(li.currency)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment AND line_item_id=li.id AND livemode=p_livemode) THEN CONTINUE; END IF;
    base:=li.net_amount;
    earned:=CASE WHEN self_match THEN 0 WHEN rule.percentage_bps IS NOT NULL THEN round(base::numeric*rule.percentage_bps/10000)::bigint ELSE least(base,rule.fixed_minor) END;
    mature:=CASE WHEN li.is_refundable AND li.refund_period_days IS NULL THEN NULL ELSE
     red.redeemed_at+greatest(prog.hold_days,CASE WHEN li.is_refundable THEN li.refund_period_days+prog.buffer_days ELSE 0 END)*interval '1 day' END;
    INSERT INTO public.affiliate_commissions(payment_id,line_item_id,member_id,rule_id,binding_id,livemode,session_created_at,paid_at,
     currency,base_minor,accrued_minor,self_referral,is_refundable,refund_period_days,hold_days,buffer_days,eligible_at,observed_refunded_gross,observed_status,dispute_seen)
    VALUES(p_payment,li.id,b.member_id,rule.id,b.id,p_livemode,p_session_created_at,red.redeemed_at,upper(li.currency),base,earned,self_match,
     li.is_refundable,li.refund_period_days,prog.hold_days,prog.buffer_days,mature,coalesce(pt.refunded_amount,0)::bigint,pt.status,w.dispute_seen OR pt.status='disputed') RETURNING * INTO c;
    PERFORM public.affiliate_audit('affiliate_commissions',NULL,to_jsonb(c),NULL);
    IF earned>0 THEN
     INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
     VALUES(c.member_id,c.id,'accrual',earned,c.currency,'accrual:'||c.id);
     loss:=CASE WHEN base=0 THEN 0 ELSE round(base::numeric*least(pt.amount,greatest(0,coalesce(pt.refunded_amount,0)))/pt.amount)::bigint END;
     target:=CASE WHEN c.dispute_seen THEN 0 ELSE greatest(0,earned-round(earned::numeric*loss/base)::bigint) END;
     IF target<earned THEN
      INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
      VALUES(c.member_id,c.id,'reversal',target-earned,c.currency,'sync:'||c.id||':'||p_generation);
     END IF;
    END IF;
   END LOOP;
  END IF;
 ELSIF b.id IS NOT NULL AND pt.status NOT IN ('completed','refunded','disputed') THEN waiting:=true;
 END IF;
 UPDATE public.affiliate_work SET processed_generation=CASE WHEN waiting THEN processed_generation ELSE p_generation END,
  status=CASE WHEN waiting OR requested_generation>p_generation THEN 'pending' ELSE 'done' END,
  next_attempt_at=CASE WHEN waiting THEN now()+interval '1 minute' ELSE now() END,
  lease_token=NULL,leased_until=NULL,last_error_code=CASE WHEN waiting THEN 'awaiting_fulfillment' ELSE NULL END,attempts=0
 WHERE payment_id=p_payment;
 RETURN NOT waiting;
END $$;

CREATE FUNCTION public.affiliate_apply(p_user uuid,p_code text,p_display_name text,p_channel text,p_terms_version text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_memberships; prog public.affiliate_programs;
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_user IS NULL
  OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_user)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF NOT prog.enabled OR prog.terms_version IS DISTINCT FROM p_terms_version THEN RAISE EXCEPTION 'Terms changed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.affiliate_memberships(user_id,code,display_name,channel,accepted_terms_version,accepted_at)
 VALUES(p_user,p_code,p_display_name,p_channel,p_terms_version,now()) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_memberships',NULL,to_jsonb(result),p_user);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_program_update(p_actor uuid,p_expected_version bigint,p_enabled boolean,p_terms_version text,p_terms jsonb,p_hold_days integer,p_buffer_days integer,p_thresholds jsonb)
RETURNS public.affiliate_programs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_programs; result public.affiliate_programs;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO old FROM public.affiliate_programs FOR UPDATE;
 IF old.id IS NULL THEN
  IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.affiliate_programs(enabled,terms_version,terms,hold_days,buffer_days,thresholds)
   VALUES(p_enabled,p_terms_version,p_terms,p_hold_days,p_buffer_days,p_thresholds) RETURNING * INTO result;
 ELSE
  IF old.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
  UPDATE public.affiliate_programs SET enabled=p_enabled,terms_version=p_terms_version,terms=p_terms,hold_days=p_hold_days,
   buffer_days=p_buffer_days,thresholds=p_thresholds,version=version+1 WHERE id=old.id RETURNING * INTO result;
 END IF;
 PERFORM public.affiliate_audit('affiliate_programs',CASE WHEN old.id IS NULL THEN NULL ELSE to_jsonb(old) END,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_member_update(p_actor uuid,p_member uuid,p_expected_version bigint,p_status text,p_reason text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_memberships; result public.affiliate_memberships;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 IF NOT public.affiliate_valid_reference(p_reason) THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.affiliate_memberships WHERE id=p_member FOR UPDATE;
 IF old.id IS NULL OR old.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 UPDATE public.affiliate_memberships SET status=p_status,version=version+1 WHERE id=p_member RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_memberships',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_rule_create(p_actor uuid,p_product uuid,p_expected_revision integer,p_enabled boolean,p_percentage_bps integer,p_fixed_minor bigint,p_currency text)
RETURNS public.affiliate_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_rules; revision integer;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM 1 FROM public.products WHERE id=p_product AND product_type='one_time' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'One-time product required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(r.revision),0) INTO revision FROM public.affiliate_rules r WHERE product_id=p_product;
 IF revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Revision changed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.affiliate_rules(product_id,revision,enabled,percentage_bps,fixed_minor,currency)
 VALUES(p_product,revision+1,p_enabled,p_percentage_bps,p_fixed_minor,p_currency) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_rules',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_coupon_bind(p_actor uuid,p_coupon uuid,p_member uuid,p_expected_version bigint)
RETURNS public.affiliate_coupon_bindings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_coupon_bindings; result public.affiliate_coupon_bindings; revision bigint;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM 1 FROM public.coupons WHERE id=p_coupon FOR UPDATE;
 PERFORM 1 FROM public.affiliate_memberships WHERE id=p_member AND status='approved' AND user_id IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Approved member required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(version),0) INTO revision FROM public.affiliate_coupon_bindings WHERE coupon_id=p_coupon;
 IF revision IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO old FROM public.affiliate_coupon_bindings WHERE coupon_id=p_coupon AND retired_at IS NULL;
 UPDATE public.affiliate_coupon_bindings SET retired_at=now() WHERE id=old.id;
 INSERT INTO public.affiliate_coupon_bindings(coupon_id,member_id,version) VALUES(p_coupon,p_member,revision+1) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_coupon_bindings',CASE WHEN old.id IS NULL THEN NULL ELSE to_jsonb(old) END,to_jsonb(result),p_actor);
 RETURN result;
END $$;

CREATE FUNCTION public.affiliate_lock_member(p_member uuid,p_currency text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM pt.id FROM public.payment_transactions pt WHERE EXISTS(SELECT 1 FROM public.affiliate_commissions c
  WHERE c.payment_id=pt.id AND c.member_id=p_member AND c.currency=p_currency) ORDER BY pt.id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_member::text||p_currency,0));
END $$;
CREATE FUNCTION public.affiliate_reserve(p_actor uuid,p_member uuid,p_currency text,p_cutoff timestamptz,p_member_version bigint,p_program_version bigint,p_payee_reference text)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.affiliate_memberships; prog public.affiliate_programs; result public.affiliate_payouts; entries uuid[]; total bigint; threshold bigint;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM public.affiliate_lock_member(p_member,p_currency);
 SELECT * INTO m FROM public.affiliate_memberships WHERE id=p_member FOR SHARE;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF m.id IS NULL OR m.version IS DISTINCT FROM p_member_version OR prog.version IS DISTINCT FROM p_program_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF m.status<>'approved' OR m.user_id IS NULL OR NOT prog.enabled OR p_currency !~ '^[A-Z]{3}$'
  OR p_cutoff IS NULL OR p_cutoff>now() OR NOT(prog.thresholds ? p_currency) THEN
  RAISE EXCEPTION 'Payout unavailable' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_commissions c JOIN public.payment_transactions pt ON pt.id=c.payment_id
   LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id WHERE c.member_id=p_member AND c.currency=p_currency
   AND (w.requested_generation>w.processed_generation OR w.status<>'done' OR c.observed_status<>pt.status
    OR c.observed_refunded_gross<>coalesce(pt.refunded_amount,0))) THEN
  RAISE EXCEPTION 'Sync required' USING ERRCODE='PT409'; END IF;
 SELECT array_agg(l.id ORDER BY l.created_at,l.id),sum(l.amount_minor)::bigint INTO entries,total
 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
 JOIN public.payment_transactions pt ON pt.id=c.payment_id
 WHERE l.member_id=p_member AND l.currency=p_currency AND l.created_at<=p_cutoff
  AND NOT EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a WHERE a.entry_id=l.id AND a.released_at IS NULL)
  AND ((c.eligible_at IS NOT NULL AND c.eligible_at<=p_cutoff
   AND ((NOT c.dispute_seen AND pt.status<>'disputed') OR c.dispute_reviewed_at IS NOT NULL))
   OR (l.amount_minor<0 AND EXISTS(SELECT 1 FROM public.affiliate_ledger old
    JOIN public.affiliate_payout_allocations a ON a.entry_id=old.id AND a.released_at IS NULL
    JOIN public.affiliate_payouts p ON p.id=a.payout_id AND p.status='paid' WHERE old.commission_id=c.id)));
 threshold:=(prog.thresholds->>p_currency)::bigint;
 IF total IS NULL OR total<=0 OR total<threshold THEN RAISE EXCEPTION 'Threshold not met' USING ERRCODE='22023'; END IF;
 INSERT INTO public.affiliate_payouts(member_id,currency,earnings_minor,status,cutoff,payee_reference)
  VALUES(p_member,p_currency,total,'reserved',p_cutoff,p_payee_reference) RETURNING * INTO result;
 INSERT INTO public.affiliate_payout_allocations(payout_id,entry_id) SELECT result.id,unnest(entries);
 PERFORM public.affiliate_audit('affiliate_payouts',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_mark_paid(p_actor uuid,p_payout uuid,p_expected_version bigint,p_bank_reference text,p_invoice_reference text,
 p_bank_amount_minor bigint,p_currency text,p_paid_at timestamptz,p_full_settlement boolean,p_reason text DEFAULT NULL,p_evidence_reference text DEFAULT NULL)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_payouts; result public.affiliate_payouts;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout;
 PERFORM public.affiliate_lock_member(old.member_id,old.currency);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout FOR UPDATE;
 IF old.status='paid' AND old.bank_reference=p_bank_reference AND old.invoice_reference=p_invoice_reference
  AND old.bank_amount_minor=p_bank_amount_minor AND old.currency=p_currency AND old.paid_at=p_paid_at AND p_full_settlement THEN RETURN old; END IF;
 IF old.id IS NULL OR old.version IS DISTINCT FROM p_expected_version OR old.status<>'reserved' THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_full_settlement IS DISTINCT FROM true OR p_currency IS DISTINCT FROM old.currency OR p_paid_at IS NULL OR p_paid_at>now()
 OR NOT public.affiliate_valid_reference(p_bank_reference) OR NOT public.affiliate_valid_reference(p_invoice_reference)
 OR p_bank_amount_minor IS NULL OR p_bank_amount_minor<=0
 OR (old.needs_review AND (NOT public.affiliate_valid_reference(p_reason) OR NOT public.affiliate_valid_reference(p_evidence_reference))) THEN
  RAISE EXCEPTION 'Payment evidence required' USING ERRCODE='22023'; END IF;
 UPDATE public.affiliate_payouts SET status='paid',version=version+1,bank_reference=p_bank_reference,
  invoice_reference=p_invoice_reference,bank_amount_minor=p_bank_amount_minor,paid_at=p_paid_at WHERE id=p_payout RETURNING * INTO result;
 INSERT INTO public.affiliate_ledger(member_id,payout_id,kind,amount_minor,currency,economic_key,reason,evidence_reference)
  VALUES(old.member_id,old.id,'settlement',-old.earnings_minor,old.currency,'settlement:'||old.id,p_reason,p_evidence_reference);
 PERFORM public.affiliate_audit('affiliate_payouts',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason,'evidence_reference',p_evidence_reference),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_cancel_payout(p_actor uuid,p_payout uuid,p_expected_version bigint,p_no_transfer boolean,p_reason text)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_payouts; result public.affiliate_payouts;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout;
 PERFORM public.affiliate_lock_member(old.member_id,old.currency);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout FOR UPDATE;
 IF old.id IS NULL OR old.version IS DISTINCT FROM p_expected_version OR old.status<>'reserved' THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_no_transfer IS DISTINCT FROM true OR NOT public.affiliate_valid_reference(p_reason) THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='22023'; END IF;
 UPDATE public.affiliate_payouts SET status='cancelled',version=version+1 WHERE id=p_payout RETURNING * INTO result;
 UPDATE public.affiliate_payout_allocations SET released_at=now() WHERE payout_id=p_payout AND released_at IS NULL;
 PERFORM public.affiliate_audit('affiliate_payouts',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_manual_adjustment(p_actor uuid,p_commission uuid,p_expected_version bigint,p_amount_minor bigint,p_reason text,p_evidence_reference text,p_review_dispute boolean)
RETURNS public.affiliate_ledger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; result public.affiliate_ledger; total numeric;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO c FROM public.affiliate_commissions WHERE id=p_commission;
 PERFORM public.affiliate_lock_member(c.member_id,c.currency);
 SELECT * INTO c FROM public.affiliate_commissions WHERE id=p_commission FOR UPDATE;
 IF c.id IS NULL OR c.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_amount_minor IS NULL OR p_amount_minor=0 OR NOT public.affiliate_valid_reference(p_reason) OR NOT public.affiliate_valid_reference(p_evidence_reference) THEN
  RAISE EXCEPTION 'Evidence required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(sum(amount_minor),0)+p_amount_minor INTO total FROM public.affiliate_ledger WHERE commission_id=c.id;
 IF total<0 OR total>c.accrued_minor OR (p_review_dispute AND NOT c.dispute_seen)
  OR EXISTS(SELECT 1 FROM public.affiliate_work WHERE payment_id=c.payment_id AND requested_generation>processed_generation) THEN
  RAISE EXCEPTION 'Adjustment unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key,reason,evidence_reference)
 VALUES(c.member_id,c.id,'manual_adjustment',p_amount_minor,c.currency,'manual:'||c.id||':'||c.version,p_reason,p_evidence_reference) RETURNING * INTO result;
 UPDATE public.affiliate_commissions SET dispute_reviewed_at=CASE WHEN p_review_dispute THEN now() ELSE dispute_reviewed_at END,version=version+1 WHERE id=c.id;
 UPDATE public.affiliate_payouts p SET needs_review=true,version=version+1
 WHERE p.status='reserved' AND NOT p.needs_review AND EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a
  JOIN public.affiliate_ledger l ON l.id=a.entry_id WHERE a.payout_id=p.id AND a.released_at IS NULL AND l.commission_id=c.id);
 PERFORM public.affiliate_audit('affiliate_ledger',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_work_retry(p_actor uuid,p_payment uuid,p_generation bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_work; result public.affiliate_work;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 IF NOT public.affiliate_valid_reference(p_reason) THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.affiliate_work WHERE payment_id=p_payment FOR UPDATE;
 IF old.payment_id IS NULL OR old.requested_generation IS DISTINCT FROM p_generation OR old.status='leased' THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 UPDATE public.affiliate_work SET status='pending',attempts=0,next_attempt_at=now(),last_error_code=NULL,
 requested_generation=requested_generation+1 WHERE payment_id=p_payment RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_work',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason),p_actor);
END $$;

CREATE TRIGGER affiliate_rules_guard BEFORE UPDATE OR DELETE ON public.affiliate_rules FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();

CREATE TRIGGER affiliate_ledger_guard BEFORE UPDATE OR DELETE ON public.affiliate_ledger FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();

CREATE TRIGGER affiliate_coupon_bindings_guard BEFORE UPDATE ON public.affiliate_coupon_bindings FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_commissions_guard BEFORE UPDATE ON public.affiliate_commissions FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_payouts_guard BEFORE UPDATE ON public.affiliate_payouts FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_payout_allocations_guard BEFORE UPDATE ON public.affiliate_payout_allocations FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_work_guard BEFORE DELETE ON public.affiliate_work FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();
CREATE CONSTRAINT TRIGGER affiliate_commissions_relations AFTER INSERT OR UPDATE ON public.affiliate_commissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE CONSTRAINT TRIGGER affiliate_ledger_relations AFTER INSERT OR UPDATE ON public.affiliate_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE CONSTRAINT TRIGGER affiliate_payouts_relations AFTER INSERT OR UPDATE ON public.affiliate_payouts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE CONSTRAINT TRIGGER affiliate_payout_allocations_relations AFTER INSERT OR UPDATE ON public.affiliate_payout_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE TRIGGER affiliate_redemption_enqueue AFTER INSERT ON public.coupon_redemptions FOR EACH ROW EXECUTE FUNCTION public.affiliate_enqueue();
CREATE TRIGGER affiliate_payment_enqueue AFTER UPDATE OF status,refunded_amount,fulfillment_pending ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.affiliate_enqueue();

ALTER TABLE public.affiliate_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_programs_service ON public.affiliate_programs FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_programs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_programs TO service_role;

ALTER TABLE public.affiliate_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_memberships_service ON public.affiliate_memberships FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_memberships FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_memberships TO service_role;

ALTER TABLE public.affiliate_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_rules_service ON public.affiliate_rules FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_rules FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_rules TO service_role;

ALTER TABLE public.affiliate_coupon_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_coupon_bindings_service ON public.affiliate_coupon_bindings FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_coupon_bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_coupon_bindings TO service_role;

ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_commissions_service ON public.affiliate_commissions FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_commissions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_commissions TO service_role;

ALTER TABLE public.affiliate_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_payouts_service ON public.affiliate_payouts FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_payouts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_payouts TO service_role;

ALTER TABLE public.affiliate_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_ledger_service ON public.affiliate_ledger FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_ledger FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_ledger TO service_role;

ALTER TABLE public.affiliate_payout_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_payout_allocations_service ON public.affiliate_payout_allocations FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_payout_allocations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_payout_allocations TO service_role;

ALTER TABLE public.affiliate_work ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_work_service ON public.affiliate_work FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.affiliate_work TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_valid_reference(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_valid_reference(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_valid_program(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_valid_program(jsonb,jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_admin(uuid) FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_audit(text,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_immutable() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_guard() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_check_relations() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_enqueue() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_claim_work(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_claim_work(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_retry_work(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_retry_work(uuid,uuid,bigint,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_program_update(uuid,bigint,boolean,text,jsonb,integer,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_program_update(uuid,bigint,boolean,text,jsonb,integer,integer,jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_member_update(uuid,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_member_update(uuid,uuid,bigint,text,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_rule_create(uuid,uuid,integer,boolean,integer,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_rule_create(uuid,uuid,integer,boolean,integer,bigint,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_coupon_bind(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_coupon_bind(uuid,uuid,uuid,bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_lock_member(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_mark_paid(uuid,uuid,bigint,text,text,bigint,text,timestamptz,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_mark_paid(uuid,uuid,bigint,text,text,bigint,text,timestamptz,boolean,text,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_cancel_payout(uuid,uuid,bigint,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_cancel_payout(uuid,uuid,bigint,boolean,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_manual_adjustment(uuid,uuid,bigint,bigint,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_manual_adjustment(uuid,uuid,bigint,bigint,text,text,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_work_retry(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_work_retry(uuid,uuid,bigint,text) TO service_role;

CREATE TRIGGER affiliate_binding_period BEFORE INSERT OR UPDATE ON public.affiliate_coupon_bindings
FOR EACH ROW EXECUTE FUNCTION public.affiliate_binding_check();
REVOKE EXECUTE ON FUNCTION public.affiliate_binding_check() FROM PUBLIC,anon,authenticated,service_role;
