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
-- Existing history rows are never edited; each repaired product gets one new current row.
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM before_history b JOIN public.product_price_history h USING (id) WHERE h.vat_rate IS DISTINCT FROM b.vat_rate OR h.price IS DISTINCT FROM b.price), 'existing price history rows keep their recorded values');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id WHERE p.slug = 'vr-inherited' AND h.effective_until IS NULL AND h.vat_rate = 23.00), 'one current history row carries the corrected rate');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id WHERE p.slug = 'vr-inherited' AND h.effective_until IS NOT NULL AND h.vat_rate = 0.23), 'previous history row kept and closed');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.product_price_history h JOIN public.products p ON p.id = h.product_id WHERE p.slug IN ('vr-23', 'vr-zero', 'vr-8', 'vr-1', 'vr-null') AND h.effective_until IS NOT NULL), 'unaffected products get no new history');

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
