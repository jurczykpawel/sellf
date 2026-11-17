-- Co-creator commission (W220): the seller gives one person a fixed share of a one-time product,
-- without any coupon. It is added on top of a partner commission on the same line (also when it is
-- the same person). Shares accrue from purchases made after the assignment only; payouts of
-- co-creator shares wait until that person accepts the separate creator terms.
-- @see admin-panel/src/lib/affiliates/cocreator/service.ts
-- @see admin-panel/tests/affiliates/cocreator/database.test.ts

-- ===== MEMBERSHIPS: PARTNER ROLE AND CREATOR TERMS =====
-- A membership is the payee. A co-creator who never applied as a partner gets one with
-- is_partner=false (no partner terms, cannot own coupons).

ALTER TABLE public.affiliate_memberships
  ADD COLUMN is_partner boolean NOT NULL DEFAULT true,
  ADD COLUMN creator_terms_version text,
  ADD COLUMN creator_accepted_at timestamptz,
  ALTER COLUMN accepted_terms_version DROP NOT NULL,
  ALTER COLUMN accepted_at DROP NOT NULL;
ALTER TABLE public.affiliate_memberships DROP CONSTRAINT affiliate_memberships_accepted_terms_version_check;
ALTER TABLE public.affiliate_memberships
  ADD CONSTRAINT affiliate_memberships_accepted_terms_version_check
    CHECK (accepted_terms_version IS NULL OR public.affiliate_valid_reference(accepted_terms_version)),
  ADD CONSTRAINT affiliate_memberships_partner_terms
    CHECK (NOT is_partner OR (accepted_terms_version IS NOT NULL AND accepted_at IS NOT NULL)),
  ADD CONSTRAINT affiliate_memberships_creator_terms
    CHECK ((creator_terms_version IS NULL) = (creator_accepted_at IS NULL)
      AND (creator_terms_version IS NULL OR public.affiliate_valid_reference(creator_terms_version)));

-- ===== CREATOR TERMS (append-only, newest row is current) =====

CREATE TABLE public.affiliate_creator_terms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  terms_version text NOT NULL UNIQUE CHECK (public.affiliate_valid_reference(terms_version)),
  terms jsonb NOT NULL CHECK (public.affiliate_valid_program(terms, '{}'::jsonb)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER affiliate_creator_terms_guard BEFORE UPDATE OR DELETE ON public.affiliate_creator_terms
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();
ALTER TABLE public.affiliate_creator_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_creator_terms_service ON public.affiliate_creator_terms FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.affiliate_creator_terms FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.affiliate_creator_terms TO service_role;

-- ===== CO-CREATOR RULES (append-only revisions per product; member NULL = no co-creator) =====

CREATE TABLE public.affiliate_cocreator_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  member_id uuid REFERENCES public.affiliate_memberships(id),
  percentage_bps integer CHECK (percentage_bps BETWEEN 1 AND 10000),
  fixed_minor bigint CHECK (fixed_minor > 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, revision),
  CHECK ((member_id IS NULL AND percentage_bps IS NULL AND fixed_minor IS NULL AND currency IS NULL)
    OR (member_id IS NOT NULL AND ((percentage_bps IS NOT NULL AND fixed_minor IS NULL AND currency IS NULL)
      OR (percentage_bps IS NULL AND fixed_minor IS NOT NULL AND currency IS NOT NULL))))
);
CREATE INDEX affiliate_cocreator_member ON public.affiliate_cocreator_rules(member_id);
CREATE INDEX affiliate_cocreator_time ON public.affiliate_cocreator_rules(product_id, created_at DESC, revision DESC);
-- Append-only like partner rules; removed only together with a permanently deleted product
-- (remove_product_as refuses that while any commission exists).
CREATE TRIGGER affiliate_cocreator_rules_guard BEFORE UPDATE OR DELETE ON public.affiliate_cocreator_rules
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_rule_guard();
ALTER TABLE public.affiliate_cocreator_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_cocreator_rules_service ON public.affiliate_cocreator_rules FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.affiliate_cocreator_rules FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.affiliate_cocreator_rules TO service_role;

-- ===== COMMISSIONS: KIND =====

ALTER TABLE public.affiliate_commissions
  ADD COLUMN kind text NOT NULL DEFAULT 'referral' CHECK (kind IN ('referral', 'cocreator')),
  ADD COLUMN cocreator_rule_id uuid REFERENCES public.affiliate_cocreator_rules(id),
  ALTER COLUMN rule_id DROP NOT NULL,
  ALTER COLUMN binding_id DROP NOT NULL;
ALTER TABLE public.affiliate_commissions
  ADD CONSTRAINT affiliate_commissions_source CHECK (
    (kind = 'referral' AND rule_id IS NOT NULL AND binding_id IS NOT NULL AND cocreator_rule_id IS NULL)
    OR (kind = 'cocreator' AND rule_id IS NULL AND binding_id IS NULL AND cocreator_rule_id IS NOT NULL)),
  DROP CONSTRAINT affiliate_commissions_payment_id_line_item_id_livemode_key,
  ADD CONSTRAINT affiliate_commissions_line_kind UNIQUE (payment_id, line_item_id, livemode, kind);
CREATE INDEX affiliate_commission_cocreator_rule ON public.affiliate_commissions(cocreator_rule_id);

-- ===== FUNCTIONS =====

