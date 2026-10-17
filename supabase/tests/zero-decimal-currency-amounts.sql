\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
-- true when the completion RPC refuses the amount with a validation exception
CREATE FUNCTION pg_temp.rejects(sess text, prod uuid, amount numeric, cur text, needle text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.process_stripe_payment_completion_with_bump(sess, prod, 'zd-sql@example.com', amount, cur);
  RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM LIKE '%' || needle || '%';
END;
$$;
CREATE FUNCTION pg_temp.accepts(sess text, prod uuid, amount numeric, cur text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := public.process_stripe_payment_completion_with_bump(sess, prod, 'zd-sql@example.com', amount, cur);
  RETURN COALESCE((r->>'success')::boolean, false);
END;
$$;

INSERT INTO public.products(id, name, slug, price, currency, is_active) VALUES
 ('2d000000-0000-4000-a000-000000000001', 'JPY product', 'zd-sql-jpy', 1000, 'JPY', true),
 ('2d000000-0000-4000-a000-000000000002', 'PLN product', 'zd-sql-pln', 49.99, 'PLN', true),
 ('2d000000-0000-4000-a000-000000000003', 'EUR product', 'zd-sql-eur', 10, 'EUR', true);
INSERT INTO public.products(id, name, slug, price, currency, is_active, allow_custom_price, custom_price_min) VALUES
 ('2d000000-0000-4000-a000-000000000004', 'KRW pwyw', 'zd-sql-krw', 1000, 'KRW', true, true, 100),
 ('2d000000-0000-4000-a000-000000000005', 'PLN pwyw', 'zd-sql-pwyw-pln', 20, 'PLN', true, true, 5);

SELECT pg_temp.assert_true(public.currency_minor_factor('jpy') = 1 AND public.currency_minor_factor('KRW') = 1 AND public.currency_minor_factor('VND') = 1, 'zero-decimal currencies have factor 1');
SELECT pg_temp.assert_true(public.currency_minor_factor('PLN') = 100 AND public.currency_minor_factor('EUR') = 100 AND public.currency_minor_factor('HUF') = 100, 'two-decimal currencies keep factor 100');

SELECT pg_temp.assert_true(pg_temp.rejects('cs_zd_jpy_bad', '2d000000-0000-4000-a000-000000000001', 100000, 'JPY', 'Amount mismatch'), 'JPY 1000 charged as 100000 is rejected');
SELECT pg_temp.assert_true(pg_temp.accepts('cs_zd_jpy_ok', '2d000000-0000-4000-a000-000000000001', 1000, 'JPY'), 'JPY 1000 charged as 1000 completes');
SELECT pg_temp.assert_true((SELECT amount = 1000 FROM public.payment_transactions WHERE session_id='cs_zd_jpy_ok'), 'JPY transaction stores the Stripe amount verbatim');
SELECT pg_temp.assert_true((SELECT unit_price = 1000 FROM public.payment_line_items li JOIN public.payment_transactions t ON t.id = li.transaction_id WHERE t.session_id='cs_zd_jpy_ok'), 'JPY line item keeps the display price');

SELECT pg_temp.assert_true(pg_temp.rejects('cs_zd_pln_bad', '2d000000-0000-4000-a000-000000000002', 49, 'PLN', 'Amount mismatch'), 'PLN 49.99 charged as 49 is rejected');
SELECT pg_temp.assert_true(pg_temp.accepts('cs_zd_pln_ok', '2d000000-0000-4000-a000-000000000002', 4999, 'PLN'), 'PLN 49.99 charged as 4999 completes');
SELECT pg_temp.assert_true(pg_temp.accepts('cs_zd_eur_ok', '2d000000-0000-4000-a000-000000000003', 1000, 'EUR'), 'EUR 10 charged as 1000 completes');
SELECT pg_temp.assert_true(pg_temp.rejects('cs_zd_eur_bad', '2d000000-0000-4000-a000-000000000003', 10, 'EUR', 'Amount mismatch'), 'EUR 10 charged as 10 is rejected');

SELECT pg_temp.assert_true(pg_temp.rejects('cs_zd_krw_low', '2d000000-0000-4000-a000-000000000004', 50, 'KRW', 'Amount below minimum'), 'KRW pay-what-you-want below its 100 minimum is rejected');
SELECT pg_temp.assert_true(pg_temp.accepts('cs_zd_krw_ok', '2d000000-0000-4000-a000-000000000004', 500, 'KRW'), 'KRW pay-what-you-want 500 completes');
SELECT pg_temp.assert_true((SELECT unit_price = 500 FROM public.payment_line_items li JOIN public.payment_transactions t ON t.id = li.transaction_id WHERE t.session_id='cs_zd_krw_ok'), 'KRW pay-what-you-want line item is 500, not 5');
SELECT pg_temp.assert_true(pg_temp.rejects('cs_zd_pwyw_low', '2d000000-0000-4000-a000-000000000005', 400, 'PLN', 'Amount below minimum'), 'PLN pay-what-you-want below 5.00 is rejected');
SELECT pg_temp.assert_true(pg_temp.accepts('cs_zd_pwyw_ok', '2d000000-0000-4000-a000-000000000005', 1250, 'PLN'), 'PLN pay-what-you-want 12.50 completes');
SELECT pg_temp.assert_true((SELECT unit_price = 12.5 FROM public.payment_line_items li JOIN public.payment_transactions t ON t.id = li.transaction_id WHERE t.session_id='cs_zd_pwyw_ok'), 'PLN pay-what-you-want line item is 12.50');
ROLLBACK;
