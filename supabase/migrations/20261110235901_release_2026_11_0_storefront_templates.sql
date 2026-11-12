

CREATE FUNCTION public.affiliate_portal_summary(p_member uuid,p_as_of timestamptz,p_livemode boolean DEFAULT true)
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
 ) SELECT jsonb_build_object(
  'balances',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'accrued',accrued,'reversed',reversed,'paid',paid,'reserved',reserved,
   'held',held_minor,'eligible',greatest(payable_minor::numeric,0)::text,'debt',greatest(-payable_minor::numeric,0)::text,'balance',balance) ORDER BY currency) FROM balances),'[]'::jsonb),
  'codes',coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'active',is_active) ORDER BY code) FROM bindings),'[]'::jsonb),
  'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('product',name,'percentage_bps',percentage_bps,'fixed_minor',fixed_minor::text,'currency',currency,'enabled',enabled) ORDER BY name) FROM rules),'[]'::jsonb),
  'sync_pending',EXISTS(SELECT 1 FROM balances WHERE sync_required),
  'needs_review',EXISTS(SELECT 1 FROM public.affiliate_payouts WHERE member_id=p_member AND livemode=p_livemode AND needs_review)
   OR EXISTS(SELECT 1 FROM public.affiliate_commissions c LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
    WHERE c.member_id=p_member AND c.livemode=p_livemode AND (w.status='needs_review' OR (c.dispute_seen AND c.dispute_reviewed_at IS NULL))))
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) TO service_role;

CREATE FUNCTION public.affiliate_reserve(p_actor uuid,p_member uuid,p_currency text,p_cutoff timestamptz,p_member_version bigint,p_program_version bigint,p_payee_reference text,p_livemode boolean DEFAULT true)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
 IF p_livemode IS NULL OR m.status<>'approved' OR m.user_id IS NULL OR NOT prog.enabled OR p_currency !~ '^[A-Z]{3}$'
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
END $$;
CREATE FUNCTION public.affiliate_mark_paid(p_actor uuid,p_payout uuid,p_expected_version bigint,p_bank_reference text,p_invoice_reference text,
 p_bank_amount_minor bigint,p_currency text,p_paid_at timestamptz,p_full_settlement boolean,p_reason text DEFAULT NULL,p_evidence_reference text DEFAULT NULL,p_livemode boolean DEFAULT true)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_payouts; result public.affiliate_payouts;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout;
 PERFORM public.affiliate_lock_member(old.member_id,old.currency,ARRAY(
  SELECT DISTINCT c.payment_id FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id
   JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE a.payout_id=old.id AND a.released_at IS NULL),old.livemode);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout FOR UPDATE;
 IF old.livemode IS DISTINCT FROM p_livemode THEN RAISE EXCEPTION 'Stripe mode changed' USING ERRCODE='PT409'; END IF;
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
 PERFORM public.affiliate_lock_member(old.member_id,old.currency,ARRAY(
  SELECT DISTINCT c.payment_id FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id
   JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE a.payout_id=old.id AND a.released_at IS NULL),old.livemode);
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
 PERFORM public.affiliate_lock_member(c.member_id,c.currency,ARRAY[c.payment_id],c.livemode);
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
GRANT SELECT,INSERT ON public.affiliate_programs TO service_role;

ALTER TABLE public.affiliate_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_memberships_service ON public.affiliate_memberships FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_memberships FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_memberships TO service_role;

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