-- True when a line of the payment is a one-time product that has (or had) a co-creator.
-- The rule in force at the session time is decided by affiliate_apply_sync.
CREATE FUNCTION public.affiliate_cocreator_candidate(p_payment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id = l.product_id
    WHERE l.transaction_id = p_payment AND p.product_type = 'one_time'
      AND EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules r WHERE r.product_id = l.product_id AND r.member_id IS NOT NULL));
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_cocreator_candidate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_cocreator_candidate(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.affiliate_check_relations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; p public.affiliate_payouts; l public.affiliate_ledger; total numeric;
BEGIN
 IF TG_TABLE_NAME='affiliate_commissions' THEN
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.id;
  IF c.kind='cocreator' THEN
   IF NOT EXISTS(SELECT 1 FROM public.payment_line_items li JOIN public.affiliate_cocreator_rules r ON r.id=c.cocreator_rule_id
    JOIN public.payment_transactions pt ON pt.id=c.payment_id
    WHERE li.id=c.line_item_id AND li.transaction_id=c.payment_id AND li.product_id=r.product_id
     AND upper(li.currency)=c.currency AND upper(pt.currency)=c.currency AND r.member_id=c.member_id) THEN
    RAISE EXCEPTION 'Commission references differ' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.payment_line_items li JOIN public.affiliate_rules r ON r.id=c.rule_id
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
    WHERE a.payout_id=p.id AND (e.member_id<>p.member_id OR e.currency<>p.currency OR e.kind='settlement' OR NOT EXISTS(SELECT 1 FROM public.affiliate_commissions comm WHERE comm.id=e.commission_id AND comm.livemode=p.livemode)))
   OR (SELECT coalesce(sum(e.amount_minor),0) FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger e ON e.id=a.entry_id
    WHERE a.payout_id=p.id AND a.released_at IS NULL)<>(CASE WHEN p.status='cancelled' THEN 0 ELSE p.earnings_minor END)
   OR (p.status='paid' AND NOT EXISTS(SELECT 1 FROM public.affiliate_ledger WHERE payout_id=p.id)) THEN
   RAISE EXCEPTION 'Payout allocation differs' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_check_relations() FROM PUBLIC, anon, authenticated;

-- Paid payments with a co-creator line are queued like coupon payments.
CREATE OR REPLACE FUNCTION public.affiliate_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid; disputed boolean;
BEGIN
 IF TG_TABLE_NAME='coupon_redemptions' THEN
  pid:=NEW.transaction_id;
  IF NOT EXISTS(SELECT 1 FROM public.affiliate_coupon_bindings WHERE coupon_id=NEW.coupon_id) THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='payment_line_items' THEN
  pid:=NEW.transaction_id;
  -- Unpaid orders are queued later by the payment status change.
  IF NOT EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=pid AND status IN ('completed','refunded','disputed'))
   OR NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=NEW.product_id AND p.product_type='one_time'
    AND EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules r WHERE r.product_id=p.id AND r.member_id IS NOT NULL)) THEN RETURN NEW; END IF;
 ELSE
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.refunded_amount IS NOT DISTINCT FROM OLD.refunded_amount
    AND NEW.fulfillment_pending IS NOT DISTINCT FROM OLD.fulfillment_pending THEN RETURN NEW; END IF;
  pid:=NEW.id;
  IF NOT EXISTS(SELECT 1 FROM public.coupon_redemptions r JOIN public.affiliate_coupon_bindings b ON b.coupon_id=r.coupon_id WHERE r.transaction_id=pid)
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=pid)
   AND NOT public.affiliate_cocreator_candidate(pid) THEN RETURN NEW; END IF;
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
REVOKE EXECUTE ON FUNCTION public.affiliate_enqueue() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER affiliate_line_enqueue AFTER INSERT ON public.payment_line_items
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_enqueue();

