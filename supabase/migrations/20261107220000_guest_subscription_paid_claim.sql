ALTER TABLE public.subscriptions
  ADD COLUMN paid_access_expires_at timestamptz,
  ADD COLUMN paid_access_invoice_id text;

CREATE FUNCTION public.claim_paid_subscription_access(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Serialize claims with changes to the payment ledger.
  PERFORM 1 FROM public.payment_transactions t
  JOIN public.subscriptions s ON s.id=t.subscription_id AND s.paid_access_invoice_id=t.stripe_invoice_id
  WHERE s.user_id=p_user_id AND s.status='canceled'
  ORDER BY t.id FOR UPDATE OF t;

  INSERT INTO public.user_product_access(user_id,product_id,subscription_id,access_granted_at,access_expires_at,grant_source)
  SELECT DISTINCT ON (s.product_id) s.user_id,s.product_id,s.id,now(),s.paid_access_expires_at,'subscription'
  FROM public.subscriptions s
  JOIN auth.users u ON u.id=s.user_id AND u.email_confirmed_at IS NOT NULL
  JOIN public.payment_transactions t ON t.subscription_id=s.id AND t.stripe_invoice_id=s.paid_access_invoice_id
    AND t.product_id=s.product_id AND t.status='completed' AND coalesce(t.refunded_amount,0)=0
  WHERE s.user_id=p_user_id AND s.status='canceled' AND s.paid_access_expires_at>now()
  ORDER BY s.product_id,s.paid_access_expires_at DESC,s.id
  ON CONFLICT (user_id,product_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.claim_paid_subscription_access(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paid_subscription_access(uuid) TO service_role;

-- Reuse the existing claim entry point for both confirmation and explicit claims.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.claim_guest_purchases_for_user(uuid)'::regprocedure) INTO definition;
  IF position('  RETURN result;' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected guest claim definition'; END IF;
  EXECUTE replace(definition,'  RETURN result;',
    E'  PERFORM public.claim_paid_subscription_access(p_user_id);\n  RETURN result;');
END $$;
