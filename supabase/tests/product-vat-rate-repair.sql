\set ON_ERROR_STOP on
-- Product VAT rate units repair (migration 20261017173304_product_vat_rate_units_repair.sql).
-- Run on a fully migrated local stack, from a file (the repair is pulled in with \ir):
--   psql -h 127.0.0.1 -p <db port> -U postgres -v ON_ERROR_STOP=1 -f supabase/tests/product-vat-rate-repair.sql
-- Everything is rolled back. `-v repair=<path>` points \ir at another file (used to prove RED).
\if :{?repair}
\else
  \set repair ../migrations/20261017173304_product_vat_rate_units_repair.sql
\endif
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
CREATE FUNCTION pg_temp.rate(p_slug text) RETURNS numeric LANGUAGE sql AS $$
  SELECT vat_rate FROM public.products WHERE slug = p_slug;
$$;
-- ---------------------------------------------------------------------------
-- Fixtures. Rows reach the state older installations hold by running the
-- pre-fix default (shop fraction copied unchanged) before the repair.
-- ---------------------------------------------------------------------------
UPDATE public.shop_config SET tax_rate = 0.23, is_vat_exempt = false;
CREATE OR REPLACE FUNCTION public.apply_shop_vat_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tax_rate numeric; v_vat_exempt boolean; v_exempt_note text;
BEGIN
  SELECT tax_rate, is_vat_exempt, vat_exempt_note INTO v_tax_rate, v_vat_exempt, v_exempt_note
    FROM public.shop_config ORDER BY created_at LIMIT 1;
  IF NEW.vat_rate IS NULL AND NEW.vat_exempt = false THEN
    IF v_vat_exempt THEN NEW.vat_exempt := true;
    ELSIF v_tax_rate IS NOT NULL THEN NEW.vat_rate := v_tax_rate; END IF;
  END IF;
  IF NEW.vat_exempt = true AND NEW.vat_exempt_note IS NULL THEN NEW.vat_exempt_note := v_exempt_note; END IF;
  RETURN NEW;
END;
$$;

-- Inherited through the old default (vat_rate omitted, not exempt) -> stored as 0.23.
INSERT INTO public.products (name, slug, price, currency) VALUES ('Inherited', 'vr-inherited', 100, 'PLN');
INSERT INTO public.products (name, slug, price, currency) VALUES ('Inherited paid', 'vr-inherited-paid', 49, 'PLN');
-- Entered explicitly.
INSERT INTO public.products (name, slug, price, currency, vat_rate) VALUES
  ('Correct 23', 'vr-23', 10, 'PLN', 23.00),
  ('Zero rated', 'vr-zero', 10, 'PLN', 0),
  ('Wrong 5', 'vr-frac-005', 10, 'PLN', 0.05),
  ('Wrong 8', 'vr-frac-008', 10, 'PLN', 0.08),
  ('Wrong 1 percent', 'vr-frac-001', 10, 'PLN', 0.01),
  ('Wrong 99', 'vr-frac-099', 10, 'PLN', 0.99),
  ('Correct 8', 'vr-8', 10, 'PLN', 8.00),
  ('Correct 5', 'vr-5', 10, 'PLN', 5.00),
  ('Boundary 1', 'vr-1', 10, 'PLN', 1.00),
  ('Large', 'vr-100', 10, 'PLN', 100.00);
INSERT INTO public.products (name, slug, price, currency, vat_rate, vat_exempt) VALUES
  ('Exempt stored fraction', 'vr-exempt-frac', 10, 'PLN', 0.23, true),
  ('Exempt stored rate', 'vr-exempt-23', 10, 'PLN', 23.00, true);
-- Subscriptions saved without a gross/net choice (form hid it): fraction + net flag.
INSERT INTO public.products (name, slug, price, currency, vat_rate, price_includes_vat, product_type, recurring_price, billing_interval, billing_interval_count) VALUES
  ('Sub fraction', 'vr-sub-frac', 0, 'PLN', 0.23, false, 'subscription', 29, 'month', 1),
  ('Sub correct net', 'vr-sub-23-net', 0, 'PLN', 23.00, false, 'subscription', 29, 'month', 1),
  ('One-time net fraction', 'vr-net-frac', 10, 'PLN', 0.08, false, 'one_time', NULL, NULL, NULL);
-- Product on an active sale, fraction rate: Omnibus history must not move.
INSERT INTO public.products (name, slug, price, currency, vat_rate, sale_price, sale_price_until) VALUES
  ('On sale', 'vr-on-sale', 100, 'PLN', 0.23, 80, now() + interval '7 days');