CREATE OR REPLACE FUNCTION public.affiliate_complete_unbound_work(p_payment uuid,p_token uuid,p_generation bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.payment_transactions WHERE id=p_payment FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.coupon_redemptions r JOIN public.affiliate_coupon_bindings b ON b.coupon_id=r.coupon_id WHERE r.transaction_id=p_payment)
  OR EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment)
  OR public.affiliate_cocreator_candidate(p_payment) THEN RETURN false; END IF;
 UPDATE public.affiliate_work SET processed_generation=p_generation,
  status=CASE WHEN requested_generation>p_generation THEN 'pending' ELSE 'done' END,
  lease_token=NULL,leased_until=NULL,last_error_code=NULL,attempts=0,next_attempt_at=now()
 WHERE payment_id=p_payment AND status='leased' AND lease_token=p_token AND leased_until>now()
  AND p_generation>processed_generation AND p_generation<=requested_generation;
 RETURN FOUND;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_complete_unbound_work(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_complete_unbound_work(uuid,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.affiliate_apply_sync(p_payment uuid,p_token uuid,p_generation bigint,p_session_created_at timestamptz,p_livemode boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pt public.payment_transactions; w public.affiliate_work; b public.affiliate_coupon_bindings;
 prog public.affiliate_programs; rule public.affiliate_rules; cprog public.affiliate_programs; crule public.affiliate_cocreator_rules;
 c public.affiliate_commissions; li record; red public.coupon_redemptions; member_status text;
 base bigint; earned bigint; target bigint; automatic numeric; loss bigint; delta bigint; paid timestamptz;
 self_match boolean; mature timestamptz; waiting boolean:=false; net_missing boolean:=false; blocked boolean:=false; creator_due boolean;
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
  SELECT v.program_id,true,v.enabled,v.version,v.hold_days,v.buffer_days,v.terms_version,v.terms,v.thresholds
   INTO prog FROM public.affiliate_program_versions v WHERE v.created_at<=p_session_created_at
   ORDER BY v.created_at DESC,v.version DESC LIMIT 1;
  SELECT e.status INTO member_status FROM public.affiliate_membership_events e
   WHERE e.member_id=b.member_id AND e.created_at<=p_session_created_at ORDER BY e.created_at DESC,e.version DESC LIMIT 1;
  IF prog.id IS NULL OR member_status IS NULL THEN
   UPDATE public.affiliate_work SET status='needs_review',lease_token=NULL,leased_until=NULL,last_error_code='history_unavailable'
    WHERE payment_id=p_payment;
   RETURN false;
  END IF;
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
 IF b.id IS NOT NULL AND prog.enabled AND member_status='approved' AND pt.status IN ('completed','refunded','disputed') THEN
  SELECT EXISTS(SELECT 1 FROM public.affiliate_memberships am JOIN auth.users u ON u.id=am.user_id
   WHERE am.id=b.member_id AND (u.id=pt.user_id OR lower(btrim(u.email))=lower(btrim(pt.customer_email)))) INTO self_match;
  waiting:=pt.fulfillment_pending;
  net_missing:=NOT waiting AND EXISTS(
   SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id=l.product_id
   CROSS JOIN LATERAL (SELECT r.enabled,r.currency FROM public.affiliate_rules r
    WHERE r.product_id=l.product_id AND r.created_at<=p_session_created_at ORDER BY r.created_at DESC,r.revision DESC LIMIT 1) r
   WHERE l.transaction_id=p_payment AND p.product_type='one_time' AND r.enabled
    AND (r.currency IS NULL OR r.currency=upper(l.currency)) AND l.net_amount IS NULL);
  IF NOT waiting AND NOT net_missing THEN
   FOR li IN SELECT l.*,p.is_refundable,p.refund_period_days,p.product_type FROM public.payment_line_items l
    JOIN public.products p ON p.id=l.product_id WHERE l.transaction_id=p_payment ORDER BY l.id LOOP
    IF li.product_type<>'one_time' THEN CONTINUE; END IF;
    SELECT * INTO rule FROM public.affiliate_rules WHERE product_id=li.product_id AND created_at<=p_session_created_at
     ORDER BY created_at DESC,revision DESC LIMIT 1;
    IF rule.id IS NULL OR NOT rule.enabled OR (rule.currency IS NOT NULL AND rule.currency<>upper(li.currency)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment AND line_item_id=li.id AND livemode=p_livemode AND kind='referral') THEN CONTINUE; END IF;
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
 -- Co-creator shares: no coupon; the rule in force when the checkout session started (never retroactive).
 -- Unpaid orders and pending fulfilment are queued again by the payment change itself.
 SELECT EXISTS(SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id=l.product_id
  CROSS JOIN LATERAL (SELECT r.member_id,r.currency FROM public.affiliate_cocreator_rules r
   WHERE r.product_id=l.product_id AND r.created_at<=p_session_created_at ORDER BY r.created_at DESC,r.revision DESC LIMIT 1) r
  WHERE l.transaction_id=p_payment AND p.product_type='one_time' AND r.member_id IS NOT NULL
   AND (r.currency IS NULL OR r.currency=upper(l.currency))
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_commissions x WHERE x.payment_id=p_payment AND x.line_item_id=l.id AND x.livemode=p_livemode AND x.kind='cocreator'))
  INTO creator_due;
 IF creator_due AND NOT waiting AND NOT net_missing AND pt.status IN ('completed','refunded','disputed') AND NOT pt.fulfillment_pending THEN
  net_missing:=EXISTS(SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id=l.product_id
   CROSS JOIN LATERAL (SELECT r.member_id,r.currency FROM public.affiliate_cocreator_rules r
    WHERE r.product_id=l.product_id AND r.created_at<=p_session_created_at ORDER BY r.created_at DESC,r.revision DESC LIMIT 1) r
   WHERE l.transaction_id=p_payment AND p.product_type='one_time' AND r.member_id IS NOT NULL
    AND (r.currency IS NULL OR r.currency=upper(l.currency)) AND l.net_amount IS NULL);
  IF NOT net_missing THEN
   SELECT v.program_id,true,v.enabled,v.version,v.hold_days,v.buffer_days,v.terms_version,v.terms,v.thresholds
    INTO cprog FROM public.affiliate_program_versions v WHERE v.created_at<=p_session_created_at
    ORDER BY v.created_at DESC,v.version DESC LIMIT 1;
   IF cprog.id IS NULL THEN
    UPDATE public.affiliate_work SET status='needs_review',lease_token=NULL,leased_until=NULL,last_error_code='history_unavailable'
     WHERE payment_id=p_payment;
    RETURN false;
   END IF;
   paid:=coalesce(red.redeemed_at,pt.paid_at,pt.created_at);
   FOR li IN SELECT l.*,p.is_refundable,p.refund_period_days,p.product_type FROM public.payment_line_items l
    JOIN public.products p ON p.id=l.product_id WHERE l.transaction_id=p_payment ORDER BY l.id LOOP
    IF li.product_type<>'one_time' THEN CONTINUE; END IF;
    crule:=NULL;
    SELECT * INTO crule FROM public.affiliate_cocreator_rules WHERE product_id=li.product_id AND created_at<=p_session_created_at
     ORDER BY created_at DESC,revision DESC LIMIT 1;
    IF crule.id IS NULL OR crule.member_id IS NULL OR (crule.currency IS NOT NULL AND crule.currency<>upper(li.currency)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment AND line_item_id=li.id AND livemode=p_livemode AND kind='cocreator') THEN CONTINUE; END IF;
    member_status:=NULL;
    SELECT e.status INTO member_status FROM public.affiliate_membership_events e
     WHERE e.member_id=crule.member_id AND e.created_at<=p_session_created_at ORDER BY e.created_at DESC,e.version DESC LIMIT 1;
    -- 'pending' here only means a co-creator's own partner application awaits the seller: shares keep accruing.
    IF member_status IS NULL OR member_status NOT IN ('approved','pending') THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(crule.member_id::text||upper(li.currency),0));
    SELECT EXISTS(SELECT 1 FROM public.affiliate_memberships am JOIN auth.users u ON u.id=am.user_id
     WHERE am.id=crule.member_id AND (u.id=pt.user_id OR lower(btrim(u.email))=lower(btrim(pt.customer_email)))) INTO self_match;
    base:=li.net_amount;
    earned:=CASE WHEN self_match THEN 0 WHEN crule.percentage_bps IS NOT NULL THEN round(base::numeric*crule.percentage_bps/10000)::bigint ELSE least(base,crule.fixed_minor) END;
    mature:=CASE WHEN li.is_refundable AND li.refund_period_days IS NULL THEN NULL ELSE
     paid+greatest(cprog.hold_days,CASE WHEN li.is_refundable THEN li.refund_period_days+cprog.buffer_days ELSE 0 END)*interval '1 day' END;
    INSERT INTO public.affiliate_commissions(payment_id,line_item_id,member_id,kind,cocreator_rule_id,livemode,session_created_at,paid_at,
     currency,base_minor,accrued_minor,self_referral,is_refundable,refund_period_days,hold_days,buffer_days,eligible_at,observed_refunded_gross,observed_status,dispute_seen)
    VALUES(p_payment,li.id,crule.member_id,'cocreator',crule.id,p_livemode,p_session_created_at,paid,upper(li.currency),base,earned,self_match,
     li.is_refundable,li.refund_period_days,cprog.hold_days,cprog.buffer_days,mature,coalesce(pt.refunded_amount,0)::bigint,pt.status,w.dispute_seen OR pt.status='disputed') RETURNING * INTO c;
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
 END IF;
 UPDATE public.affiliate_work SET processed_generation=CASE WHEN waiting OR net_missing THEN processed_generation ELSE p_generation END,
  status=CASE WHEN net_missing THEN 'needs_review' WHEN waiting OR requested_generation>p_generation THEN 'pending' ELSE 'done' END,
  next_attempt_at=CASE WHEN waiting THEN now()+interval '1 minute' ELSE now() END,
  lease_token=NULL,leased_until=NULL,last_error_code=CASE WHEN net_missing THEN 'net_unavailable' WHEN waiting THEN 'awaiting_fulfillment' ELSE NULL END,
  attempts=CASE WHEN waiting OR net_missing THEN attempts ELSE 0 END
 WHERE payment_id=p_payment;
 RETURN NOT waiting AND NOT net_missing;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) TO service_role;

