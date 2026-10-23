-- Provider settings stay server-side; invoice history is readable by administrators.
CREATE TABLE public.invoicing_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  instance_id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'none' CHECK (provider IN ('none','fakturownia')),
  domain text NOT NULL DEFAULT '',
  token jsonb,
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('auto','manual')),
  auto_since timestamptz,
  exemption text NOT NULL DEFAULT '' CHECK (length(exemption) <= 1000),
  template text NOT NULL DEFAULT '{product} {date} {session} {tier}' CHECK (length(template) <= 300)
);
ALTER TABLE public.invoicing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service settings" ON public.invoicing_config FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.invoicing_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.invoicing_config TO service_role;
CREATE FUNCTION public.set_invoicing_auto_since() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.mode <> 'auto' THEN NEW.auto_since := NULL;
  ELSIF TG_OP = 'INSERT' THEN NEW.auto_since := now();
  ELSIF OLD.mode IS DISTINCT FROM NEW.mode OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.domain IS DISTINCT FROM NEW.domain THEN NEW.auto_since := now();
  ELSE NEW.auto_since := OLD.auto_since;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.set_invoicing_auto_since() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoicing_auto_since() TO service_role;
CREATE TRIGGER invoicing_auto_since BEFORE INSERT OR UPDATE ON public.invoicing_config
FOR EACH ROW EXECUTE FUNCTION public.set_invoicing_auto_since();
INSERT INTO public.invoicing_config(id) VALUES (true);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'fakturownia'),
  status text NOT NULL DEFAULT 'issuing' CHECK (status IN ('issuing','issued','failed','corrected')),
  external_key text NOT NULL UNIQUE,
  provider_domain text NOT NULL,
  provider_invoice_id text,
  number text,
  view_url text,
  error text,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 5),
  payment_synced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_retry_idx ON public.invoices(updated_at) WHERE status IN ('failed','issuing');
CREATE INDEX invoices_payment_sync_idx ON public.invoices(updated_at) WHERE status = 'issued' AND NOT payment_synced;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin invoice read" ON public.invoices FOR SELECT TO authenticated USING ((select public.is_admin()));
CREATE POLICY "Service invoices" ON public.invoices FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