-- Product with no rate at all (rate cleared after creation).
INSERT INTO public.products (name, slug, price, currency, vat_rate) VALUES ('No rate', 'vr-null', 10, 'PLN', 23.00);
UPDATE public.products SET vat_rate = NULL WHERE slug = 'vr-null';

SELECT pg_temp.assert_true(pg_temp.rate('vr-inherited') = 0.23 AND pg_temp.rate('vr-inherited-paid') = 0.23, 'fixture: old default produced fractions');

-- Completed and pending payments that reference an affected product.
INSERT INTO public.payment_transactions (id, session_id, product_id, customer_email, amount, currency, status, tax_snapshot_status, net_total, tax_total)
SELECT 'aaaaaaaa-0000-4000-a000-0000000000a1', 'cs_vatrepair_done', id, 'buyer@example.com', 4900, 'PLN', 'completed', 'captured', 4890, 10
  FROM public.products WHERE slug = 'vr-inherited-paid';
INSERT INTO public.payment_line_items (id, transaction_id, product_id, item_type, quantity, unit_price, total_price, currency, vat_rate, tax_amount, net_amount, tax_behavior)
SELECT 'bbbbbbbb-0000-4000-b000-0000000000b1', 'aaaaaaaa-0000-4000-a000-0000000000a1', id, 'main_product', 1, 49, 49, 'PLN', 0.23, 10, 4890, 'inclusive'
  FROM public.products WHERE slug = 'vr-inherited-paid';
INSERT INTO public.payment_transactions (id, session_id, product_id, customer_email, amount, currency, status)
SELECT 'aaaaaaaa-0000-4000-a000-0000000000a2', 'cs_vatrepair_open', id, 'buyer2@example.com', 4900, 'PLN', 'pending'
  FROM public.products WHERE slug = 'vr-inherited-paid';
INSERT INTO public.payment_line_items (id, transaction_id, product_id, item_type, quantity, unit_price, total_price, currency)
SELECT 'bbbbbbbb-0000-4000-b000-0000000000b2', 'aaaaaaaa-0000-4000-a000-0000000000a2', id, 'main_product', 1, 49, 49, 'PLN'
  FROM public.products WHERE slug = 'vr-inherited-paid';

CREATE TEMP TABLE before_state AS
  SELECT (SELECT string_agg(t::text, '|' ORDER BY t.id) FROM public.payment_transactions t) AS tx,
         (SELECT string_agg(l::text, '|' ORDER BY l.id) FROM public.payment_line_items l) AS li,
         (SELECT string_agg(p.slug || '=' || coalesce(p.vat_rate::text, 'null') || '/' || p.vat_exempt, ',' ORDER BY p.slug)
            FROM public.products p WHERE p.slug NOT LIKE 'vr-%') AS other_products;
CREATE TEMP TABLE before_history AS SELECT * FROM public.product_price_history;
CREATE FUNCTION pg_temp.history_dump() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(h::text, '|' ORDER BY h.id), '') FROM public.product_price_history h;
$$;
-- The Omnibus reference: lowest price applied in the last 30 days, per product.
CREATE FUNCTION pg_temp.lowest_30(p_slug text) RETURNS numeric LANGUAGE sql AS $$
  SELECT min(least(h.price, coalesce(h.sale_price, h.price)))
    FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id
   WHERE p.slug = p_slug AND coalesce(h.effective_until, now()) >= now() - interval '30 days';
$$;
CREATE TEMP TABLE before_dump AS SELECT pg_temp.history_dump() AS dump, pg_temp.lowest_30('vr-on-sale') AS lowest,
  (SELECT count(*) FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id WHERE p.slug = 'vr-on-sale') AS on_sale_rows;

-- ---------------------------------------------------------------------------
-- First run
-- ---------------------------------------------------------------------------
\ir :repair

