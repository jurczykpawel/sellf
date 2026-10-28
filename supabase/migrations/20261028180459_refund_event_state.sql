-- Refund identity and notification progress are independent of payment totals.
CREATE TABLE public.payment_refunds (
  stripe_refund_id text PRIMARY KEY CHECK (stripe_refund_id ~ '^re_[A-Za-z0-9_]+$'),
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text CHECK (status IN ('pending','requires_action','succeeded','failed','canceled')),
  previous_status text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  notified_version integer NOT NULL DEFAULT 0 CHECK (notified_version >= 0 AND notified_version <= version),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_refunds_transaction_id_idx ON public.payment_refunds(transaction_id);
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_refunds_service ON public.payment_refunds FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.payment_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_refunds TO service_role;

CREATE TABLE public.payment_refund_events (
  stripe_refund_id text NOT NULL REFERENCES public.payment_refunds(stripe_refund_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text CHECK (status IN ('pending','requires_action','succeeded','failed','canceled')),
  previous_status text,
  notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(stripe_refund_id,version)
);
ALTER TABLE public.payment_refund_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_refund_events_service ON public.payment_refund_events FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.payment_refund_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_refund_events TO service_role;

CREATE FUNCTION public.observe_payment_refund(
  p_transaction_id uuid, p_refund_id text, p_amount integer, p_currency text, p_status text,
  p_initial_status text DEFAULT NULL
) RETURNS TABLE(refund_version integer, previous_status text, notified_version integer, refund_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE;
BEGIN
  INSERT INTO public.payment_refunds(stripe_refund_id,transaction_id,amount,currency,status)
  VALUES(p_refund_id,p_transaction_id,p_amount,upper(p_currency),coalesce(p_initial_status,p_status))
  ON CONFLICT (stripe_refund_id) DO NOTHING;
  SELECT * INTO STRICT v_refund FROM public.payment_refunds WHERE stripe_refund_id=p_refund_id FOR UPDATE;
  IF v_refund.transaction_id<>p_transaction_id OR v_refund.amount<>p_amount OR v_refund.currency<>upper(p_currency) THEN
    RAISE EXCEPTION 'Refund binding does not match';
  END IF;
  INSERT INTO public.payment_refund_events(stripe_refund_id,version,status,previous_status)
  VALUES(p_refund_id,v_refund.version,v_refund.status,v_refund.previous_status) ON CONFLICT DO NOTHING;
  IF v_refund.status IS DISTINCT FROM p_status THEN
    UPDATE public.payment_refunds SET previous_status=v_refund.status,status=p_status,
      version=version+1,updated_at=now() WHERE stripe_refund_id=p_refund_id RETURNING * INTO v_refund;
    INSERT INTO public.payment_refund_events(stripe_refund_id,version,status,previous_status)
    VALUES(p_refund_id,v_refund.version,v_refund.status,v_refund.previous_status);
  END IF;
  RETURN QUERY SELECT e.version,e.previous_status,0,e.status FROM public.payment_refund_events e
    WHERE e.stripe_refund_id=p_refund_id AND NOT e.notified ORDER BY e.version;
  IF NOT FOUND THEN
    RETURN QUERY SELECT v_refund.version,v_refund.previous_status,v_refund.notified_version,v_refund.status;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.observe_payment_refund(uuid,text,integer,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.observe_payment_refund(uuid,text,integer,text,text,text) TO service_role;

CREATE FUNCTION public.confirm_refund_notification(p_refund_id text,p_version integer) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.payment_refund_events SET notified=true WHERE stripe_refund_id=p_refund_id AND version=p_version;
  UPDATE public.payment_refunds SET notified_version=greatest(notified_version,p_version)
  WHERE stripe_refund_id=p_refund_id AND p_version BETWEEN 1 AND version;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_refund_notification(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_refund_notification(text,integer) TO service_role;

UPDATE public.payment_transactions SET status='partially_refunded'
WHERE status='completed' AND refunded_amount>0 AND refunded_amount<amount;
