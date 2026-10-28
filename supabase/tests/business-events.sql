\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='public.business_events'::regclass),'event history has RLS');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM public.business_events WHERE dispatched_at IS NOT NULL),'realistic processed seed transitions');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(NOT has_table_privilege(current_user,'public.business_events','SELECT'),'anonymous history is private');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.claim_business_events(integer)','EXECUTE'),'anonymous worker denied');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.capture_expired_access()','EXECUTE'),'anonymous expiry denied');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'anonymous mutation denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(NOT has_table_privilege(current_user,'public.business_events','SELECT'),'buyer history is private');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.claim_business_events(integer)','EXECUTE'),'buyer worker denied');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'buyer administrative mutation denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.assert_true(has_table_privilege(current_user,'public.business_events','SELECT'),'worker can read history');
SELECT pg_temp.assert_true((SELECT coalesce(bool_and(dispatched_at IS NULL),true) FROM public.claim_business_events()),'processed changes are not redelivered');
RESET ROLE;
ROLLBACK;
