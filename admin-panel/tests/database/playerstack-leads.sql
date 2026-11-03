-- Run using psql -v ON_ERROR_STOP=1 on a local migrated database.
BEGIN;
DO $$
DECLARE t text; n integer; first_time timestamptz; second_time timestamptz;
BEGIN
  FOREACH t IN ARRAY ARRAY['lead_nonces', 'lead_submissions'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS required'; END IF;
    IF has_table_privilege('anon','public.'||t,'SELECT') OR has_table_privilege('authenticated','public.'||t,'INSERT') THEN RAISE EXCEPTION 'Unexpected table grants'; END IF;
    IF NOT has_table_privilege('service_role','public.'||t,'SELECT,INSERT,DELETE') THEN RAISE EXCEPTION 'Service grants required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND roles=ARRAY['service_role']::name[]) THEN RAISE EXCEPTION 'Policy required'; END IF;
  END LOOP;
  IF has_function_privilege('anon','public.confirm_lead_submission(text,text)','EXECUTE') OR has_function_privilege('authenticated','public.confirm_lead_submission(text,text)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected function grant'; END IF;
  INSERT INTO public.lead_nonces(nonce_hash,origin,signature) VALUES(repeat('a',64),'https://example.com','sig');
  WITH consumed AS (DELETE FROM public.lead_nonces WHERE nonce_hash=repeat('a',64) RETURNING *) SELECT count(*) INTO n FROM consumed;
  IF n<>1 THEN RAISE EXCEPTION 'First consumption failed'; END IF;
  WITH consumed AS (DELETE FROM public.lead_nonces WHERE nonce_hash=repeat('a',64) RETURNING *) SELECT count(*) INTO n FROM consumed;
  IF n<>0 THEN RAISE EXCEPTION 'Second consumption returned a row'; END IF;
  INSERT INTO public.lead_submissions(token_hash,email,source,marketing_consent,consent_version,consent_text)
    VALUES(repeat('a',64),'viewer@example.com','https://example.com/video',true,'1:pl','Canonical consent');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT count(*) INTO n FROM public.confirm_lead_submission(repeat('a',64),'other@example.com');
  IF n<>0 THEN RAISE EXCEPTION 'Email mismatch accepted'; END IF;
  SELECT confirmed_at INTO first_time FROM public.confirm_lead_submission(repeat('a',64),'viewer@example.com');
  SELECT confirmed_at INTO second_time FROM public.confirm_lead_submission(repeat('a',64),'viewer@example.com');
  IF first_time IS NULL OR first_time<>second_time THEN RAISE EXCEPTION 'Confirmation timestamp changed'; END IF;
  UPDATE public.lead_submissions SET expires_at=now()-interval '1 second' WHERE token_hash=repeat('a',64);
  SELECT count(*) INTO n FROM public.confirm_lead_submission(repeat('a',64),'viewer@example.com');
  IF n<>0 THEN RAISE EXCEPTION 'Expired submission accepted'; END IF;
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    UPDATE public.products SET lead_consent_text_en='New consent wording' WHERE slug='free-tutorial';
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Wording change must require a new consent version'; END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.lead_nonces; RAISE EXCEPTION 'Anon read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.lead_submissions; RAISE EXCEPTION 'Anon evidence read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.lead_submissions; RAISE EXCEPTION 'Member evidence read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT count(*) FROM public.lead_submissions;
RESET ROLE;
DO $$
DECLARE rejected boolean := false;
BEGIN
  UPDATE public.products SET lead_consent_version='v2', lead_consent_text_en='Revised consent' WHERE slug='free-tutorial';
  BEGIN
    UPDATE public.products SET lead_consent_version='1' WHERE slug='free-tutorial';
  EXCEPTION WHEN check_violation THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Used version accepted different wording'; END IF;
END $$;
ROLLBACK;
