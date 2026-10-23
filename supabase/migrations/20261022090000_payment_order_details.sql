-- Buyer details are stored with the order before the payment can be confirmed.
--
-- payment_transactions.order_details holds a JSON object of order-level data
-- (first key: "buyer"). Readers are unchanged: the row owner (user_id), admins
-- and service_role, through the existing SELECT policy. No new grants for anon.

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS order_details jsonb;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_order_details_check
  CHECK (
    order_details IS NULL
    OR (
      jsonb_typeof(order_details) = 'object'
      AND octet_length(order_details::text) <= 16384
    )
  );

COMMENT ON COLUMN public.payment_transactions.order_details IS
  'Order-level details as a JSON object (max 16384 bytes). Key "buyer": {v, first_name, last_name, full_name, needs_invoice, nip, company_name, address, city, postal_code, country, terms_accepted, source, saved_at}.';

-- Merge the buyer object into order_details (other keys are kept).
--   p_only_if_missing = false: overwrite "buyer" on the PENDING row of the session / payment intent.
--   p_only_if_missing = true : fill "buyer" on a row of any status, only when it has none yet.
-- Returns the number of rows changed (0 = nothing matched).
CREATE OR REPLACE FUNCTION public.set_payment_order_buyer(
  p_buyer jsonb,
  p_session_id text DEFAULT NULL,
  p_payment_intent_id text DEFAULT NULL,
  p_only_if_missing boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_buyer IS NULL OR jsonb_typeof(p_buyer) <> 'object' THEN
    RAISE EXCEPTION 'buyer must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_session_id IS NULL AND p_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'session or payment intent id is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.payment_transactions
  SET order_details = coalesce(order_details, '{}'::jsonb) || jsonb_build_object('buyer', p_buyer),
      updated_at = now()
  WHERE (session_id = p_session_id OR stripe_payment_intent_id = p_payment_intent_id)
    AND CASE
          WHEN p_only_if_missing THEN order_details -> 'buyer' IS NULL
          ELSE status = 'pending'
        END;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.set_payment_order_buyer(jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_order_buyer(jsonb, text, text, boolean) TO service_role;
