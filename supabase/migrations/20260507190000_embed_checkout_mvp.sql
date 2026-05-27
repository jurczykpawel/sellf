ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS embed_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_seller_id
  ON public.products(seller_id);

CREATE TABLE IF NOT EXISTS public.seller_embed_settings (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  allowed_embed_origins text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_seller_embed_origins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  origin text;
BEGIN
  IF COALESCE(array_length(NEW.allowed_embed_origins, 1), 0) > 20 THEN
    RAISE EXCEPTION 'Maximum 20 embed origins are allowed';
  END IF;

  FOREACH origin IN ARRAY NEW.allowed_embed_origins LOOP
    IF origin !~ '^https://[^/?#]+$' AND origin !~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$' THEN
      RAISE EXCEPTION 'Invalid embed origin format';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_embed_settings_validate_origins
  ON public.seller_embed_settings;

CREATE TRIGGER seller_embed_settings_validate_origins
BEFORE INSERT OR UPDATE OF allowed_embed_origins
ON public.seller_embed_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_seller_embed_origins();

REVOKE ALL ON FUNCTION public.validate_seller_embed_origins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_seller_embed_origins() TO service_role;

ALTER TABLE public.seller_embed_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY seller_embed_settings_owner_or_admin_all
  ON public.seller_embed_settings
  FOR ALL
  TO authenticated
  USING (seller_id = (select auth.uid()) OR (select public.is_admin()))
  WITH CHECK (seller_id = (select auth.uid()) OR (select public.is_admin()));

REVOKE ALL ON public.seller_embed_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_embed_settings TO authenticated;
GRANT ALL ON public.seller_embed_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.embed_checkout_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('paid_checkout', 'free_email_gate')),
  status text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_slug text NOT NULL,
  origin text,
  email text,
  embed_session_id text,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.embed_checkout_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY embed_checkout_log_admin_all
  ON public.embed_checkout_log
  FOR ALL
  TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

REVOKE ALL ON public.embed_checkout_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.embed_checkout_log TO authenticated;
GRANT ALL ON public.embed_checkout_log TO service_role;


