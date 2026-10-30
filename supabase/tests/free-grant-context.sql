\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='public.free_grant_contexts'::regclass),'context history has RLS');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM public.free_grant_contexts WHERE claimed_at IS NOT NULL),'consumed example context exists');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(NOT has_table_privilege(current_user,'public.free_grant_contexts','SELECT'),'anonymous cannot read checkout answers');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.prepare_free_grant(text,uuid,jsonb)','EXECUTE'),'anonymous cannot prepare trusted contexts');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.free_grant_context(uuid,uuid)','EXECUTE'),'anonymous context lookup denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(NOT has_table_privilege(current_user,'public.free_grant_contexts','SELECT'),'buyer cannot read the context table');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.prepare_free_grant(text,uuid,jsonb)','EXECUTE'),'buyer cannot write trusted contexts');
SELECT pg_temp.assert_true(has_function_privilege(current_user,'public.free_grant_context(uuid,uuid)','EXECUTE'),'buyer can use scoped lookup');
SELECT pg_temp.assert_true(NOT has_function_privilege(current_user,'public.legacy_pending_free_grant_products()','EXECUTE'),'legacy implementation is internal');
RESET ROLE;
ROLLBACK;
