BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE p uuid; v jsonb; c jsonb; orders integer; before_total numeric; before_summary jsonb; after_summary jsonb; grouped_total numeric;
BEGIN
before_total := (public.get_dashboard_stats()->>'totalRevenue')::numeric;
before_summary := public.get_payment_summary(CURRENT_DATE, date_trunc('month', now()));
INSERT INTO public.products(name,slug,price,currency) VALUES ('Retained revenue', 'retained-' || gen_random_uuid(),9,'PLN') RETURNING id INTO p;
INSERT INTO public.payment_transactions (product_id, amount, currency, status, refunded_amount, customer_email, session_id, stripe_payment_intent_id)
VALUES (p,900,'PLN','partially_refunded',100,'revenue@example.com','cs_retained_partial','pi_retained_partial'),
(p,2000,'PLN','completed',0,'revenue@example.com','cs_retained_full','pi_retained_full'),
(p,800,'USD','partially_refunded',200,'revenue@example.com','cs_retained_usd','pi_retained_usd'),
(p,1000,'PLN','refunded',1000,'revenue@example.com','cs_retained_refund','pi_retained_refund');
IF (public.get_dashboard_stats()->>'totalRevenue')::numeric - before_total <> 3400 THEN RAISE EXCEPTION 'Wrong overview retained total'; END IF;
after_summary := public.get_payment_summary(CURRENT_DATE, date_trunc('month', now()));
IF (after_summary->'total_revenue_by_currency'->>'PLN')::numeric - coalesce((before_summary->'total_revenue_by_currency'->>'PLN')::numeric, 0) <> 2800 THEN RAISE EXCEPTION 'Wrong payment summary'; END IF;
SELECT coalesce(sum((item->>'amount')::numeric),0) INTO grouped_total FROM jsonb_array_elements(public.get_revenue_groups(NULL,NULL,p)) item;
IF grouped_total <> 3400 THEN RAISE EXCEPTION 'Wrong grouped retained amount'; END IF;
IF has_function_privilege('anon', 'public.get_payment_summary(timestamptz,timestamptz)', 'execute') THEN RAISE EXCEPTION 'Unexpected summary permission'; END IF;
v := public.get_detailed_revenue_stats(p, now() - interval '1 minute');
IF v->'totalRevenue' <> '{"PLN":2800,"USD":600}'::jsonb OR v->'todayRevenue' <> v->'totalRevenue' OR (v->>'todayOrders')::integer <> 3 THEN RAISE EXCEPTION 'Wrong retained revenue: %', v; END IF;
SELECT amount_by_currency, s.orders INTO c, orders FROM public.get_sales_chart_data(now()-interval '1 minute', now()+interval '1 minute',p,'UTC') s;
IF c <> v->'totalRevenue' OR orders <> 3 THEN RAISE EXCEPTION 'Wrong daily chart: %, %',c,orders; END IF;
SELECT amount_by_currency, s.orders INTO c, orders FROM public.get_hourly_revenue_stats(CURRENT_DATE,p,'UTC') s WHERE s.hour=extract(hour from now() at time zone 'UTC');
IF c <> v->'totalRevenue' OR orders <> 3 THEN RAISE EXCEPTION 'Wrong hourly chart: %, %',c,orders; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_detailed_revenue_stats();
    RAISE EXCEPTION 'Anonymous revenue call was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_payment_summary(CURRENT_DATE, date_trunc('month', now()));
    RAISE EXCEPTION 'Anonymous summary call was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_revenue_groups();
    RAISE EXCEPTION 'Anonymous revenue groups call was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_detailed_revenue_stats();
    RAISE EXCEPTION 'Non-admin revenue call was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Access denied' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_payment_summary(CURRENT_DATE, date_trunc('month', now()));
    RAISE EXCEPTION 'Non-admin summary call was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Access denied' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_revenue_groups();
    RAISE EXCEPTION 'Non-admin revenue groups call was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Access denied' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL TIME ZONE 'Etc/GMT+12';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE p uuid; stamp timestamptz; expected numeric; actual numeric;
BEGIN
  IF extract(hour FROM now() AT TIME ZONE 'UTC') >= 12 THEN
    stamp := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 hour'; expected := 100;
  ELSE
    stamp := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 hour'; expected := 0;
  END IF;
  INSERT INTO public.products(name,slug,price,currency) VALUES ('UTC revenue', 'utc-revenue-' || gen_random_uuid(),1,'PLN') RETURNING id INTO p;
  INSERT INTO public.payment_transactions(product_id,amount,currency,status,customer_email,session_id,created_at)
  VALUES(p,100,'PLN','completed','revenue@example.com','cs_utc_revenue',stamp);
  actual := coalesce((public.get_detailed_revenue_stats(p)->'todayRevenue'->>'PLN')::numeric, 0);
  IF actual <> expected THEN RAISE EXCEPTION 'UTC daily revenue expected %, got %', expected, actual; END IF;
END $$;
ROLLBACK;
