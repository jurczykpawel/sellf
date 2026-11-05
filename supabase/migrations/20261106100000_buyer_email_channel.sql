ALTER TABLE public.shop_config ADD COLUMN supabase_buyer_emails boolean NOT NULL DEFAULT false;
-- Existing shops keep their mail channel during upgrade. Fresh installations have no shop row yet.
UPDATE public.shop_config SET supabase_buyer_emails = true;
-- An existing installation may have sold products before saving shop settings.
INSERT INTO public.shop_config(supabase_buyer_emails)
  SELECT true WHERE NOT EXISTS (SELECT 1 FROM public.shop_config)
    AND (EXISTS (SELECT 1 FROM public.products) OR EXISTS (SELECT 1 FROM auth.users));
