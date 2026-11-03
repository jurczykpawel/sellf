-- Purchase attribution snapshot trigger: behaviour, fail-safe and bulk cost. Everything is rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_that(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %', label; END IF;
 RAISE NOTICE 'PASS: %', label;
END $$;

INSERT INTO public.products(id, name, slug, price, currency)
VALUES ('a7700000-0000-4000-a000-000000000001', 'Attribution snapshot', 'attribution-snapshot-test', 10, 'PLN');

-- A paid order without stored attribution is recorded as channel unknown.
INSERT INTO public.payment_transactions(id, session_id, product_id, customer_email, amount, currency, status)
VALUES ('a7700000-0000-4000-a000-000000000010', 'cs_attr_plain', 'a7700000-0000-4000-a000-000000000001', 'a@example.com', 1000, 'PLN', 'completed');
SELECT pg_temp.check_that((SELECT channel = 'unknown' AND kind = 'payment' FROM public.purchase_attribution
  WHERE transaction_id = 'a7700000-0000-4000-a000-000000000010'), 'order without payload is snapshotted as unknown');

-- A stored payload is classified; a malformed timestamp is dropped, not fatal.
SELECT public.store_checkout_attribution('cs_attr_utm', '{"mode":"url","consent":"analytics","last":{"source":"newsletter","medium":"email","at":"not-a-date"}}');
INSERT INTO public.payment_transactions(id, session_id, product_id, customer_email, amount, currency, status)
VALUES ('a7700000-0000-4000-a000-000000000011', 'cs_attr_utm', 'a7700000-0000-4000-a000-000000000001', 'b@example.com', 1000, 'PLN', 'completed');
SELECT pg_temp.check_that((SELECT last_source = 'newsletter' AND last_at IS NULL AND channel <> 'unknown' FROM public.purchase_attribution
  WHERE transaction_id = 'a7700000-0000-4000-a000-000000000011'), 'payload is classified and a bad timestamp is ignored');

-- Fail-safe: a payload that breaks the snapshot never blocks the payment.
CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'attribution broken'; END $$;
CREATE TRIGGER boom BEFORE INSERT ON public.purchase_attribution FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
SELECT public.store_checkout_attribution('cs_attr_boom', '{"mode":"url","last":{"source":"x"}}');
INSERT INTO public.payment_transactions(id, session_id, product_id, customer_email, amount, currency, status)
VALUES ('a7700000-0000-4000-a000-000000000012', 'cs_attr_boom', 'a7700000-0000-4000-a000-000000000001', 'c@example.com', 1000, 'PLN', 'completed');
INSERT INTO public.payment_transactions(id, session_id, product_id, customer_email, amount, currency, status)
VALUES ('a7700000-0000-4000-a000-000000000013', 'cs_attr_boom_plain', 'a7700000-0000-4000-a000-000000000001', 'd@example.com', 1000, 'PLN', 'completed');
SELECT pg_temp.check_that((SELECT count(*) = 2 FROM public.payment_transactions WHERE id IN
  ('a7700000-0000-4000-a000-000000000012', 'a7700000-0000-4000-a000-000000000013')), 'payments survive a failing snapshot');
DROP TRIGGER boom ON public.purchase_attribution;

-- Bulk cost: the snapshot adds one attribution row per order, so some cost is inherent. Before
-- 20261104000000 it was ~7x (non-inlined attribution_text, 17 calls per order); now ~3x.
CREATE TEMP TABLE timings(label text, ms numeric);
DO $$
DECLARE t0 timestamptz;
BEGIN
  ALTER TABLE public.payment_transactions DISABLE TRIGGER snapshot_purchase_attribution;
  t0 := clock_timestamp();
  INSERT INTO public.payment_transactions(session_id, product_id, customer_email, amount, currency, status)
  SELECT 'cs_attr_off_' || g, 'a7700000-0000-4000-a000-000000000001', 'bulk@example.com', 1000, 'PLN', 'completed' FROM generate_series(1, 20000) g;
  INSERT INTO timings VALUES ('off', extract(epoch FROM clock_timestamp() - t0) * 1000);
  ALTER TABLE public.payment_transactions ENABLE TRIGGER snapshot_purchase_attribution;
  t0 := clock_timestamp();
  INSERT INTO public.payment_transactions(session_id, product_id, customer_email, amount, currency, status)
  SELECT 'cs_attr_on_' || g, 'a7700000-0000-4000-a000-000000000001', 'bulk@example.com', 1000, 'PLN', 'completed' FROM generate_series(1, 20000) g;
  INSERT INTO timings VALUES ('on', extract(epoch FROM clock_timestamp() - t0) * 1000);
END $$;
SELECT label, round(ms) AS ms FROM timings;
SELECT pg_temp.check_that((SELECT count(*) = 20000 FROM public.purchase_attribution pa
  JOIN public.payment_transactions pt ON pt.id = pa.transaction_id WHERE pt.session_id LIKE 'cs_attr_on_%'), 'bulk orders are snapshotted');
SELECT pg_temp.check_that((SELECT (SELECT ms FROM timings WHERE label = 'on') < 4 * (SELECT ms FROM timings WHERE label = 'off')),
  'snapshot keeps bulk insert under 4x');
ROLLBACK;
