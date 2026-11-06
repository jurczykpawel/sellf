ALTER TABLE public.lead_submissions
  ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('pl', 'en'));

UPDATE public.lead_submissions l SET locale = 'pl'
WHERE l.consent_version LIKE '%:pl'
   OR (l.consent_version IS NULL AND EXISTS (
     SELECT 1 FROM auth.users u WHERE u.email = l.email AND u.raw_user_meta_data->>'locale' = 'pl'
   ));