SELECT pg_temp.assert_true(pg_temp.rate('vr-inherited') = 23.00, 'inherited fraction 0.23 -> 23.00');
SELECT pg_temp.assert_true(pg_temp.rate('vr-inherited-paid') = 23.00, 'second inherited product -> 23.00');
SELECT pg_temp.assert_true(pg_temp.rate('vr-frac-005') = 5.00, 'reduced 0.05 -> 5.00');
SELECT pg_temp.assert_true(pg_temp.rate('vr-frac-008') = 8.00, 'reduced 0.08 -> 8.00');
SELECT pg_temp.assert_true(pg_temp.rate('vr-frac-001') = 1.00, 'smallest fraction 0.01 -> 1.00');
SELECT pg_temp.assert_true(pg_temp.rate('vr-frac-099') = 99.00, 'largest fraction 0.99 -> 99.00');
SELECT pg_temp.assert_true(pg_temp.rate('vr-23') = 23.00, 'correct 23.00 unchanged');
SELECT pg_temp.assert_true(pg_temp.rate('vr-zero') = 0, 'zero-rated stays 0');
SELECT pg_temp.assert_true(pg_temp.rate('vr-null') IS NULL, 'NULL stays NULL');
SELECT pg_temp.assert_true(pg_temp.rate('vr-8') = 8.00 AND pg_temp.rate('vr-5') = 5.00, 'correct reduced rates unchanged');
SELECT pg_temp.assert_true(pg_temp.rate('vr-1') = 1.00, 'rate exactly 1.00 unchanged');
SELECT pg_temp.assert_true(pg_temp.rate('vr-100') = 100.00, 'rate 100.00 unchanged');
SELECT pg_temp.assert_true(pg_temp.rate('vr-exempt-frac') = 23.00, 'exempt product holding a fraction is rescaled');
SELECT pg_temp.assert_true(pg_temp.rate('vr-exempt-23') = 23.00, 'exempt product with a rate unchanged');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.products WHERE slug IN ('vr-exempt-frac', 'vr-exempt-23') AND vat_exempt), 'exemption flags untouched');
SELECT pg_temp.assert_true((SELECT other_products = (SELECT string_agg(p.slug || '=' || coalesce(p.vat_rate::text, 'null') || '/' || p.vat_exempt, ',' ORDER BY p.slug) FROM public.products p WHERE p.slug NOT LIKE 'vr-%') FROM before_state), 'seeded products untouched');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.products WHERE vat_rate > 0 AND vat_rate < 1), 'no fractional rate remains');

-- Financial records keep what was recorded.
SELECT pg_temp.assert_true((SELECT tx = (SELECT string_agg(t::text, '|' ORDER BY t.id) FROM public.payment_transactions t) FROM before_state), 'payment_transactions unchanged');
SELECT pg_temp.assert_true((SELECT li = (SELECT string_agg(l::text, '|' ORDER BY l.id) FROM public.payment_line_items l) FROM before_state), 'payment_line_items unchanged');
SELECT pg_temp.assert_true((SELECT vat_rate = 0.23 AND tax_amount = 10 AND net_amount = 4890 FROM public.payment_line_items WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000b1'), 'completed line item snapshot keeps recorded rate');
SELECT pg_temp.assert_true((SELECT vat_rate IS NULL FROM public.payment_line_items WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000b2'), 'pending line item stays empty');
SELECT pg_temp.assert_true((SELECT status = 'completed' AND tax_total = 10 FROM public.payment_transactions WHERE id = 'aaaaaaaa-0000-4000-a000-0000000000a1'), 'completed payment totals unchanged');
-- Subscriptions: rate fixed and the price becomes gross; correct rows and net one-time untouched flags.
SELECT pg_temp.assert_true((SELECT vat_rate = 23.00 AND price_includes_vat FROM public.products WHERE slug = 'vr-sub-frac'), 'subscription fraction -> 23.00 and price includes VAT');
SELECT pg_temp.assert_true((SELECT vat_rate = 23.00 AND NOT price_includes_vat FROM public.products WHERE slug = 'vr-sub-23-net'), 'subscription with a correct rate keeps its flag');
SELECT pg_temp.assert_true((SELECT vat_rate = 8.00 AND NOT price_includes_vat FROM public.products WHERE slug = 'vr-net-frac'), 'one-time fraction rescaled, gross/net flag untouched');

-- Price history is never edited and the repair adds no row (price did not change).
SELECT pg_temp.assert_true((SELECT dump = pg_temp.history_dump() FROM before_dump), 'price history identical before and after the repair');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM before_history b JOIN public.product_price_history h USING (id) WHERE h.vat_rate IS DISTINCT FROM b.vat_rate OR h.price IS DISTINCT FROM b.price), 'existing price history rows keep their recorded values');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id WHERE p.slug = 'vr-inherited' AND h.effective_until IS NULL AND h.vat_rate = 0.23), 'repaired product keeps its single open history row');
-- Product on an active sale keeps its Omnibus reference.
SELECT pg_temp.assert_true((SELECT on_sale_rows = (SELECT count(*) FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id WHERE p.slug = 'vr-on-sale') FROM before_dump), 'on-sale product: no new history row');
SELECT pg_temp.assert_true((SELECT lowest IS NOT DISTINCT FROM pg_temp.lowest_30('vr-on-sale') FROM before_dump), 'on-sale product: lowest price in 30 days identical before/after');
SELECT pg_temp.assert_true(pg_temp.rate('vr-on-sale') = 23.00, 'on-sale product rate repaired');
-- Trigger is enabled again after the repair.
SELECT pg_temp.assert_true((SELECT tgenabled = 'O' FROM pg_trigger WHERE tgrelid = 'public.products'::regclass AND tgname = 'product_price_change_trigger'), 'price change trigger re-enabled');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.products'::regclass AND tgname = 'product_price_change_trigger'), 'price change trigger exists');
-- A real price change after the repair is still logged.
UPDATE public.products SET sale_price = 70 WHERE slug = 'vr-on-sale';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id WHERE p.slug = 'vr-on-sale') = (SELECT on_sale_rows + 1 FROM before_dump), 'later price change is still logged by the trigger');
UPDATE public.products SET sale_price = 80 WHERE slug = 'vr-on-sale';

