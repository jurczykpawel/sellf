\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE service_role;
DO $$
BEGIN
 BEGIN
  UPDATE public.affiliate_programs SET enabled = enabled;
  RAISE EXCEPTION 'Program changes must use program operations';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.affiliate_memberships SET status = status;
  RAISE EXCEPTION 'Membership changes must use member operations';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK;
