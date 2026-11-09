CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 OR length(p_data->>'purchase_product')>500
    OR length(p_data->>'purchase_amount')>100 OR (p_data->>'locale') NOT IN ('pl','en')
    OR (p_data->>'mail_kind') NOT IN ('transfer_placed','payment_reminder','order_cancelled','participants_needed')
    OR length(p_data->>'pay_url')>2048
    OR (p_data->>'pay_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/transfer\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'participants_url')>2048
    OR (p_data->>'participants_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/participants\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'release_text')>500
    OR length(p_data->>'cancel_reason_text')>2000 OR length(p_data->>'license_expires_text')>100
    OR length(p_data->>'license_expires_at')>50
    OR (p_data ? 'license_keys' AND (jsonb_typeof(p_data->'license_keys') <> 'object'
      OR octet_length((p_data->'license_keys')::text)>65536
      OR EXISTS (SELECT 1 FROM jsonb_each_text(p_data->'license_keys') e
        WHERE length(e.key)>500 OR length(e.value)>4096 OR e.value !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')))
    OR length(p_data->>'license_key')>4096 OR (p_data->>'license_key') !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    OR (p_data ? 'payment_received' AND (p_data->>'payment_received') <> 'true')
    OR (p_data ? 'transfer' AND (jsonb_typeof(p_data->'transfer') <> 'object'
      OR octet_length((p_data->'transfer')::text)>2000
      OR EXISTS (SELECT 1 FROM jsonb_each(p_data->'transfer') e
        WHERE jsonb_typeof(e.value) <> 'string' OR e.key NOT IN ('holder','account','bank','title','amount','due'))))
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'transfer'-'purchase_product'-'purchase_amount'-'locale'
    -'cancel_reason_text'-'license_expires_at'-'license_expires_text'
    -'mail_kind'-'pay_url'-'release_text'-'participants_url'-'license_keys'-'license_key'-'payment_received')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text','transfer',p_data->'transfer',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
      'license_keys',p_data->'license_keys','participants_url',p_data->>'participants_url','license_key',p_data->>'license_key',
      'payment_received',p_data->>'payment_received',
      'cancel_reason_text',p_data->>'cancel_reason_text','license_expires_at',p_data->>'license_expires_at',
      'license_expires_text',p_data->>'license_expires_text',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

ALTER TABLE public.auth_mail_retries DROP CONSTRAINT auth_mail_retries_data_check;
ALTER TABLE public.auth_mail_retries ADD CONSTRAINT auth_mail_retries_data_check
  CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 73728);

CREATE OR REPLACE FUNCTION public.license_mail_is_current(p_email text, p_keys jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT jsonb_typeof(p_keys)='array' AND jsonb_array_length(p_keys)>0
AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(p_keys) k(token)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.issued_licenses l
    WHERE l.license_key=k.token AND lower(l.email)=lower(p_email)
      AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>now())
      AND (l.issuance_source IN ('manual','api') OR
        EXISTS (SELECT 1 FROM public.payment_transactions t
          JOIN public.subscriptions s ON s.id=t.subscription_id
          JOIN auth.users u ON u.id=s.user_id AND u.email_confirmed_at IS NULL
          WHERE lower(u.email)=lower(p_email) AND s.product_id=l.product_id
            AND t.status IN ('completed','partially_refunded') AND l.order_id=t.stripe_invoice_id
            AND ((s.status IN ('active','trialing','past_due') AND s.current_period_end>now())
              OR (s.status='canceled' AND s.paid_access_invoice_id=t.stripe_invoice_id
                AND s.paid_access_expires_at>now() AND coalesce(t.refunded_amount,0)=0))) OR
        EXISTS (SELECT 1 FROM public.user_product_access a JOIN auth.users u ON u.id=a.user_id
          WHERE lower(u.email)=lower(p_email) AND a.product_id=l.product_id
            AND (a.access_expires_at IS NULL OR a.access_expires_at>now())) OR
        EXISTS (SELECT 1 FROM public.guest_purchases g
          JOIN public.payment_transactions t ON t.id=g.transaction_id OR (g.transaction_id IS NULL AND t.session_id=g.session_id)
          WHERE lower(g.customer_email)=lower(p_email) AND g.product_id=l.product_id
            AND g.claimed_by_user_id IS NULL AND t.status IN ('completed','partially_refunded')
            AND l.order_id IN (t.id::text,t.session_id,t.stripe_payment_intent_id,t.stripe_invoice_id)))
  )
);
$$;
REVOKE ALL ON FUNCTION public.license_mail_is_current(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.license_mail_is_current(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_auth_mail_retry(p_email text, p_redirect_to text, p_data jsonb, p_kind text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_mail_retries(email, redirect_to, data, kind, next_attempt_at, last_error)
  VALUES (lower(btrim(p_email)), p_redirect_to, coalesce(p_data, '{}'::jsonb), p_kind, now() + interval '2 minutes', left(p_error, 40))
  ON CONFLICT (email, redirect_to) DO UPDATE SET data = CASE WHEN public.auth_mail_retries.kind='license' AND EXCLUDED.kind='post_checkout' THEN public.auth_mail_retries.data ELSE EXCLUDED.data END,
    kind = CASE WHEN public.auth_mail_retries.kind='license' THEN 'license' ELSE EXCLUDED.kind END, last_error = EXCLUDED.last_error,
    given_up_at = NULL, attempts = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.attempts ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) TO service_role;

CREATE TABLE public.license_mail_receipts (
  mail_key text PRIMARY KEY CHECK (mail_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.license_mail_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.license_mail_receipts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.license_mail_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.license_mail_receipts TO service_role;
ALTER TABLE public.auth_mail_retries ADD COLUMN license_mail_key text
  REFERENCES public.license_mail_receipts(mail_key);

CREATE FUNCTION public.claim_license_mail(p_key text,p_email text,p_redirect_to text,p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE retry_id uuid;
BEGIN
  INSERT INTO public.license_mail_receipts(mail_key) VALUES(p_key) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.auth_mail_retries(email,redirect_to,data,kind,next_attempt_at,last_error,license_mail_key)
    VALUES(lower(btrim(p_email)),p_redirect_to,p_data,'license',now()+interval '10 minutes','send_failed',p_key)
    RETURNING id INTO retry_id;
  RETURN retry_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_license_mail(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_license_mail(text,text,text,jsonb) TO service_role;

CREATE FUNCTION public.finish_license_mail(p_retry_id uuid,p_completed boolean,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_completed THEN
    DELETE FROM public.auth_mail_retries WHERE id=p_retry_id;
  ELSE
    UPDATE public.auth_mail_retries SET next_attempt_at=now()+interval '2 minutes',last_error=left(p_error,40)
      WHERE id=p_retry_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.finish_license_mail(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_license_mail(uuid,boolean,text) TO service_role;
