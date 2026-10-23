-- Per-product checkout profiles and pending order module details.
ALTER TABLE public.payment_transactions DROP CONSTRAINT payment_transactions_order_details_check;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_order_details_check CHECK (
  order_details IS NULL OR (jsonb_typeof(order_details) = 'object' AND octet_length(order_details::text) <= 65536)
);
COMMENT ON COLUMN public.payment_transactions.order_details IS 'Versioned order module details (max 65536 bytes).';
ALTER TABLE public.products ADD COLUMN checkout_profile jsonb;
ALTER TABLE public.products ADD CONSTRAINT products_checkout_profile_check CHECK (
  checkout_profile IS NULL OR (jsonb_typeof(checkout_profile) = 'object' AND octet_length(checkout_profile::text) <= 8192)
);
GRANT SELECT (checkout_profile) ON public.products TO anon, authenticated;

CREATE FUNCTION public.audit_checkout_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.checkout_profile IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND OLD.checkout_profile IS DISTINCT FROM NEW.checkout_profile) THEN
    INSERT INTO public.audit_log(table_name, operation, new_values, user_id, performed_by)
    VALUES ('products', 'UPDATE', jsonb_build_object('action', 'product.checkout_profile.update', 'product_id', NEW.id,
      'enabled', NEW.checkout_profile IS NOT NULL), (select auth.uid()), (select auth.uid()));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_checkout_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER products_checkout_profile_audit AFTER INSERT OR UPDATE OF checkout_profile ON public.products
FOR EACH ROW EXECUTE FUNCTION public.audit_checkout_profile();

CREATE FUNCTION public.set_payment_order_details(
  p_details jsonb, p_product_id uuid, p_quantity integer,
  p_session_id text DEFAULT NULL, p_payment_intent_id text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; v_quantity integer;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object' OR octet_length(p_details::text) > 65536
     OR p_product_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100
     OR (p_session_id IS NULL) = (p_payment_intent_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid order details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tx FROM public.payment_transactions
    WHERE (session_id = p_session_id OR stripe_payment_intent_id = p_payment_intent_id)
      AND product_id = p_product_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT quantity INTO v_quantity FROM public.payment_line_items
    WHERE transaction_id = tx.id AND product_id = p_product_id AND item_type = 'main_product';
  IF v_quantity IS DISTINCT FROM p_quantity THEN RETURN -1; END IF;
  UPDATE public.payment_transactions SET order_details = coalesce(order_details, '{}'::jsonb) || p_details, updated_at = now() WHERE id = tx.id;
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.set_payment_order_details(jsonb,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_order_details(jsonb,uuid,integer,text,text) TO service_role;