-- A co-creator who later applies as a partner keeps the same membership (and creator role); the
-- application waits for the seller like any other ('pending'), so no coupon can be bound until approval.
CREATE OR REPLACE FUNCTION public.affiliate_apply(p_user uuid,p_code text,p_display_name text,p_channel text,p_terms_version text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_memberships; prog public.affiliate_programs; old public.affiliate_memberships;
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_user IS NULL
  OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_user)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF NOT prog.enabled OR prog.terms_version IS DISTINCT FROM p_terms_version THEN RAISE EXCEPTION 'Terms changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO old FROM public.affiliate_memberships WHERE user_id=p_user FOR UPDATE;
 IF old.id IS NOT NULL AND NOT old.is_partner THEN
  UPDATE public.affiliate_memberships SET is_partner=true,status=CASE WHEN old.status='approved' THEN 'pending' ELSE old.status END,
   code=p_code,display_name=p_display_name,channel=p_channel,
   accepted_terms_version=p_terms_version,accepted_at=now(),version=version+1 WHERE id=old.id RETURNING * INTO result;
  INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
  PERFORM public.affiliate_audit('affiliate_memberships',to_jsonb(old),to_jsonb(result),p_user);
  RETURN result;
 END IF;
 INSERT INTO public.affiliate_memberships(user_id,code,display_name,channel,accepted_terms_version,accepted_at)
 VALUES(p_user,p_code,p_display_name,p_channel,p_terms_version,now()) RETURNING * INTO result;
 INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
 PERFORM public.affiliate_audit('affiliate_memberships',NULL,to_jsonb(result),p_user);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) TO service_role;

-- Only partners own coupons.
CREATE OR REPLACE FUNCTION public.affiliate_binding_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.coupons WHERE id=NEW.coupon_id FOR UPDATE;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.affiliate_memberships WHERE id=NEW.member_id AND status='approved' AND is_partner AND user_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Approved member required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_coupon_bindings b WHERE b.coupon_id=NEW.coupon_id AND b.id<>NEW.id
  AND tstzrange(b.created_at,b.retired_at,'[)') && tstzrange(NEW.created_at,NEW.retired_at,'[)')) THEN
  RAISE EXCEPTION 'Binding periods overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_binding_check() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.affiliate_cocreator_set(p_actor uuid,p_product uuid,p_expected_revision integer,p_email text,
 p_display_name text,p_percentage_bps integer,p_fixed_minor bigint,p_currency text)
RETURNS public.affiliate_cocreator_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_cocreator_rules; revision integer; target uuid; m public.affiliate_memberships;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM 1 FROM public.products WHERE id=p_product AND product_type='one_time' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'One-time product required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.affiliate_programs) THEN RAISE EXCEPTION 'Program settings required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(r.revision),0) INTO revision FROM public.affiliate_cocreator_rules r WHERE r.product_id=p_product;
 IF revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Revision changed' USING ERRCODE='PT409'; END IF;
 IF p_email IS NOT NULL THEN
  SELECT u.id INTO target FROM auth.users u WHERE lower(btrim(u.email))=lower(btrim(p_email)) AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;
  IF target IS NULL THEN RAISE EXCEPTION 'Account required' USING ERRCODE='P0002'; END IF;
  SELECT * INTO m FROM public.affiliate_memberships WHERE user_id=target FOR UPDATE;
  IF m.id IS NULL THEN
   INSERT INTO public.affiliate_memberships(user_id,code,status,display_name,is_partner)
    VALUES(target,'creator-'||replace(target::text,'-',''),'approved',
     left(coalesce(nullif(btrim(p_display_name),''),split_part(btrim(p_email),'@',1)),120),false) RETURNING * INTO m;
   INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(m.id,m.version,m.status);
   PERFORM public.affiliate_audit('affiliate_memberships',NULL,to_jsonb(m),p_actor);
  -- The seller's own assignment is the approval of the creator role; a partner application still
  -- awaiting review ('pending') does not block it, a rejected/suspended/terminated membership does.
  ELSIF m.status NOT IN ('approved','pending') THEN RAISE EXCEPTION 'Approved member required' USING ERRCODE='22023';
  END IF;
 ELSIF p_percentage_bps IS NOT NULL OR p_fixed_minor IS NOT NULL OR p_currency IS NOT NULL THEN
  RAISE EXCEPTION 'Person required' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.affiliate_cocreator_rules(product_id,revision,member_id,percentage_bps,fixed_minor,currency)
  VALUES(p_product,revision+1,m.id,p_percentage_bps,p_fixed_minor,p_currency) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_cocreator_rules',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_cocreator_set(uuid,uuid,integer,text,text,integer,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_cocreator_set(uuid,uuid,integer,text,text,integer,bigint,text) TO service_role;

