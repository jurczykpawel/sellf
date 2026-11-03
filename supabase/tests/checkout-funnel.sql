-- Run after applying release migrations; all test fixtures are rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The 100k-row fixture measures the funnel, not purchase attribution. The per-row attribution
-- snapshot (20261103120000, one subtransaction per row) made this INSERT 4-30x slower and hit the
-- statement timeout in the release gate. Rolled back with the rest of the fixture.
ALTER TABLE public.payment_transactions DISABLE TRIGGER snapshot_purchase_attribution;
CREATE TEMP TABLE funnel_products AS
SELECT gen_random_uuid() AS id, n FROM generate_series(1, 120) n;
INSERT INTO public.products(id, name, slug, price, currency)
SELECT id, 'Funnel test ' || n, 'funnel-test-' || id, 10, 'USD' FROM funnel_products;
INSERT INTO public.payment_transactions(session_id, product_id, customer_email, amount, currency, status, created_at)
SELECT 'cs_funnel_' || replace(gen_random_uuid()::text, '-', ''), p.id, 'pending@sellf.app', 1000,
  (ARRAY['USD','PLN','EUR'])[1 + (g.n / 120) % 3],
  (ARRAY['completed','refunded','partially_refunded','disputed','pending','abandoned','awaiting_payment','cancelled'])[1 + (g.n / 360) % 8],
  now() - ((g.n % 90) * interval '1 day')
FROM generate_series(0, 99999) g(n) JOIN funnel_products p ON p.n = 1 + g.n % 120;
ANALYZE public.payment_transactions;

-- Explicit function privileges and internal role checks.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_checkout_funnel(integer,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_checkout_funnel(integer,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_checkout_funnel(integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected function grants';
  END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.get_checkout_funnel();
    RAISE EXCEPTION 'Expected admin-only result';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    PERFORM public.get_checkout_funnel(0);
    RAISE EXCEPTION 'Expected invalid period';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

CREATE TEMP TABLE funnel_actual AS SELECT public.get_checkout_funnel(90) AS data;
DO $$
DECLARE actual jsonb; expected jsonb; pid uuid; item jsonb; days integer;
BEGIN
  SELECT data INTO actual FROM funnel_actual;
  SELECT jsonb_build_object('started',count(*),
    'paid',count(*) FILTER (WHERE status IN ('completed','refunded','partially_refunded','disputed')),
    'pending',count(*) FILTER (WHERE status='pending'),
    'abandoned',count(*) FILTER (WHERE status='abandoned'),
    'other',count(*) FILTER (WHERE status NOT IN ('completed','refunded','partially_refunded','disputed','pending','abandoned'))) INTO expected
  FROM public.payment_transactions WHERE created_at BETWEEN now()-interval '90 days' AND now();
  IF actual->'totals' <> expected OR jsonb_array_length(actual->'products') <> 100 THEN
    RAISE EXCEPTION 'Totals or output bound mismatch';
  END IF;
  FOR item IN SELECT jsonb_array_elements(actual->'products') LOOP
    pid := (item->>'productId')::uuid;
    SELECT jsonb_build_object('started',count(*),
      'paid',count(*) FILTER (WHERE status IN ('completed','refunded','partially_refunded','disputed')),
      'pending',count(*) FILTER (WHERE status='pending'),
      'abandoned',count(*) FILTER (WHERE status='abandoned'),
    'other',count(*) FILTER (WHERE status NOT IN ('completed','refunded','partially_refunded','disputed','pending','abandoned'))) INTO expected
    FROM public.payment_transactions WHERE product_id=pid
      AND created_at BETWEEN now()-interval '90 days' AND now();
    IF expected <> item - 'productId' - 'name'
       OR public.get_checkout_funnel(90, pid)->'totals' <> expected THEN
      RAISE EXCEPTION 'Product counts mismatch';
    END IF;
  END LOOP;
  FOREACH days IN ARRAY ARRAY[7,30] LOOP
    SELECT jsonb_build_object('started',count(*),
      'paid',count(*) FILTER (WHERE status IN ('completed','refunded','partially_refunded','disputed')),
      'pending',count(*) FILTER (WHERE status='pending'),
      'abandoned',count(*) FILTER (WHERE status='abandoned'),
    'other',count(*) FILTER (WHERE status NOT IN ('completed','refunded','partially_refunded','disputed','pending','abandoned'))) INTO expected
    FROM public.payment_transactions
    WHERE created_at BETWEEN now()-make_interval(days => days) AND now();
    IF public.get_checkout_funnel(days)->'totals' <> expected THEN
      RAISE EXCEPTION 'Period counts mismatch';
    END IF;
  END LOOP;
  IF public.get_checkout_funnel(90, gen_random_uuid())->'totals'->>'started' <> '0' THEN
    RAISE EXCEPTION 'Expected empty filtered result';
  END IF;
  -- The cards must add up: every recorded attempt lands in exactly one bucket.
  IF (actual->'totals'->>'started')::bigint <> (actual->'totals'->>'paid')::bigint + (actual->'totals'->>'pending')::bigint
     + (actual->'totals'->>'abandoned')::bigint + (actual->'totals'->>'other')::bigint
     OR (actual->'totals'->>'other')::bigint = 0 THEN
    RAISE EXCEPTION 'Funnel buckets do not add up to recorded attempts';
  END IF;
  RAISE NOTICE 'Totals %, top products %', actual->'totals', jsonb_array_length(actual->'products');
END $$;

-- Compare SQL execution time with the former 1000-row paging queries.
DO $$
DECLARE plan json; elapsed_ms numeric := 0; pages integer; i integer;
BEGIN
  SELECT count(*)::integer / 1000 + 1 INTO pages FROM public.payment_transactions
    WHERE created_at BETWEEN now()-interval '90 days' AND now();
  FOR i IN 0..pages-1 LOOP
    EXECUTE format('EXPLAIN (ANALYZE, FORMAT JSON) SELECT pt.status, pt.product_id, p.name
      FROM public.payment_transactions pt LEFT JOIN public.products p ON p.id=pt.product_id
      WHERE pt.created_at BETWEEN now()-interval ''90 days'' AND now()
      ORDER BY pt.created_at, pt.id LIMIT 1000 OFFSET %s', i*1000) INTO plan;
    elapsed_ms := elapsed_ms + (plan->0->>'Execution Time')::numeric;
  END LOOP;
  RAISE NOTICE 'Previous paging: % queries, % ms SQL execution (excludes network and JS)', pages, elapsed_ms;
END $$;
EXPLAIN (ANALYZE, BUFFERS) SELECT public.get_checkout_funnel(90);

-- Export the same rows and aggregate for comparison with the original JS reducer.
\copy (SELECT jsonb_agg(jsonb_build_object('status', pt.status, 'product_id', pt.product_id, 'products', jsonb_build_object('name', p.name))) FROM public.payment_transactions pt LEFT JOIN public.products p ON p.id=pt.product_id WHERE pt.created_at BETWEEN now()-interval '90 days' AND now()) TO '/tmp/sellf-funnel-before.json'
\copy (SELECT data FROM funnel_actual) TO '/tmp/sellf-funnel-after.json'
ROLLBACK;
