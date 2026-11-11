-- Sellf 2026.11.0: buyer mail.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261028141621_playerstack_leads.sql =====
-- PlayerStack lead intake and canonical product consent settings.
ALTER TABLE public.products
  ADD COLUMN lead_consent_required boolean NOT NULL DEFAULT false,
  ADD COLUMN lead_consent_version text NOT NULL DEFAULT '1' CHECK (lead_consent_version ~ '^[a-zA-Z0-9._-]{1,60}$'),
  ADD COLUMN lead_consent_text_pl text NOT NULL DEFAULT 'Chcę otrzymywać wiadomości o nowych materiałach i produktach. Mogę wypisać się w każdej chwili.' CHECK (length(btrim(lead_consent_text_pl)) BETWEEN 1 AND 500),
  ADD COLUMN lead_consent_text_en text NOT NULL DEFAULT 'I want to receive news about new materials and products. I can unsubscribe at any time.' CHECK (length(btrim(lead_consent_text_en)) BETWEEN 1 AND 500);

CREATE TABLE public.lead_nonces (
  nonce_hash text PRIMARY KEY CHECK (nonce_hash ~ '^[a-f0-9]{64}$'),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (length(origin) <= 2048),
  signature text NOT NULL CHECK (length(signature) <= 256),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX lead_nonces_product_idx ON public.lead_nonces(product_id);
CREATE INDEX lead_nonces_expiry_idx ON public.lead_nonces(expires_at);
ALTER TABLE public.lead_nonces ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_nonces_service ON public.lead_nonces FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.lead_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_nonces TO service_role;

CREATE TABLE public.lead_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_slug text,
  source text NOT NULL CHECK (length(source) <= 2048 AND source LIKE 'https://%'),
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_version text CHECK (length(consent_version) BETWEEN 1 AND 64),
  consent_text text CHECK (length(consent_text) BETWEEN 1 AND 500),
  client_consent_text text CHECK (length(client_consent_text) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  CHECK (NOT marketing_consent OR (consent_version IS NOT NULL AND consent_text IS NOT NULL))
);
CREATE INDEX lead_submissions_product_idx ON public.lead_submissions(product_id);
CREATE INDEX lead_submissions_email_idx ON public.lead_submissions(email);
CREATE INDEX lead_submissions_expiry_idx ON public.lead_submissions(expires_at) WHERE confirmed_at IS NULL;
ALTER TABLE public.lead_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_submissions_service ON public.lead_submissions FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.lead_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_submissions TO service_role;

CREATE FUNCTION public.confirm_lead_submission(p_token_hash text, p_email text)
RETURNS SETOF public.lead_submissions LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.lead_submissions SET confirmed_at = coalesce(confirmed_at, now())
  WHERE token_hash = p_token_hash AND email = p_email AND expires_at > now()
    AND (select auth.role()) = 'service_role'
  RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_lead_submission(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_lead_submission(text, text) TO service_role;

SELECT cron.schedule('cleanup-lead-intake', '17 * * * *', $cron$
  DELETE FROM public.lead_nonces WHERE expires_at < now();
  DELETE FROM public.lead_submissions WHERE confirmed_at IS NULL AND expires_at < now();
$cron$);

CREATE FUNCTION public.validate_lead_consent_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.lead_consent_text_pl, NEW.lead_consent_text_en) IS DISTINCT FROM
     (OLD.lead_consent_text_pl, OLD.lead_consent_text_en)
     AND NEW.lead_consent_version = OLD.lead_consent_version THEN
    RAISE EXCEPTION 'A wording change requires a new consent version' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_submissions s WHERE s.product_id=NEW.id AND s.marketing_consent
    AND ((s.consent_version=NEW.lead_consent_version||':pl' AND s.consent_text<>NEW.lead_consent_text_pl)
      OR (s.consent_version=NEW.lead_consent_version||':en' AND s.consent_text<>NEW.lead_consent_text_en))) THEN
    RAISE EXCEPTION 'Consent version already has different wording' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.validate_lead_consent_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_lead_consent_version() TO service_role;
CREATE TRIGGER validate_lead_consent_version BEFORE UPDATE OF lead_consent_version, lead_consent_text_pl, lead_consent_text_en
  ON public.products FOR EACH ROW EXECUTE FUNCTION public.validate_lead_consent_version();

-- ===== Source: 20261104020000_auth_mail_retries.sql =====
-- Durable retry for purchase mails delivered through Supabase Auth (W147-8, W147-9).
-- The post-payment login link and the free-license key mail both go out as auth OTP mails. When
-- the auth mailer refuses (hourly send limit, per-user cooldown, transient failure) the buyer used to
-- get nothing and nothing retried. A refused send is parked here and the minute cron retries it
-- with backoff; the row is deleted once delivered. One pending row per (email, redirect), so a page
-- reload cannot multiply mails. Service role only: rows can carry a license key until delivered.

CREATE TABLE public.auth_mail_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  redirect_to text NOT NULL CHECK (length(redirect_to) BETWEEN 1 AND 2048),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 8192),
  kind text NOT NULL CHECK (kind IN ('post_checkout', 'license')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 40),
  given_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, redirect_to)
);
CREATE INDEX auth_mail_retries_due ON public.auth_mail_retries (next_attempt_at) WHERE given_up_at IS NULL;
ALTER TABLE public.auth_mail_retries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.auth_mail_retries FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.auth_mail_retries FROM anon, authenticated;
GRANT ALL ON public.auth_mail_retries TO service_role;