CREATE FUNCTION public.affiliate_creator_terms_publish(p_actor uuid,p_expected_version text,p_terms_version text,p_terms jsonb)
RETURNS public.affiliate_creator_terms LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current public.affiliate_creator_terms; result public.affiliate_creator_terms;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('affiliate_creator_terms',0));
 SELECT * INTO current FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1;
 IF current.terms_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF current.terms_version=p_terms_version THEN
  IF current.terms<>p_terms THEN RAISE EXCEPTION 'Terms version changed' USING ERRCODE='PT409'; END IF;
  RETURN current;
 END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_creator_terms WHERE terms_version=p_terms_version) THEN
  RAISE EXCEPTION 'Terms version changed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.affiliate_creator_terms(terms_version,terms) VALUES(p_terms_version,p_terms) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_creator_terms',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_creator_terms_publish(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_creator_terms_publish(uuid,text,text,jsonb) TO service_role;

CREATE FUNCTION public.affiliate_creator_accept(p_user uuid,p_terms_version text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_memberships; result public.affiliate_memberships; t public.affiliate_creator_terms;
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_user IS NULL
  OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_user) THEN
  RAISE EXCEPTION 'Account required' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM public.affiliate_memberships WHERE user_id=p_user FOR UPDATE;
 IF old.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules WHERE member_id=old.id) THEN
  RAISE EXCEPTION 'Co-creator required' USING ERRCODE='P0002'; END IF;
 SELECT * INTO t FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1;
 IF t.id IS NULL OR t.terms_version IS DISTINCT FROM p_terms_version THEN RAISE EXCEPTION 'Terms changed' USING ERRCODE='PT409'; END IF;
 IF old.creator_terms_version=p_terms_version THEN RETURN old; END IF;
 UPDATE public.affiliate_memberships SET creator_terms_version=p_terms_version,creator_accepted_at=now(),version=version+1
  WHERE id=old.id RETURNING * INTO result;
 INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
 PERFORM public.affiliate_audit('affiliate_memberships',to_jsonb(old),to_jsonb(result),p_user);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_creator_accept(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_creator_accept(uuid,text) TO service_role;

-- One payout eligibility rule for preview, reservation and CSV export. A deduction from a commission
-- that was already paid out always counts, so switching the program off never hides partner debt.
-- Otherwise an entry needs its commission to be ready and its kind's gate open: co-creator shares
-- after the creator terms are accepted, partner shares while the partner program is enabled.
CREATE FUNCTION public.affiliate_entry_eligible(p_kind text,p_amount bigint,p_previously_paid boolean,p_ready boolean,
 p_referral_ok boolean,p_creator_ok boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT (p_amount<0 AND p_previously_paid) OR (p_ready AND CASE WHEN p_kind='cocreator' THEN p_creator_ok ELSE p_referral_ok END)
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_entry_eligible(text,bigint,boolean,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_entry_eligible(text,bigint,boolean,boolean,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.affiliate_preview(p_member uuid,p_currency text,p_cutoff timestamptz,p_livemode boolean DEFAULT true)
RETURNS TABLE(member_version text,program_version text,earnings_minor text,debt_offset_minor text,payable_minor text,held_minor text,
 threshold_minor text,sync_required boolean,available boolean,entry_ids uuid[],accrued text,reversed text,paid text,reserved text,balance text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH gate AS (
  SELECT coalesce((SELECT enabled FROM public.affiliate_programs),false) AS referral_ok,
   coalesce((SELECT creator_accepted_at IS NOT NULL FROM public.affiliate_memberships WHERE id=p_member),false) AS creator_ok
 ), facts AS MATERIALIZED (
  SELECT c.id,c.kind,c.eligible_at,c.dispute_seen,c.dispute_reviewed_at,pt.status,
   (c.observed_status<>pt.status OR c.observed_refunded_gross<>coalesce(pt.refunded_amount,0)
    OR coalesce(w.status<>'done' OR w.requested_generation>w.processed_generation,false)) AS dirty,
   EXISTS(SELECT 1 FROM public.affiliate_ledger l WHERE l.commission_id=c.id AND l.kind='accrual' AND l.created_at<=p_cutoff) AS earned,
   EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN public.affiliate_payout_allocations a ON a.entry_id=l.id AND a.released_at IS NULL
    JOIN public.affiliate_payouts p ON p.id=a.payout_id AND p.status='paid' WHERE l.commission_id=c.id) AS previously_paid
  FROM public.affiliate_commissions c JOIN public.payment_transactions pt ON pt.id=c.payment_id
  LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
  WHERE c.member_id=p_member AND c.currency=p_currency AND c.livemode=p_livemode
 ), entries AS MATERIALIZED (
  SELECT l.id,l.commission_id,l.kind,l.amount_minor,p.status AS allocation_status,
   coalesce(a.entry_id IS NULL AND public.affiliate_entry_eligible(f.kind,l.amount_minor,f.previously_paid,
    f.earned AND f.eligible_at<=p_cutoff AND ((NOT f.dispute_seen AND f.status<>'disputed') OR f.dispute_reviewed_at IS NOT NULL),
    g.referral_ok,g.creator_ok),false) AS selectable
  FROM public.affiliate_ledger l JOIN facts f ON f.id=l.commission_id CROSS JOIN gate g
  LEFT JOIN public.affiliate_payout_allocations a ON a.entry_id=l.id AND a.released_at IS NULL
  LEFT JOIN public.affiliate_payouts p ON p.id=a.payout_id
 ), totals AS (
  SELECT coalesce(sum(amount_minor) FILTER(WHERE selectable AND amount_minor>0),0) AS earnings,
   -coalesce(sum(amount_minor) FILTER(WHERE selectable AND amount_minor<0),0) AS debt,
   coalesce(sum(amount_minor) FILTER(WHERE kind='accrual'),0) AS accrued,
   -coalesce(sum(amount_minor) FILTER(WHERE kind IN ('reversal','restoration')),0) AS reversed,
   coalesce(sum(amount_minor) FILTER(WHERE allocation_status='reserved'),0) AS reserved,
   coalesce(sum(amount_minor),0) AS balance,
   coalesce(array_agg(id ORDER BY id) FILTER(WHERE selectable),'{}'::uuid[]) AS ids
  FROM entries
 ), held AS (
  SELECT coalesce(sum(greatest(amount,0)),0) AS amount FROM (
   SELECT sum(amount_minor) AS amount FROM entries WHERE allocation_status IS NULL AND NOT selectable GROUP BY commission_id
  ) h
 ), settlements AS (
  SELECT -coalesce(sum(l.amount_minor),0) AS amount FROM public.affiliate_ledger l
  JOIN public.affiliate_payouts p ON p.id=l.payout_id WHERE l.member_id=p_member AND l.currency=p_currency AND p.livemode=p_livemode
 ), readiness AS (SELECT coalesce(bool_or(dirty),false) AS dirty FROM facts)
 SELECT m.version::text,p.version::text,t.earnings::text,t.debt::text,(t.earnings-t.debt)::text,h.amount::text,
  p.thresholds->>p_currency,r.dirty,
  m.status='approved' AND m.user_id IS NOT NULL AND NOT r.dirty
   AND p_cutoff IS NOT NULL AND p_cutoff<=now() AND p.thresholds ? p_currency
   AND t.earnings-t.debt>0 AND t.earnings-t.debt>=(p.thresholds->>p_currency)::bigint
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_payouts ap WHERE ap.member_id=p_member AND ap.currency=p_currency AND ap.livemode=p_livemode AND ap.status='reserved'),
  t.ids,t.accrued::text,t.reversed::text,s.amount::text,t.reserved::text,(t.balance-s.amount)::text
 FROM public.affiliate_memberships m CROSS JOIN public.affiliate_programs p CROSS JOIN totals t
 CROSS JOIN held h CROSS JOIN settlements s CROSS JOIN readiness r WHERE m.id=p_member;
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_preview(uuid,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_preview(uuid,text,timestamptz,boolean) TO service_role;

-- The program switch now gates partner entries inside affiliate_preview, not the whole payout.
CREATE OR REPLACE FUNCTION public.affiliate_reserve(p_actor uuid,p_member uuid,p_currency text,p_cutoff timestamptz,p_member_version bigint,
 p_program_version bigint,p_payee_reference text,p_livemode boolean DEFAULT true)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $_$
DECLARE m public.affiliate_memberships; prog public.affiliate_programs; result public.affiliate_payouts; preview record; locked uuid[];
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO preview FROM public.affiliate_preview(p_member,p_currency,p_cutoff,p_livemode);
 locked:=public.affiliate_lock_member(p_member,p_currency,ARRAY(
  SELECT DISTINCT c.payment_id FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
   WHERE l.id=ANY(preview.entry_ids)),p_livemode);

 SELECT * INTO m FROM public.affiliate_memberships WHERE id=p_member FOR SHARE;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF m.id IS NULL OR m.version IS DISTINCT FROM p_member_version OR prog.version IS DISTINCT FROM p_program_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_livemode IS NULL OR m.status<>'approved' OR m.user_id IS NULL OR p_currency !~ '^[A-Z]{3}$'
  OR p_cutoff IS NULL OR p_cutoff>now() OR NOT(prog.thresholds ? p_currency) THEN
  RAISE EXCEPTION 'Payout unavailable' USING ERRCODE='22023'; END IF;
 SELECT * INTO preview FROM public.affiliate_preview(p_member,p_currency,p_cutoff,p_livemode);
 IF preview.sync_required OR EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
  WHERE l.id=ANY(preview.entry_ids) AND NOT(c.payment_id=ANY(locked))) THEN RAISE EXCEPTION 'Sync required' USING ERRCODE='PT409'; END IF;
 IF NOT preview.available THEN RAISE EXCEPTION 'Threshold not met' USING ERRCODE='22023'; END IF;
 INSERT INTO public.affiliate_payouts(member_id,currency,earnings_minor,status,cutoff,payee_reference,livemode)
  VALUES(p_member,p_currency,preview.payable_minor::bigint,'reserved',p_cutoff,p_payee_reference,p_livemode) RETURNING * INTO result;
 INSERT INTO public.affiliate_payout_allocations(payout_id,entry_id) SELECT result.id,unnest(preview.entry_ids);
 PERFORM public.affiliate_audit('affiliate_payouts',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $_$;
REVOKE EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) TO service_role;

-- CSV export of a reserved payout: every allocated entry must still pass the shared eligibility rule
-- (a reservation of co-creator shares exports while the partner program is off; partner shares do not).
CREATE FUNCTION public.affiliate_payout_exportable(p_payout uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce(bool_and(coalesce(public.affiliate_entry_eligible(c.kind,l.amount_minor,
   EXISTS(SELECT 1 FROM public.affiliate_ledger e JOIN public.affiliate_payout_allocations pa ON pa.entry_id=e.id AND pa.released_at IS NULL
    JOIN public.affiliate_payouts pp ON pp.id=pa.payout_id AND pp.status='paid' WHERE e.commission_id=c.id),
   true,coalesce((SELECT enabled FROM public.affiliate_programs),false),m.creator_accepted_at IS NOT NULL),false)),false)
 FROM public.affiliate_payouts p JOIN public.affiliate_memberships m ON m.id=p.member_id
 JOIN public.affiliate_payout_allocations a ON a.payout_id=p.id AND a.released_at IS NULL
 JOIN public.affiliate_ledger l ON l.id=a.entry_id JOIN public.affiliate_commissions c ON c.id=l.commission_id
 WHERE p.id=p_payout;
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_payout_exportable(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_payout_exportable(uuid) TO service_role;

-- Portal rows: product read through the purchased line (co-creator rows have no partner rule).
CREATE OR REPLACE FUNCTION public.affiliate_portal_page(p_member uuid,p_currency text DEFAULT NULL,p_cursor uuid DEFAULT NULL,p_limit integer DEFAULT 25,p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; creator_ok boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 SELECT coalesce((SELECT creator_accepted_at IS NOT NULL FROM public.affiliate_memberships WHERE id=p_member),false) INTO creator_ok;
 WITH page AS MATERIALIZED (
  SELECT c.* FROM public.affiliate_commissions c WHERE c.member_id=p_member AND (p_currency IS NULL OR c.currency=p_currency)
   AND (p_cursor IS NULL OR (c.paid_at,c.id)<(SELECT own.paid_at,own.id FROM public.affiliate_commissions own
    WHERE own.id=p_cursor AND own.member_id=p_member AND (p_currency IS NULL OR own.currency=p_currency)))
  ORDER BY c.paid_at DESC,c.id DESC LIMIT p_limit+1
 ), rows AS (
  SELECT c.id,c.paid_at,jsonb_build_object('product',coalesce(prod.name,li.product_name),'reference',c.id,'kind',c.kind,'currency',c.currency,'paid_at',c.paid_at,
   'eligible_at',c.eligible_at,'accrued_minor',c.accrued_minor::text,'current_minor',l.current::text,'livemode',c.livemode,
   'terms_required',c.kind='cocreator' AND NOT creator_ok,
   'status',CASE WHEN l.current<=0 THEN 'reversed' WHEN l.reserved THEN 'reserved' WHEN l.paid>=l.current THEN 'paid'
    WHEN c.eligible_at<=p_as_of AND ((NOT c.dispute_seen AND pt.status<>'disputed') OR c.dispute_reviewed_at IS NOT NULL)
     AND (c.kind<>'cocreator' OR creator_ok) THEN 'eligible' ELSE 'held' END,
   'sync_pending',c.observed_status<>pt.status OR c.observed_refunded_gross<>coalesce(pt.refunded_amount,0)
    OR coalesce(w.status<>'done' OR w.requested_generation>w.processed_generation,false),
   'needs_review',coalesce(w.status='needs_review',false) OR (c.dispute_seen AND c.dispute_reviewed_at IS NULL)) AS row
  FROM (SELECT * FROM page ORDER BY paid_at DESC,id DESC LIMIT p_limit) c
  JOIN public.payment_line_items li ON li.id=c.line_item_id LEFT JOIN public.products prod ON prod.id=li.product_id
  JOIN public.payment_transactions pt ON pt.id=c.payment_id LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
  CROSS JOIN LATERAL (
   SELECT coalesce(sum(e.amount_minor),0) AS current,coalesce(bool_or(p.status='reserved'),false) AS reserved,
    coalesce(sum(e.amount_minor) FILTER(WHERE p.status='paid'),0) AS paid
   FROM public.affiliate_ledger e LEFT JOIN public.affiliate_payout_allocations a ON a.entry_id=e.id AND a.released_at IS NULL
   LEFT JOIN public.affiliate_payouts p ON p.id=a.payout_id WHERE e.commission_id=c.id
  ) l
 ) SELECT jsonb_build_object('commissions',coalesce((SELECT jsonb_agg(row ORDER BY paid_at DESC,id DESC) FROM rows),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM rows ORDER BY paid_at,id LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_portal_page(uuid,text,uuid,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_portal_page(uuid,text,uuid,integer,timestamptz) TO service_role;

-- Portal summary adds the partner flag and the co-creator block (current shares + terms state).
CREATE OR REPLACE FUNCTION public.affiliate_portal_summary(p_member uuid,p_as_of timestamptz,p_livemode boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH balances AS (
  SELECT c.currency,v.* FROM (SELECT DISTINCT currency FROM public.affiliate_commissions WHERE member_id=p_member AND livemode=p_livemode) c
  CROSS JOIN LATERAL public.affiliate_preview(p_member,c.currency,p_as_of,p_livemode) v
 ), bindings AS MATERIALIZED (
  SELECT b.coupon_id,c.code,c.is_active,c.allowed_product_ids FROM public.affiliate_coupon_bindings b
  JOIN public.coupons c ON c.id=b.coupon_id WHERE b.member_id=p_member AND b.retired_at IS NULL
 ), rules AS (
  SELECT DISTINCT ON (r.product_id) r.*,p.name FROM public.affiliate_rules r JOIN public.products p ON p.id=r.product_id
  WHERE p.is_active AND p.product_type='one_time' AND EXISTS(SELECT 1 FROM bindings b WHERE b.is_active
   AND (coalesce(jsonb_array_length(b.allowed_product_ids),0)=0 OR b.allowed_product_ids ? r.product_id::text))
  ORDER BY r.product_id,r.revision DESC
 ), creator_rules AS (
  SELECT cr.*,p.name FROM (SELECT DISTINCT ON (r.product_id) r.* FROM public.affiliate_cocreator_rules r
   WHERE r.product_id IN (SELECT product_id FROM public.affiliate_cocreator_rules WHERE member_id=p_member)
   ORDER BY r.product_id,r.revision DESC) cr JOIN public.products p ON p.id=cr.product_id WHERE cr.member_id=p_member
 ), member AS (SELECT * FROM public.affiliate_memberships WHERE id=p_member),
 terms AS (SELECT * FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1)
 SELECT jsonb_build_object(
  'is_partner',coalesce((SELECT is_partner FROM member),true),
  'balances',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'accrued',accrued,'reversed',reversed,'paid',paid,'reserved',reserved,
   'held',held_minor,'eligible',greatest(payable_minor::numeric,0)::text,'debt',greatest(-payable_minor::numeric,0)::text,'balance',balance) ORDER BY currency) FROM balances),'[]'::jsonb),
  'codes',coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'active',is_active) ORDER BY code) FROM bindings),'[]'::jsonb),
  'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('product',name,'percentage_bps',percentage_bps,'fixed_minor',fixed_minor::text,'currency',currency,'enabled',enabled) ORDER BY name) FROM rules),'[]'::jsonb),
  'creator',jsonb_build_object(
   'active',EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules WHERE member_id=p_member),
   'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('product',name,'percentage_bps',percentage_bps,'fixed_minor',fixed_minor::text,'currency',currency) ORDER BY name) FROM creator_rules),'[]'::jsonb),
   'accepted_version',(SELECT creator_terms_version FROM member),'accepted_at',(SELECT creator_accepted_at FROM member),
   'terms',(SELECT jsonb_build_object('version',terms_version,'en',terms->>'en','pl',terms->>'pl') FROM terms)),
  'sync_pending',EXISTS(SELECT 1 FROM balances WHERE sync_required),
  'needs_review',EXISTS(SELECT 1 FROM public.affiliate_payouts WHERE member_id=p_member AND livemode=p_livemode AND needs_review)
   OR EXISTS(SELECT 1 FROM public.affiliate_commissions c LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
    WHERE c.member_id=p_member AND c.livemode=p_livemode AND (w.status='needs_review' OR (c.dispute_seen AND c.dispute_reviewed_at IS NULL))))
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) TO service_role;