-- Default trigger: shop rate as a fraction or already in percentage points.
UPDATE public.shop_config SET tax_rate = 0.23, is_vat_exempt = false;
INSERT INTO public.products (name, slug, price, currency) VALUES ('Default fraction', 'vr-def-frac', 10, 'PLN');
SELECT pg_temp.assert_true(pg_temp.rate('vr-def-frac') = 23.00, 'trigger: shop rate 0.23 -> product 23.00');
UPDATE public.shop_config SET tax_rate = 23;
INSERT INTO public.products (name, slug, price, currency) VALUES ('Default points', 'vr-def-pts', 10, 'PLN');
SELECT pg_temp.assert_true(pg_temp.rate('vr-def-pts') = 23.00, 'trigger: shop rate 23 -> product 23.00 (no overflow)');
UPDATE public.shop_config SET tax_rate = 0.05;
INSERT INTO public.products (name, slug, price, currency) VALUES ('Default reduced', 'vr-def-5', 10, 'PLN');
SELECT pg_temp.assert_true(pg_temp.rate('vr-def-5') = 5.00, 'trigger: shop rate 0.05 -> product 5.00');
UPDATE public.shop_config SET tax_rate = 0.23;
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.apply_shop_vat_defaults()'::regprocedure), 'trigger function stays SECURITY DEFINER with empty search_path');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.apply_shop_vat_defaults()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.apply_shop_vat_defaults()', 'EXECUTE'), 'trigger function not executable by anon/authenticated');

-- ---------------------------------------------------------------------------
-- Second run: nothing changes.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE after_first AS
  SELECT (SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.products p) AS products,
         (SELECT string_agg(h::text, '|' ORDER BY h.id) FROM public.product_price_history h) AS history,
         (SELECT string_agg(t::text, '|' ORDER BY t.id) FROM public.payment_transactions t) AS tx,
         (SELECT string_agg(l::text, '|' ORDER BY l.id) FROM public.payment_line_items l) AS li;
\ir :repair
SELECT pg_temp.assert_true((SELECT products = (SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.products p) FROM after_first), 'second run: products identical (idempotent)');
SELECT pg_temp.assert_true((SELECT history = (SELECT string_agg(h::text, '|' ORDER BY h.id) FROM public.product_price_history h) FROM after_first), 'second run: history identical');
SELECT pg_temp.assert_true((SELECT tx = (SELECT string_agg(t::text, '|' ORDER BY t.id) FROM public.payment_transactions t) AND li = (SELECT string_agg(l::text, '|' ORDER BY l.id) FROM public.payment_line_items l) FROM after_first), 'second run: payments identical');

-- ---------------------------------------------------------------------------
-- Exempt shop: products created under an exempt shop carry no rate and stay so.
-- ---------------------------------------------------------------------------
UPDATE public.shop_config SET is_vat_exempt = true, vat_exempt_note = 'zw.';
INSERT INTO public.products (name, slug, price, currency) VALUES ('Shop exempt', 'vr-shop-exempt', 10, 'PLN');
SELECT pg_temp.assert_true((SELECT vat_exempt AND vat_rate IS NULL FROM public.products WHERE slug = 'vr-shop-exempt'), 'fixture: exempt shop product has no rate');
\ir :repair
SELECT pg_temp.assert_true((SELECT vat_exempt AND vat_rate IS NULL AND vat_exempt_note = 'zw.' FROM public.products WHERE slug = 'vr-shop-exempt'), 'exempt shop product untouched');
SELECT pg_temp.assert_true(pg_temp.rate('vr-inherited') = 23.00, 'earlier repairs hold after exempt-shop run');
ROLLBACK;