-- Parks a refused mail. A repeat for the same destination refreshes the payload but keeps the
-- attempt count and does not pull the next attempt earlier.
CREATE FUNCTION public.queue_auth_mail_retry(p_email text, p_redirect_to text, p_data jsonb, p_kind text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_mail_retries(email, redirect_to, data, kind, next_attempt_at, last_error)
  VALUES (lower(btrim(p_email)), p_redirect_to, coalesce(p_data, '{}'::jsonb), p_kind, now() + interval '2 minutes', left(p_error, 40))
  ON CONFLICT (email, redirect_to) DO UPDATE SET data = EXCLUDED.data, last_error = EXCLUDED.last_error,
    given_up_at = NULL, attempts = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.attempts ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) TO service_role;

-- Claims due rows for one worker: bumps attempts and leases them for 10 minutes, so a parallel
-- cron run skips them (SKIP LOCKED) and a crashed run retries later. Old given-up rows are purged.
CREATE FUNCTION public.claim_auth_mail_retries(p_limit integer DEFAULT 20)
RETURNS SETOF public.auth_mail_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.auth_mail_retries WHERE given_up_at < now() - interval '7 days';
  RETURN QUERY
  UPDATE public.auth_mail_retries r SET attempts = r.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE r.id IN (SELECT q.id FROM public.auth_mail_retries q WHERE q.given_up_at IS NULL AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at LIMIT least(greatest(coalesce(p_limit, 20), 1), 100) FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_auth_mail_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) TO service_role;

-- ===== Source: 20261105030000_order_search_rpc.sql =====
-- Literal searches retain the table result shape for filters, embeds and pagination.
CREATE FUNCTION public.search_payment_transactions(p_search text, p_include_identifiers boolean DEFAULT true)
RETURNS SETOF public.payment_transactions
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT t.* FROM public.payment_transactions t
  WHERE strpos(lower(t.customer_email), lower(p_search)) > 0
    OR (p_include_identifiers AND (strpos(lower(t.session_id), lower(p_search)) > 0
      OR strpos(lower(t.stripe_payment_intent_id), lower(p_search)) > 0))
    OR (trim(p_search) ~ '^#?[0-9]{1,15}$' AND t.order_number::text = ltrim(trim(p_search), '#0'))
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = t.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

CREATE FUNCTION public.search_order_accesses(p_search text)
RETURNS SETOF public.user_product_access
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT a.* FROM public.user_product_access a
  WHERE EXISTS (SELECT 1 FROM public.user_access_stats u WHERE u.user_id = a.user_id AND strpos(lower(u.email), lower(p_search)) > 0)
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = a.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

CREATE FUNCTION public.search_order_leads(p_search text)
RETURNS SETOF public.lead_submissions
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT l.* FROM public.lead_submissions l
  WHERE strpos(lower(l.email), lower(p_search)) > 0
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = l.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

REVOKE ALL ON FUNCTION public.search_payment_transactions(text,boolean), public.search_order_accesses(text), public.search_order_leads(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_payment_transactions(text,boolean), public.search_order_accesses(text), public.search_order_leads(text) TO service_role;

-- ===== Source: 20261105190000_buyer_mail_details.sql =====
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
    -'mail_kind'-'pay_url'-'release_text'-'participants_url'-'license_key'-'payment_received')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text','transfer',p_data->'transfer',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
      'participants_url',p_data->>'participants_url','license_key',p_data->>'license_key',
      'payment_received',p_data->>'payment_received',
      'cancel_reason_text',p_data->>'cancel_reason_text','license_expires_at',p_data->>'license_expires_at',
      'license_expires_text',p_data->>'license_expires_text',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== Source: 20261106100000_buyer_email_channel.sql =====
ALTER TABLE public.shop_config ADD COLUMN supabase_buyer_emails boolean NOT NULL DEFAULT false;
-- Existing shops keep their mail channel during upgrade. Fresh installations have no shop row yet.
UPDATE public.shop_config SET supabase_buyer_emails = true WHERE NOT supabase_buyer_emails;
-- An existing installation may have sold products before saving shop settings.
INSERT INTO public.shop_config(supabase_buyer_emails)
  SELECT true WHERE NOT EXISTS (SELECT 1 FROM public.shop_config)
    AND (EXISTS (SELECT 1 FROM public.products) OR EXISTS (SELECT 1 FROM auth.users));

CREATE OR REPLACE FUNCTION public.enqueue_webhook_delivery(
  p_id uuid, p_endpoint_id uuid, p_event_type text, p_payload jsonb,
  p_delivery_key text, p_max_attempts integer DEFAULT 5
) RETURNS SETOF public.webhook_logs
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.webhook_logs(
    id, endpoint_id, event_type, payload, delivery_key, status,
    attempt_count, max_attempts, next_retry_at
  ) VALUES (
    p_id, p_endpoint_id, p_event_type, CASE WHEN jsonb_typeof(p_payload) = 'array' THEN p_payload
      ELSE p_payload || jsonb_build_object('id', p_id) END,
    p_delivery_key, 'pending_retry', 0, p_max_attempts, now() + interval '60 seconds'
  ) ON CONFLICT DO NOTHING
  RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) TO service_role;

-- ===== Source: 20261106110000_lead_checkout_locale.sql =====
ALTER TABLE public.lead_submissions
  ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('pl', 'en'));

UPDATE public.lead_submissions l SET locale = 'pl'
WHERE l.consent_version LIKE '%:pl'
   OR (l.consent_version IS NULL AND EXISTS (
     SELECT 1 FROM auth.users u WHERE u.email = l.email AND u.raw_user_meta_data->>'locale' = 'pl'
   ));

-- ===== Source: 20261109100000_purchase_license_mail.sql =====
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
