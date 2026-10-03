\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
INSERT INTO public.products(id, name, slug, price, currency, is_active)
VALUES ('ca000000-0000-4000-a000-000000000001', 'Confirmation course', 'confirmation-sql-course', 10, 'PLN', true);
INSERT INTO public.payment_transactions(product_id, customer_email, amount, currency, status, session_id, metadata)
VALUES ('ca000000-0000-4000-a000-000000000001', 'confirmation-sql@example.com', 1000, 'PLN', 'completed', 'cs_confirmation_sql', '{"full_name":"Confirmed Buyer","needs_invoice":"true","company_name":"Example Studio"}');
INSERT INTO public.guest_purchases(product_id, customer_email, session_id, transaction_amount)
VALUES ('ca000000-0000-4000-a000-000000000001', 'confirmation-sql@example.com', 'cs_confirmation_sql', 1000);
INSERT INTO auth.users(id, email, raw_user_meta_data, raw_app_meta_data)
VALUES ('ca000000-0000-4000-a000-000000000002', 'confirmation-sql@example.com', '{"full_name":"Signup Name"}', '{"provider":"email"}');
SELECT pg_temp.assert_true((SELECT full_name = 'Signup Name' FROM public.profiles WHERE id='ca000000-0000-4000-a000-000000000002'), 'pending signup preserves profile');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000002'), 'pending signup has no guest access');
SELECT pg_temp.assert_true((SELECT claimed_by_user_id IS NULL FROM public.guest_purchases WHERE session_id='cs_confirmation_sql'), 'pending purchase remains unclaimed');
SELECT public.claim_guest_purchases_for_user('ca000000-0000-4000-a000-000000000002');
SELECT public.migrate_guest_payment_data_to_profile('ca000000-0000-4000-a000-000000000002');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.assert_true(public.migrate_guest_purchases('ca000000-0000-4000-a000-000000000002','confirmation-sql@example.com')=0, 'legacy migration waits for confirmation');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000002'), 'direct calls wait for confirmation');
SELECT pg_temp.assert_true((SELECT full_name = 'Signup Name' FROM public.profiles WHERE id='ca000000-0000-4000-a000-000000000002'), 'direct payment migration waits for confirmation');
UPDATE auth.users SET email_confirmed_at=now() WHERE id='ca000000-0000-4000-a000-000000000002';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000002'), 'confirmation grants guest access');
SELECT pg_temp.assert_true((SELECT user_id='ca000000-0000-4000-a000-000000000002' FROM public.payment_transactions WHERE session_id='cs_confirmation_sql'), 'confirmation attaches payment');
SELECT pg_temp.assert_true((SELECT full_name='Confirmed Buyer' AND company_name='Example Studio' FROM public.profiles WHERE id='ca000000-0000-4000-a000-000000000002'), 'confirmation migrates payment before claim');
UPDATE auth.users SET raw_user_meta_data='{"full_name":"Updated Name"}', email_confirmed_at=now() WHERE id='ca000000-0000-4000-a000-000000000002';
SELECT public.claim_guest_purchases_for_user('ca000000-0000-4000-a000-000000000002');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000002'), 'repeated updates and claims are idempotent');
INSERT INTO public.guest_purchases(product_id, customer_email, session_id, transaction_amount)
VALUES ('ca000000-0000-4000-a000-000000000001', 'oauth-sql@example.com', 'cs_oauth_sql', 1000);
INSERT INTO auth.users(id, email, email_confirmed_at, raw_app_meta_data)
VALUES ('ca000000-0000-4000-a000-000000000003', 'oauth-sql@example.com', now(), '{"provider":"google","providers":["google"]}');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000003'), 'confirmed OAuth insert claims purchases');
SELECT pg_temp.assert_true(public.migrate_guest_purchases('ca000000-0000-4000-a000-000000000003', 'other@example.com')=0, 'legacy migration requires account email');
INSERT INTO auth.users(id,email) VALUES ('ca000000-0000-4000-a000-000000000004','pending-payment-sql@example.com');
SELECT public.process_stripe_payment_completion_with_bump('cs_pending_confirmation_sql','ca000000-0000-4000-a000-000000000001','pending-payment-sql@example.com',1000,'PLN');
SELECT pg_temp.assert_true((SELECT user_id IS NULL FROM public.payment_transactions WHERE session_id='cs_pending_confirmation_sql'), 'new payment keeps pending account as guest');
SELECT public.process_stripe_payment_completion_with_bump('cs_pending_confirmation_sql','ca000000-0000-4000-a000-000000000001','pending-payment-sql@example.com',1000,'PLN',NULL,'ca000000-0000-4000-a000-000000000004');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000004'), 'payment retry waits for confirmation');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.claim_guest_purchases_for_user(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.migrate_guest_payment_data_to_profile(uuid)','EXECUTE'), 'claim helpers remain service-role only');
INSERT INTO auth.users(id,email) VALUES ('ca000000-0000-4000-a000-000000000005','subscription-confirmation-sql@example.com');
INSERT INTO public.subscriptions(id,user_id,product_id,stripe_customer_id,stripe_subscription_id,status)
VALUES ('ca000000-0000-4000-a000-000000000006','ca000000-0000-4000-a000-000000000005','ca000000-0000-4000-a000-000000000001','cus_confirmation_sql','sub_confirmation_sql','active');
INSERT INTO public.user_product_access(user_id,product_id,subscription_id)
VALUES ('ca000000-0000-4000-a000-000000000005','ca000000-0000-4000-a000-000000000001','ca000000-0000-4000-a000-000000000006');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000005'), 'subscription access waits for confirmation');
UPDATE auth.users SET email_confirmed_at=now() WHERE id='ca000000-0000-4000-a000-000000000005';
SELECT pg_temp.assert_true((SELECT subscription_id='ca000000-0000-4000-a000-000000000006' FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000005'), 'confirmation activates current subscription access');
INSERT INTO auth.users(id,email) VALUES ('ca000000-0000-4000-a000-000000000007','ended-subscription-sql@example.com');
INSERT INTO public.subscriptions(user_id,product_id,stripe_customer_id,stripe_subscription_id,status)
VALUES ('ca000000-0000-4000-a000-000000000007','ca000000-0000-4000-a000-000000000001','cus_ended_confirmation_sql','sub_ended_confirmation_sql','canceled');
UPDATE auth.users SET email_confirmed_at=now() WHERE id='ca000000-0000-4000-a000-000000000007';
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='ca000000-0000-4000-a000-000000000007'), 'confirmation keeps ended subscriptions without access');
ROLLBACK;
