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

-- A multi-row INSERT snapshots each plain order with the same defaults as a single one.
SELECT public.store_checkout_attribution('cs_attr_utm2', '{"mode":"url","last":{"source":"partner-blog"}}');
INSERT INTO public.payment_transactions(id, session_id, product_id, customer_email, amount, currency, status, payment_provider, pricing_snapshot_version)
VALUES ('a7700000-0000-4000-a000-000000000020', 'cs_attr_multi_1', 'a7700000-0000-4000-a000-000000000001', 'e@example.com', 1000, 'PLN', 'completed', 'stripe', NULL),
       ('a7700000-0000-4000-a000-000000000021', NULL, 'a7700000-0000-4000-a000-000000000001', 'f@example.com', 1000, 'PLN', 'awaiting_payment', 'bank_transfer', 1),
       ('a7700000-0000-4000-a000-000000000022', 'cs_attr_multi_3', 'a7700000-0000-4000-a000-000000000001', 'g@example.com', 1000, 'PLN', 'pending', 'stripe', NULL),
       ('a7700000-0000-4000-a000-000000000023', 'cs_attr_utm2', 'a7700000-0000-4000-a000-000000000001', 'h@example.com', 1000, 'PLN', 'completed', 'stripe', NULL);
SELECT pg_temp.check_that((SELECT count(*) = 1 FROM public.purchase_attribution WHERE transaction_id = 'a7700000-0000-4000-a000-000000000020'
  AND kind = 'payment' AND channel = 'unknown' AND mode = 'none' AND consent = 'none' AND device_class = 'unknown' AND first_channel IS NULL
  AND last_source IS NULL AND click_id IS NULL), 'multi-row plain order gets the unknown snapshot');
SELECT pg_temp.check_that((SELECT kind = 'bank_transfer' FROM public.purchase_attribution WHERE transaction_id = 'a7700000-0000-4000-a000-000000000021'),
  'bank transfer kind in a multi-row insert');
SELECT pg_temp.check_that(NOT EXISTS (SELECT 1 FROM public.purchase_attribution WHERE transaction_id = 'a7700000-0000-4000-a000-000000000022'),
  'pending order is not snapshotted');
SELECT pg_temp.check_that((SELECT last_source = 'partner-blog' AND channel <> 'unknown' FROM public.purchase_attribution
  WHERE transaction_id = 'a7700000-0000-4000-a000-000000000023'), 'payload row in a multi-row insert is classified');
UPDATE public.payment_transactions SET status = 'completed' WHERE id = 'a7700000-0000-4000-a000-000000000022';
SELECT pg_temp.check_that((SELECT channel = 'unknown' FROM public.purchase_attribution WHERE transaction_id = 'a7700000-0000-4000-a000-000000000022'),
  'status change to paid snapshots once');

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
-- 20261104000000 it was ~7x (non-inlined attribution_text, 17 calls per order), ~3x per-row after it;
-- 20261104010000 snapshots plain orders of a multi-row INSERT in one set-based statement.
CREATE TEMP TABLE timings(label text, ms numeric);
DO $$
DECLARE t0 timestamptz;
BEGIN
  ALTER TABLE public.payment_transactions DISABLE TRIGGER snapshot_purchase_attribution;
  ALTER TABLE public.payment_transactions DISABLE TRIGGER snapshot_purchase_attribution_inserted;
  t0 := clock_timestamp();
  INSERT INTO public.payment_transactions(session_id, product_id, customer_email, amount, currency, status)
  SELECT 'cs_attr_off_' || g, 'a7700000-0000-4000-a000-000000000001', 'bulk@example.com', 1000, 'PLN', 'completed' FROM generate_series(1, 20000) g;
  INSERT INTO timings VALUES ('off', extract(epoch FROM clock_timestamp() - t0) * 1000);
  ALTER TABLE public.payment_transactions ENABLE TRIGGER snapshot_purchase_attribution;
  ALTER TABLE public.payment_transactions ENABLE TRIGGER snapshot_purchase_attribution_inserted;
  t0 := clock_timestamp();
  INSERT INTO public.payment_transactions(session_id, product_id, customer_email, amount, currency, status)
  SELECT 'cs_attr_on_' || g, 'a7700000-0000-4000-a000-000000000001', 'bulk@example.com', 1000, 'PLN', 'completed' FROM generate_series(1, 20000) g;
  INSERT INTO timings VALUES ('on', extract(epoch FROM clock_timestamp() - t0) * 1000);
END $$;
SELECT label, round(ms) AS ms FROM timings;
SELECT pg_temp.check_that((SELECT count(*) = 20000 FROM public.purchase_attribution pa
  JOIN public.payment_transactions pt ON pt.id = pa.transaction_id WHERE pt.session_id LIKE 'cs_attr_on_%'), 'bulk orders are snapshotted');
SELECT pg_temp.check_that((SELECT (SELECT ms FROM timings WHERE label = 'on') < 2 * (SELECT ms FROM timings WHERE label = 'off')),
  'snapshot keeps bulk insert under 2x (per-row path was ~3x)');
ROLLBACK;