REVOKE EXECUTE ON FUNCTION public.affiliate_lock_member(uuid,text,uuid[],boolean) FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_mark_paid(uuid,uuid,bigint,text,text,bigint,text,timestamptz,boolean,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_mark_paid(uuid,uuid,bigint,text,text,bigint,text,timestamptz,boolean,text,text,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_cancel_payout(uuid,uuid,bigint,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_cancel_payout(uuid,uuid,bigint,boolean,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_manual_adjustment(uuid,uuid,bigint,bigint,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_manual_adjustment(uuid,uuid,bigint,bigint,text,text,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_work_retry(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_work_retry(uuid,uuid,bigint,text) TO service_role;

CREATE TRIGGER affiliate_binding_period BEFORE INSERT OR UPDATE ON public.affiliate_coupon_bindings
FOR EACH ROW EXECUTE FUNCTION public.affiliate_binding_check();
REVOKE EXECUTE ON FUNCTION public.affiliate_binding_check() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER affiliate_program_versions_guard BEFORE UPDATE OR DELETE ON public.affiliate_program_versions
 FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();
CREATE TRIGGER affiliate_membership_events_guard BEFORE UPDATE OR DELETE ON public.affiliate_membership_events
 FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();
ALTER TABLE public.affiliate_program_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_program_versions_service ON public.affiliate_program_versions FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_program_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_program_versions TO service_role;
ALTER TABLE public.affiliate_membership_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_membership_events_service ON public.affiliate_membership_events FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_membership_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_membership_events TO service_role;

-- ===== Source: 20261016223736_storefront_a_contract.sql =====
-- D-057: additive Phase 2 subset; the released RC migration stays immutable.
-- validator-patterns:start
CREATE OR REPLACE FUNCTION public.jsonschema_subset_pattern(pattern text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $patterns$
  SELECT CASE pattern
    WHEN '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' THEN '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    WHEN '^[^<>]*$' THEN '^[^<>]*$'
    WHEN '^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::443)?(?:\/[a-zA-Z0-9/_-]*)?$' THEN '^https://(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::443)?(?:/[a-zA-Z0-9/_-]*)?$'
    WHEN '^[a-z][a-z0-9-]{0,63}$' THEN '^[a-z][a-z0-9-]{0,63}$'
    WHEN '^#[0-9A-Fa-f]{6}$' THEN '^#[0-9A-Fa-f]{6}$'
    WHEN '^(?![\s\S]*<[^>]*>)[\s\S]*$' THEN '^(?!.*<[^>]*>).*$'
    WHEN '^(?![\s\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\/\/|[wW][wW][wW]\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\u20AC\u00A3]\s*\d|\d\s*(?:USD|EUR|PLN|GBP|z\u0142)|[\u0000\uFEFF\uFFFD]))[\s\S]*$' THEN '^(?!.*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|://|[wW][wW][wW]\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$€£][\u0009-\u000d\u0020\u00a0\u2003\u2029\ufeff]*[0-9]|[0-9][\u0009-\u000d\u0020\u00a0\u2003\u2029\ufeff]*(?:USD|EUR|PLN|GBP|zł)|[﻿�])).*$'
    ELSE NULL END;
$patterns$;
REVOKE EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) TO service_role;
-- validator-patterns:end

CREATE OR REPLACE FUNCTION public.jsonschema_subset_walk(schema jsonb, instance jsonb, depth integer, budget integer)
RETURNS TABLE (valid boolean, remaining integer)
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  keyword text; child jsonb; property record; result record;
  kind text := pg_catalog.jsonb_typeof(instance); matched boolean; expression text;
BEGIN
  valid := false; remaining := budget - 1;
  <<validate>> BEGIN
    IF depth > 32 OR remaining < 0 OR pg_catalog.jsonb_typeof(schema) <> 'object' THEN EXIT validate; END IF;
    FOR keyword IN SELECT pg_catalog.jsonb_object_keys(schema) LOOP
      IF keyword NOT IN ('type','properties','required','additionalProperties','items','anyOf','enum','const',
        'maxLength','minItems','maxItems','uniqueItems','pattern','format','default') THEN EXIT validate; END IF;
    END LOOP;
    IF schema ? 'type' THEN
      IF schema->>'type' = 'integer' THEN
        IF kind <> 'number' OR (instance::text)::numeric <> pg_catalog.trunc((instance::text)::numeric) THEN EXIT validate; END IF;
      ELSIF schema->>'type' NOT IN ('object','array','string','number','boolean','null') OR kind <> schema->>'type' THEN EXIT validate;
      END IF;
    END IF;
    IF schema ? 'const' AND instance <> schema->'const' THEN EXIT validate; END IF;
    IF schema ? 'enum' AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(schema->'enum') item WHERE item=instance) THEN EXIT validate; END IF;
    IF schema ? 'anyOf' THEN
      matched := false;
      FOR child IN SELECT value FROM pg_catalog.jsonb_array_elements(schema->'anyOf') LOOP
        SELECT * INTO result FROM public.jsonschema_subset_walk(child,instance,depth+1,remaining);
        remaining := result.remaining;
        IF remaining < 0 THEN EXIT validate; END IF;
        IF result.valid THEN matched := true; EXIT; END IF;
      END LOOP;
      IF NOT matched THEN EXIT validate; END IF;
    END IF;
    IF kind = 'object' THEN
      IF schema ? 'required' AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(schema->'required') required WHERE NOT instance ? required) THEN EXIT validate; END IF;
      FOR property IN SELECT * FROM pg_catalog.jsonb_each(instance) LOOP
        child := schema->'properties'->property.key;
        IF child IS NULL THEN
          IF schema->'additionalProperties' = 'false'::jsonb THEN EXIT validate; END IF;
          IF pg_catalog.jsonb_typeof(schema->'additionalProperties') = 'object' THEN child := schema->'additionalProperties'; END IF;
        END IF;
        IF child IS NOT NULL THEN
          SELECT * INTO result FROM public.jsonschema_subset_walk(child,property.value,depth+1,remaining);
          remaining := result.remaining;
          IF NOT result.valid THEN EXIT validate; END IF;
        END IF;
      END LOOP;
    ELSIF kind = 'array' THEN
      IF schema ? 'minItems' AND pg_catalog.jsonb_array_length(instance) < (schema->>'minItems')::numeric THEN EXIT validate; END IF;
      IF schema ? 'maxItems' AND pg_catalog.jsonb_array_length(instance) > (schema->>'maxItems')::numeric THEN EXIT validate; END IF;
      IF schema->'uniqueItems' = 'true'::jsonb AND
        (SELECT count(*) <> count(DISTINCT value) FROM pg_catalog.jsonb_array_elements(instance)) THEN EXIT validate; END IF;
      IF schema ? 'items' THEN
        FOR child IN SELECT value FROM pg_catalog.jsonb_array_elements(instance) LOOP
          SELECT * INTO result FROM public.jsonschema_subset_walk(schema->'items',child,depth+1,remaining);
          remaining := result.remaining;
          IF NOT result.valid THEN EXIT validate; END IF;
        END LOOP;
      END IF;
    ELSIF kind = 'string' THEN
      IF schema ? 'maxLength' AND pg_catalog.char_length(instance #>> '{}') > (schema->>'maxLength')::numeric THEN EXIT validate; END IF;
      IF schema ? 'pattern' THEN
        expression := public.jsonschema_subset_pattern(schema->>'pattern');
        -- C collation avoids locale expansion of ASCII ranges. Default PG regex
        -- mode is newline-insensitive: '.' also matches line terminators.
        IF expression IS NULL OR NOT ((instance #>> '{}') COLLATE pg_catalog."C" ~ expression) THEN EXIT validate; END IF;
      END IF;
      -- pg_jsonschema 0.3.3 treats format as annotation (including uuid).
      -- Only this emitted format is admitted by the generator.
      IF schema ? 'format' AND schema->>'format' <> 'uuid' THEN EXIT validate; END IF;
    END IF;
    -- 'default' is an annotation; missing properties are never filled in.
    valid := true;
  END validate;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.jsonschema_subset_walk(jsonb,jsonb,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonschema_subset_walk(jsonb,jsonb,integer,integer) TO service_role;

-- Installed offer-led storefront configuration.
-- storefront-schema:start (generated by generate-storefront-schema.ts)
CREATE OR REPLACE FUNCTION public.storefront_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '{"type":"object","properties":{"format":{"type":"number","const":1},"templateId":{"type":"string","enum":["default","d","storefront-a"]},"settingsByTemplate":{"type":"object","properties":{"d":{"type":"object","properties":{"heroProduct":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"closingProduct":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"starterProducts":{"maxItems":3,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"uniqueItems":true},"taskCategories":{"maxItems":12,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"uniqueItems":true},"density":{"type":"string","enum":["comfortable","compact"]}},"additionalProperties":false},"default":{"type":"object","properties":{},"additionalProperties":false},"storefront-a":{"type":"object","properties":{"heroProduct":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"starterProducts":{"maxItems":3,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"uniqueItems":true},"taskCategories":{"maxItems":12,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"uniqueItems":true},"density":{"type":"string","enum":["comfortable","compact"]},"comparisonProducts":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}}},"additionalProperties":false}},"additionalProperties":false},"overridesByTemplate":{"type":"object","properties":{"d":{"type":"object","properties":{"order":{"maxItems":32,"type":"array","items":{"type":"string","enum":["hero","tasks","start","catalogue","faq","closing"]},"uniqueItems":true},"sections":{"type":"object","properties":{"hero":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["split-process","simple"]}},"additionalProperties":false},"tasks":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]}},"additionalProperties":false},"start":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]},"variant":{"type":"string","enum":["detail-cards","compact"]}},"additionalProperties":false},"catalogue":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["detail-cards","default-groups"]}},"additionalProperties":false},"faq":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]}},"additionalProperties":false},"closing":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"}},"additionalProperties":false}},"additionalProperties":false}},"additionalProperties":false},"default":{"type":"object","properties":{"order":{"maxItems":32,"type":"array","items":{"type":"string","enum":["catalogue"]},"uniqueItems":true},"sections":{"type":"object","properties":{"catalogue":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["detail-cards","default-groups"]}},"additionalProperties":false}},"additionalProperties":false}},"additionalProperties":false},"storefront-a":{"type":"object","properties":{"order":{"maxItems":32,"type":"array","items":{"type":"string","enum":["hero","tasks","comparison","start","catalogue","faq","closing"]},"uniqueItems":true},"sections":{"type":"object","properties":{"hero":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["offer-focus"]}},"additionalProperties":false},"tasks":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]}},"additionalProperties":false},"comparison":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["comparison"]}},"additionalProperties":false},"start":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]},"variant":{"type":"string","enum":["detail-cards","compact"]}},"additionalProperties":false},"catalogue":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["compact"]}},"additionalProperties":false},"faq":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]}},"additionalProperties":false},"closing":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["catalogue-link"]}},"additionalProperties":false}},"additionalProperties":false}},"additionalProperties":false}},"additionalProperties":false},"content":{"type":"object","properties":{"home.hero":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"mediaCaption":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"stepDetails":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"staticDemo":{"type":"object","properties":{"title":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"required":["title","body"],"additionalProperties":false}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"mediaCaption":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"stepDetails":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"staticDemo":{"type":"object","properties":{"title":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"required":["title","body"],"additionalProperties":false}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"mediaCaption":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"stepDetails":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"staticDemo":{"type":"object","properties":{"title":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"required":["title","body"],"additionalProperties":false}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"mediaCaption":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"stepDetails":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"staticDemo":{"type":"object","properties":{"title":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"}},"required":["title","body"],"additionalProperties":false}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.tasks":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.starts":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.faq":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.closing":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.comparison":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"comparison"},"actionLabel":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^[^<>]*$"},"items":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"object","properties":{"productId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"},"bullets":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^[^<>]*$"}}},"required":["productId","eyebrow","heading","body","bullets"],"additionalProperties":false}}},"required":["kind","heading","body","items"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"comparison"},"actionLabel":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^[^<>]*$"},"items":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"object","properties":{"productId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"},"bullets":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^[^<>]*$"}}},"required":["productId","eyebrow","heading","body","bullets"],"additionalProperties":false}}},"required":["kind","heading","body","items"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"comparison"},"actionLabel":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^[^<>]*$"},"items":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"object","properties":{"productId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"},"bullets":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^[^<>]*$"}}},"required":["productId","eyebrow","heading","body","bullets"],"additionalProperties":false}}},"required":["kind","heading","body","items"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"comparison"},"actionLabel":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^[^<>]*$"},"items":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"object","properties":{"productId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^[^<>]*$"},"body":{"type":"string","maxLength":1000,"pattern":"^[^<>]*$"},"bullets":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^[^<>]*$"}}},"required":["productId","eyebrow","heading","body","bullets"],"additionalProperties":false}}},"required":["kind","heading","body","items"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.catalogue":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^[^<>]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]}},"additionalProperties":false},"tokens":{"anyOf":[{"type":"object","properties":{"format":{"type":"number","const":1},"light":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"additionalProperties":false},"dark":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"additionalProperties":false},"typography":{"type":"object","properties":{"font":{"type":"string","enum":["geist","dm-sans"]},"bodyWeight":{"anyOf":[{"type":"number","const":400},{"type":"number","const":500}]},"headingWeight":{"anyOf":[{"type":"number","const":500},{"type":"number","const":600},{"type":"number","const":700}]},"baseSizePx":{"anyOf":[{"type":"number","const":16},{"type":"number","const":17},{"type":"number","const":18}]},"headingLetterSpacingEm":{"anyOf":[{"type":"number","const":-0.02},{"type":"number","const":-0.01},{"type":"number","const":0}]}},"additionalProperties":false},"shapes":{"type":"object","properties":{"radiusSmPx":{"anyOf":[{"type":"number","const":0},{"type":"number","const":4},{"type":"number","const":8}]},"radiusMdPx":{"anyOf":[{"type":"number","const":4},{"type":"number","const":8},{"type":"number","const":12}]},"radiusLgPx":{"anyOf":[{"type":"number","const":8},{"type":"number","const":12},{"type":"number","const":16},{"type":"number","const":24}]}},"additionalProperties":false}},"required":["format"],"additionalProperties":false},{"type":"null"}]}},"required":["format","templateId","settingsByTemplate","overridesByTemplate","content","tokens"],"additionalProperties":false}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_schema() TO service_role;
-- storefront-schema:end

CREATE OR REPLACE FUNCTION public.storefront_config_valid(config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF public.jsonschema_subset_matches(public.storefront_config_schema(), config) IS DISTINCT FROM true THEN RETURN false; END IF;
  IF EXISTS (
    WITH RECURSIVE nodes(value, depth) AS (
      SELECT config, 0 UNION ALL
      SELECT child.value, nodes.depth + 1 FROM nodes CROSS JOIN LATERAL (
        SELECT value FROM pg_catalog.jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
        UNION ALL SELECT value FROM pg_catalog.jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
      ) child WHERE nodes.depth <= 12
    ) SELECT 1 FROM nodes WHERE depth > 12 OR
      (jsonb_typeof(value)='string' AND (value #>> '{}') ~ U&'[\FEFF\FFFD]') OR
      (jsonb_typeof(value)='object' AND value ?| ARRAY['__proto__','prototype','constructor'])
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config->'content') slot CROSS JOIN LATERAL pg_catalog.jsonb_each(slot.value) locale
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(locale.value->'items','[]'::jsonb)) item
    WHERE locale.key IN ('en','pl') GROUP BY slot.key, locale.key
    HAVING count(*) <> count(DISTINCT CASE WHEN locale.value->>'kind' = 'comparison' THEN item->>'productId' ELSE item->>'id' END)
  ) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_valid(jsonb) TO service_role;

-- ===== Source: 20261016231500_template_credentials.sql =====
-- Per-template credentials, independent of presentation snapshots.
CREATE TABLE public.template_credentials (
  template_id text PRIMARY KEY CHECK (template_id IN ('storefront-a','storefront-b','storefront-c')),
  encrypted_key text,
  encryption_iv text,
  encryption_tag text,
  state text NOT NULL DEFAULT 'missing' CHECK (state IN ('valid','missing','expired','revoked','invalid','unknown')),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT template_credentials_value CHECK (
    (state='missing' AND encrypted_key IS NULL AND encryption_iv IS NULL AND encryption_tag IS NULL AND verified_at IS NULL) OR
    (state<>'missing' AND encrypted_key IS NOT NULL AND encryption_iv IS NOT NULL AND encryption_tag IS NOT NULL AND
      length(encrypted_key) BETWEEN 4 AND 21848 AND encrypted_key ~ '^[A-Za-z0-9+/]+={0,2}$' AND
      octet_length(decode(encrypted_key,'base64')) BETWEEN 1 AND 16384 AND
      length(encryption_iv)=24 AND octet_length(decode(encryption_iv,'base64'))=16 AND
      length(encryption_tag)=24 AND octet_length(decode(encryption_tag,'base64'))=16)
  ),
  CONSTRAINT template_credentials_verification CHECK (state<>'valid' OR verified_at IS NOT NULL)
);
ALTER TABLE public.template_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.template_credentials FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.template_credentials TO service_role;
CREATE POLICY template_credentials_service_read ON public.template_credentials FOR SELECT TO service_role
  USING ((SELECT auth.role())='service_role');

CREATE FUNCTION public.save_template_credential(template_id text, encrypted_key text, encryption_iv text, encryption_tag text,
  actor_user_id uuid DEFAULT NULL, actor_method text DEFAULT NULL, actor_api_key_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_id uuid; key_record public.api_keys%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
  SELECT id INTO owner_id FROM public.admin_users WHERE user_id=actor_user_id FOR SHARE;
  IF owner_id IS NULL OR actor_method IS NULL OR actor_method NOT IN ('session','api_key') OR
    (actor_method='session' AND actor_api_key_id IS NOT NULL) THEN
    RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
  END IF;
  IF actor_method='api_key' THEN
    SELECT * INTO key_record FROM public.api_keys WHERE id=actor_api_key_id FOR SHARE;
    IF NOT FOUND OR key_record.admin_user_id IS DISTINCT FROM owner_id OR key_record.revoked_at IS NOT NULL OR
      (NOT key_record.is_active AND (key_record.rotation_grace_until IS NULL OR key_record.rotation_grace_until<=clock_timestamp())) OR
      (key_record.expires_at IS NOT NULL AND key_record.expires_at<=clock_timestamp()) OR
      NOT (key_record.scopes @> '["templates:write"]'::jsonb) THEN
      RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
    END IF;
  END IF;
  IF template_id IS NULL OR template_id NOT IN ('storefront-a','storefront-b','storefront-c') OR
    encrypted_key IS NULL OR encryption_iv IS NULL OR encryption_tag IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','INVALID');
  END IF;
  INSERT INTO public.template_credentials AS stored(template_id,encrypted_key,encryption_iv,encryption_tag,state,verified_at)
    VALUES(template_id,encrypted_key,encryption_iv,encryption_tag,'unknown',NULL)
    ON CONFLICT ON CONSTRAINT template_credentials_pkey DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,
      encryption_iv=EXCLUDED.encryption_iv,encryption_tag=EXCLUDED.encryption_tag,state='unknown',verified_at=NULL,updated_at=clock_timestamp();
  INSERT INTO public.audit_log(table_name,operation,user_id,performed_by,new_values)
    VALUES('template_credentials','UPDATE',actor_user_id,actor_user_id,jsonb_build_object(
      'templateId',template_id,'state','unknown','scope','templates:write','actor_method',actor_method,'actor_api_key_id',actor_api_key_id));
  RETURN jsonb_build_object('success',true,'status',jsonb_build_object('templateId',template_id,'state','unknown','verifiedAt',NULL));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'code','UNAVAILABLE');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_template_credential(text,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_template_credential(text,text,text,text,uuid,text,uuid) TO service_role;

-- ===== Source: 20261016231510_template_credential_status.sql =====
-- Background verification applies only to the credential that was checked.
CREATE FUNCTION public.record_template_credential_status(template_id text, expected_key text, expected_iv text,
  expected_tag text, verification_state text, checked_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR verification_state IS NULL OR
    verification_state NOT IN ('valid','expired','revoked','invalid','unknown') OR
    checked_at IS NULL OR checked_at > clock_timestamp() OR checked_at < clock_timestamp() - interval '60 seconds' THEN
    RETURN false;
  END IF;
  UPDATE public.template_credentials AS stored SET state=verification_state,
    verified_at=CASE WHEN verification_state='unknown' THEN NULL ELSE checked_at END
    WHERE stored.template_id=record_template_credential_status.template_id AND stored.encrypted_key=expected_key AND
      stored.encryption_iv=expected_iv AND stored.encryption_tag=expected_tag AND
      (stored.verified_at IS NULL OR stored.verified_at<=checked_at) AND
      (stored.state<>'revoked' OR verification_state='revoked');
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('template_credentials','UPDATE',
    jsonb_build_object('templateId',template_id,'state',verification_state,'source','background'));
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_template_credential_status(text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_template_credential_status(text,text,text,text,text,timestamptz) TO service_role;

-- ===== Source: 20261016232157_product_offer_snapshots.sql =====
-- Product-scoped offer presentation snapshots. @see supabase/tests/product-offers.sql
-- offer-schema:start
CREATE FUNCTION public.product_offer_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '{"type":"object","properties":{"format":{"type":"number","const":1},"enabled":{"type":"boolean"},"templateId":{"type":"string","const":"offer-default"},"settings":{"type":"object","properties":{"density":{"type":"string","enum":["comfortable","compact"]}},"required":["density"],"additionalProperties":false},"content":{"type":"object","properties":{"offer.hero":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"offer.faq":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"offer.closing":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]}},"additionalProperties":false},"tokens":{"anyOf":[{"type":"object","properties":{"format":{"type":"number","const":1},"light":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"required":["background","foreground","accent","accentForeground","muted","mutedForeground","border"],"additionalProperties":false},"dark":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"required":["background","foreground","accent","accentForeground","muted","mutedForeground","border"],"additionalProperties":false},"typography":{"type":"object","properties":{"font":{"type":"string","enum":["geist","dm-sans"]},"bodyWeight":{"anyOf":[{"type":"number","const":400},{"type":"number","const":500}]},"headingWeight":{"anyOf":[{"type":"number","const":500},{"type":"number","const":600},{"type":"number","const":700}]},"baseSizePx":{"anyOf":[{"type":"number","const":16},{"type":"number","const":17},{"type":"number","const":18}]},"headingLetterSpacingEm":{"anyOf":[{"type":"number","const":-0.02},{"type":"number","const":-0.01},{"type":"number","const":0}]}},"required":["font","bodyWeight","headingWeight","baseSizePx","headingLetterSpacingEm"],"additionalProperties":false},"shapes":{"type":"object","properties":{"radiusSmPx":{"anyOf":[{"type":"number","const":0},{"type":"number","const":4},{"type":"number","const":8}]},"radiusMdPx":{"anyOf":[{"type":"number","const":4},{"type":"number","const":8},{"type":"number","const":12}]},"radiusLgPx":{"anyOf":[{"type":"number","const":8},{"type":"number","const":12},{"type":"number","const":16},{"type":"number","const":24}]}},"required":["radiusSmPx","radiusMdPx","radiusLgPx"],"additionalProperties":false}},"required":["format","light","dark","typography","shapes"],"additionalProperties":false},{"type":"null"}]}},"required":["format","enabled","templateId","settings","content","tokens"],"additionalProperties":false}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.product_offer_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_offer_config_schema() TO service_role;
-- offer-schema:end

CREATE FUNCTION public.product_offer_config_valid(config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF public.jsonschema_subset_matches(public.product_offer_config_schema(), config) IS DISTINCT FROM true THEN RETURN false; END IF;
  IF EXISTS (
    WITH RECURSIVE nodes(value, depth) AS (
      SELECT config, 0 UNION ALL
      SELECT child.value, nodes.depth + 1 FROM nodes CROSS JOIN LATERAL (
        SELECT value FROM pg_catalog.jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
        UNION ALL SELECT value FROM pg_catalog.jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
      ) child WHERE nodes.depth <= 12
    ) SELECT 1 FROM nodes WHERE depth > 12 OR
      (jsonb_typeof(value)='string' AND (value #>> '{}') ~ U&'[\FEFF\FFFD]') OR
      (jsonb_typeof(value)='object' AND value ?| ARRAY['__proto__','prototype','constructor'])
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config->'content') slot CROSS JOIN LATERAL pg_catalog.jsonb_each(slot.value) locale
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(locale.value->'items','[]'::jsonb)) item
    WHERE locale.key IN ('en','pl') GROUP BY slot.key, locale.key
    HAVING count(*) <> count(DISTINCT item->>'id')
  ) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.product_offer_config_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_offer_config_valid(jsonb) TO service_role;

CREATE TABLE public.product_offer_config (
 product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
 draft jsonb,
 published jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 CHECK (draft IS NULL OR (octet_length(draft::text) <= 102400 AND public.product_offer_config_valid(draft))),
 CHECK (published IS NULL OR (octet_length(published::text) <= 102400 AND public.product_offer_config_valid(published)))
);
CREATE TABLE public.product_offer_history (
 product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
 operation text NOT NULL CHECK (operation IN ('draft','publish','rollback','reset')),
 draft jsonb,
 published jsonb,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 restored_from bigint CHECK (restored_from BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY (product_id,revision),
 FOREIGN KEY (product_id,restored_from) REFERENCES public.product_offer_history(product_id,revision) ON DELETE NO ACTION,
 CHECK (draft IS NULL OR (octet_length(draft::text) <= 102400 AND public.product_offer_config_valid(draft))),
 CHECK (published IS NULL OR (octet_length(published::text) <= 102400 AND public.product_offer_config_valid(published)))
);
CREATE INDEX product_offer_updated_by ON public.product_offer_config(updated_by);
CREATE INDEX product_offer_history_actor ON public.product_offer_history(actor_id);
CREATE INDEX product_offer_history_restored ON public.product_offer_history(product_id,restored_from);
ALTER TABLE public.product_offer_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_offer_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY offer_config_admin_read ON public.product_offer_config FOR SELECT TO authenticated USING ((select public.is_admin()));
CREATE POLICY offer_history_admin_read ON public.product_offer_history FOR SELECT TO authenticated USING ((select public.is_admin()));
CREATE POLICY offer_config_service ON public.product_offer_config FOR ALL TO service_role
 USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
CREATE POLICY offer_history_service_read ON public.product_offer_history FOR SELECT TO service_role USING ((select auth.role()) = 'service_role');
CREATE POLICY offer_history_service_insert ON public.product_offer_history FOR INSERT TO service_role WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.product_offer_config FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.product_offer_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.product_offer_config TO authenticated;
GRANT SELECT ON public.product_offer_history TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.product_offer_config TO service_role;
GRANT SELECT,INSERT ON public.product_offer_history TO service_role;

-- ===== Source: 20261016232943_product_offer_lifecycle.sql =====
-- Atomic product offer lifecycle. @see supabase/tests/product-offer-lifecycle.sql
CREATE FUNCTION public.mutate_product_offer(offer_product_id uuid, expected_revision bigint, operation text, validated_config jsonb,
 restored_from bigint DEFAULT NULL, actor_user_id uuid DEFAULT NULL, actor_method text DEFAULT NULL, actor_api_key_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 current_config public.product_offer_config%ROWTYPE;
 owner_id uuid; key_record public.api_keys%ROWTYPE; required_scope text;
 next_draft jsonb; next_published jsonb; candidate jsonb; product_public boolean;
BEGIN
 IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 SELECT id INTO owner_id FROM public.admin_users WHERE user_id=actor_user_id FOR SHARE;
 IF owner_id IS NULL OR actor_method IS NULL OR actor_method NOT IN ('session','api_key') OR
   (actor_method='session' AND actor_api_key_id IS NOT NULL) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 required_scope := CASE WHEN operation IN ('publish','rollback') THEN 'templates:activate' ELSE 'templates:write' END;
 IF actor_method='api_key' THEN
   SELECT * INTO key_record FROM public.api_keys WHERE id=actor_api_key_id FOR SHARE;
   IF NOT FOUND OR key_record.admin_user_id IS DISTINCT FROM owner_id OR key_record.revoked_at IS NOT NULL OR
     (NOT key_record.is_active AND (key_record.rotation_grace_until IS NULL OR key_record.rotation_grace_until <= clock_timestamp())) OR
     (key_record.expires_at IS NOT NULL AND key_record.expires_at <= clock_timestamp()) OR
     NOT (key_record.scopes @> jsonb_build_array(required_scope)) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 END IF;
 IF expected_revision IS NULL OR expected_revision NOT BETWEEN 0 AND 9007199254740991 OR
   (restored_from IS NOT NULL AND restored_from NOT BETWEEN 0 AND 9007199254740991) THEN RETURN jsonb_build_object('success',false,'code','LIMIT'); END IF;
 IF operation IS NULL OR operation NOT IN ('draft','reset','publish','rollback') OR (operation<>'rollback' AND restored_from IS NOT NULL) THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
 -- The canonical product also serializes concurrent first edits and deletion.
 SELECT is_active AND is_listed INTO product_public FROM public.products WHERE id=offer_product_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO current_config FROM public.product_offer_config WHERE product_id=offer_product_id FOR UPDATE;
 IF NOT FOUND THEN current_config.revision := 0; END IF;
 IF expected_revision <> current_config.revision THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','currentRevision',current_config.revision); END IF;
 IF current_config.revision=9007199254740991 THEN RETURN jsonb_build_object('success',false,'code','LIMIT'); END IF;
 next_draft := current_config.draft; next_published := current_config.published;
 IF operation IN ('draft','reset') THEN
   IF validated_config IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
   next_draft := validated_config; candidate := validated_config;
 ELSIF operation='publish' THEN
   IF validated_config IS NOT NULL OR current_config.draft IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
   next_published := current_config.draft; next_draft := NULL; candidate := next_published;
 ELSE
   IF validated_config IS NOT NULL OR restored_from IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
   SELECT h.published INTO next_published FROM public.product_offer_history h WHERE h.product_id=offer_product_id AND h.revision=mutate_product_offer.restored_from;
   IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
   next_draft := NULL; candidate := next_published;
 END IF;
 IF public.storefront_config_stored_bytes(candidate)>102400 OR public.storefront_config_stored_bytes(next_published)>102400 THEN RETURN jsonb_build_object('success',false,'code','LIMIT'); END IF;
 IF (candidate IS NOT NULL AND public.product_offer_config_valid(candidate) IS DISTINCT FROM true) OR
    (next_published IS NOT NULL AND public.product_offer_config_valid(next_published) IS DISTINCT FROM true) THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
 IF operation IN ('publish','rollback') AND candidate->>'enabled'='true' AND product_public IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
 IF current_config.product_id IS NULL THEN
   INSERT INTO public.product_offer_config(product_id) VALUES(offer_product_id);
   INSERT INTO public.product_offer_history(product_id,revision,operation,actor_id) VALUES(offer_product_id,0,'draft',actor_user_id);
 END IF;
 UPDATE public.product_offer_config SET revision=current_config.revision+1,draft=next_draft,published=next_published,updated_at=clock_timestamp(),updated_by=actor_user_id WHERE product_id=offer_product_id;
 INSERT INTO public.product_offer_history(product_id,revision,operation,draft,published,actor_id,restored_from)
 VALUES(offer_product_id,current_config.revision+1,operation,next_draft,next_published,actor_user_id,restored_from);
 INSERT INTO public.audit_log(table_name,operation,user_id,performed_by,new_values)
 VALUES('product_offer_config','UPDATE',actor_user_id,actor_user_id,jsonb_build_object('productId',offer_product_id,'revision',current_config.revision+1,'action',operation,'scope',required_scope,'actor_method',actor_method,'actor_api_key_id',actor_api_key_id));
 RETURN jsonb_build_object('success',true,'revision',current_config.revision+1);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','UNAVAILABLE');
END; $$;
REVOKE EXECUTE ON FUNCTION public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid) TO service_role;