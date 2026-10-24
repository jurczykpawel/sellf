-- Complete coupon eligibility and reservation in the same order transaction.
CREATE OR REPLACE FUNCTION public._redeem_coupon_for_order(
  coupon_id_param uuid, current_user_id uuid, existing_user_id uuid,
  customer_email_param text, transaction_id_var uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  coupon_code text;
  tx public.payment_transactions%ROWTYPE;
  reservation jsonb;
BEGIN
    IF coupon_id_param IS NOT NULL THEN
      SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id = transaction_id_var;
      IF tx.payment_provider = 'stripe' THEN
        SELECT code INTO STRICT coupon_code FROM public.coupons WHERE id = coupon_id_param;
        reservation := public.verify_coupon(coupon_code, tx.product_id, customer_email_param, tx.currency);
        IF NOT coalesce((reservation->>'valid')::boolean, false)
          OR (reservation->>'id')::uuid IS DISTINCT FROM coupon_id_param THEN
          RAISE EXCEPTION 'Coupon is not available for this order';
        END IF;
      END IF;

      DELETE FROM public.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      UPDATE public.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND is_active = true
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      INSERT INTO public.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

END;
$$;
REVOKE ALL ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) TO service_role;
