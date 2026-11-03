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
