DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public._claim_guest_purchases_before_disputes(uuid)'::regprocedure) INTO definition;
  IF position('WHERE gp.customer_email=email AND gp.claimed_by_user_id IS NULL FOR UPDATE' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected guest claim definition';
  END IF;
  EXECUTE replace(definition,
    'WHERE gp.customer_email=email AND gp.claimed_by_user_id IS NULL FOR UPDATE',
    E'WHERE gp.customer_email=email AND gp.claimed_by_user_id IS NULL\n      AND (pt.id IS NULL OR (pt.status NOT IN (''refunded'',''disputed'',''cancelled'')\n        AND (pt.amount=0 OR coalesce(pt.refunded_amount,0)<pt.amount))) FOR UPDATE');
END $$;

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.claim_guest_purchases_for_user(uuid)'::regprocedure) INTO definition;
  IF position('AND NOT g.metadata ? ''_dispute_access_terms''' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected guest terms definition';
  END IF;
  EXECUTE replace(definition,
    'AND NOT g.metadata ? ''_dispute_access_terms''',
    E'AND NOT g.metadata ? ''_dispute_access_terms''\n      AND NOT EXISTS(SELECT 1 FROM public.payment_transactions t\n        WHERE (t.id=g.transaction_id OR (g.transaction_id IS NULL AND t.session_id=g.session_id))\n          AND (t.status IN (''refunded'',''disputed'',''cancelled'') OR (t.amount>0 AND coalesce(t.refunded_amount,0)>=t.amount)))');

  SELECT pg_get_functiondef('public.release_transfer_access()'::regprocedure) INTO definition;
  IF position('IF NEW.status=''cancelled'' AND OLD.status=''awaiting_payment'' THEN' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected transfer release definition';
  END IF;
  EXECUTE replace(definition,
    'IF NEW.status=''cancelled'' AND OLD.status=''awaiting_payment'' THEN',
    'IF (NEW.status=''cancelled'' AND OLD.status=''awaiting_payment'') OR (NEW.status=''refunded'' AND NEW.status IS DISTINCT FROM OLD.status) THEN');
END $$;

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.transfer_access_source()'::regprocedure) INTO definition;
  IF position('  IF txid IS NOT NULL AND EXISTS' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected transfer source definition'; END IF;
  EXECUTE replace(definition,'  IF txid IS NOT NULL AND EXISTS',
    E'  IF TG_OP=''UPDATE'' AND txid IS NULL\n    AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id\n    AND NEW.access_granted_at IS NOT DISTINCT FROM OLD.access_granted_at\n    AND coalesce(current_setting(''sellf.grant_source'',true),'''') NOT IN (''purchase'',''bundle'',''free'') THEN RETURN NEW; END IF;\n  IF txid IS NOT NULL AND EXISTS');
END $$;