-- commission.* webhooks say which share it is.
CREATE OR REPLACE FUNCTION public.capture_commission_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; pid uuid; event text := CASE NEW.kind WHEN 'accrual' THEN 'accrued' ELSE 'reversed' END;
BEGIN
  IF NEW.kind NOT IN ('accrual','reversal') THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.commission_id;
  SELECT coalesce(l.product_id,t.product_id) INTO pid FROM public.payment_transactions t
    LEFT JOIN public.payment_line_items l ON l.id=c.line_item_id WHERE t.id=c.payment_id;
  PERFORM public.record_business_event('commission.'||event,pid,jsonb_build_object(
    'amountUnit','minor',
    'commission',jsonb_build_object('id',c.id,'ledgerEntryId',NEW.id,'kind',c.kind,'amount',NEW.amount_minor,'currency',NEW.currency,
      'baseAmount',c.base_minor,'accruedAmount',c.accrued_minor,'paidAt',c.paid_at,'eligibleAt',c.eligible_at,
      'selfReferral',c.self_referral,'livemode',c.livemode),
    'partner',public.business_event_partner(NEW.member_id),
    'order',public.business_event_order(c.payment_id)),
    'commission.'||event||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.capture_commission_event() FROM PUBLIC,anon,authenticated;

-- Deletion impact counts co-creator rules and every commission on the product's lines.
CREATE OR REPLACE FUNCTION public.product_deletion_impact(p_product_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH orders AS (
    SELECT id FROM public.payment_transactions WHERE product_id = p_product_id
    UNION SELECT transaction_id FROM public.payment_line_items WHERE product_id = p_product_id
  ), counts AS (
    SELECT (SELECT count(*) FROM orders) AS orders,
      (SELECT count(*) FROM public.invoices WHERE transaction_id IN (SELECT id FROM orders)) AS invoices,
      (SELECT count(*) FROM public.issued_licenses WHERE product_id = p_product_id) AS licenses,
      (SELECT count(*) FROM public.user_product_access WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.guest_purchases WHERE product_id = p_product_id AND claimed_by_user_id IS NULL) AS accesses,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id) AS subscriptions,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id
        AND status IN ('trialing', 'active', 'past_due', 'incomplete')) AS active_subscriptions,
      (SELECT count(*) FROM public.seat_reservations r JOIN public.product_sessions s ON s.id = r.session_id
        WHERE s.product_id = p_product_id AND coalesce(s.ends_at, s.starts_at) > now()
          AND (r.status = 'confirmed' OR (r.status = 'held' AND (r.expires_at IS NULL OR r.expires_at > now())))) AS future_reservations,
      (SELECT count(*) FROM public.affiliate_rules WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.affiliate_cocreator_rules WHERE product_id = p_product_id) AS affiliate_rules,
      (SELECT count(*) FROM public.affiliate_commissions c JOIN public.payment_line_items li ON li.id = c.line_item_id
        WHERE li.product_id = p_product_id) AS affiliate_commissions,
      (SELECT count(*) FROM public.bundle_items WHERE component_product_id = p_product_id) AS bundles
  )
  SELECT jsonb_build_object('orders', orders, 'invoices', invoices, 'licenses', licenses, 'accesses', accesses,
    'subscriptions', subscriptions, 'activeSubscriptions', active_subscriptions, 'futureReservations', future_reservations,
    'affiliateRules', affiliate_rules, 'affiliateCommissions', affiliate_commissions, 'bundles', bundles,
    'hasHistory', orders > 0 OR licenses > 0 OR accesses > 0 OR subscriptions > 0 OR affiliate_rules > 0)
  FROM counts;
$$;
REVOKE EXECUTE ON FUNCTION public.product_deletion_impact(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.product_deletion_impact(uuid) TO service_role;
