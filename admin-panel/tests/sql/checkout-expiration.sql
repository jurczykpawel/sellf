-- Completion remains authoritative regardless of expiration delivery order.
-- Run with docker exec -i supabase_db_sellf psql -U postgres -v ON_ERROR_STOP=1.
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
<<checkout_expiration>>
DECLARE
  product_id uuid := gen_random_uuid();
  transaction_id uuid;
  result jsonb;
  initial_status text;
  session_id text;
  transaction_status text;
BEGIN
  IF has_function_privilege('anon', 'public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected completion function grants';
  END IF;
  RAISE NOTICE 'PASS completion function grants';

  INSERT INTO public.products (id, name, slug, price, currency, is_active, vat_exempt)
  VALUES (product_id, 'Checkout expiration test', 'expiration-test-' || product_id, 10, 'USD', true, true);

  FOREACH initial_status IN ARRAY ARRAY['abandoned', 'pending'] LOOP
    session_id := 'cs_test_expiration_' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.payment_transactions (session_id, product_id, customer_email, amount, currency, status)
    VALUES (session_id, product_id, 'expiration-check@example.com', 1000, 'USD', initial_status)
    RETURNING id INTO transaction_id;

    result := public.process_stripe_payment_completion_with_bump(
      session_id, product_id, 'expiration-check@example.com', 1000, 'USD',
      'pi_expiration_' || replace(gen_random_uuid()::text, '-', '')
    );
    IF NOT coalesce((result->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'Completion from % failed: %', initial_status, result;
    END IF;
    UPDATE public.payment_transactions SET status = 'abandoned'
    WHERE id = transaction_id AND status = 'pending';
    SELECT status INTO transaction_status FROM public.payment_transactions WHERE id = transaction_id;
    IF transaction_status <> 'completed' THEN
      RAISE EXCEPTION 'Completion did not win from %: %', initial_status, transaction_status;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.guest_purchases gp WHERE gp.session_id = checkout_expiration.session_id) THEN
      RAISE EXCEPTION 'Missing guest access';
    END IF;
    RAISE NOTICE 'PASS completion from %, followed by expiration', initial_status;
  END LOOP;

  session_id := 'cs_test_expiration_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.payment_transactions (session_id, product_id, customer_email, amount, currency, status)
  VALUES (session_id, product_id, 'expiration-check@example.com', 1000, 'USD', 'abandoned')
  RETURNING id INTO transaction_id;
  BEGIN
    result := public.process_stripe_payment_completion_with_bump(
      session_id, product_id, 'expiration-check@example.com', 500, 'USD',
      'pi_expiration_' || replace(gen_random_uuid()::text, '-', '')
    );
    IF coalesce((result->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'Unexpected completion at incorrect amount';
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Amount mismatch:%' THEN RAISE; END IF;
  END;
  SELECT status INTO transaction_status FROM public.payment_transactions WHERE id = transaction_id;
  IF transaction_status <> 'abandoned' THEN
    RAISE EXCEPTION 'Failed completion did not preserve abandoned status';
  END IF;
  RAISE NOTICE 'PASS unsuccessful completion preserves abandoned status';

END;
$$;
ROLLBACK;
