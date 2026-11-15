-- W254 (owner decision 14/15.11.2026): a cancelled order can no longer be paid by the buyer in any way, whether the
-- administrator cancelled it or the reservation timer released it (payment_window_expired). Only the administrator
-- can accept a transfer that arrived late (admin_bank_transfer_order, p_accept_cancelled).
-- * open_order_payment_attempt accepts only 'settle' on an order still awaiting payment (the 'reopen' mode is gone).
-- * complete_order_payment_attempt completes only a 'settle' attempt on an order awaiting payment; anything else is a
--   duplicate the caller refunds automatically (sellf-dup-refund-<attempt>).
-- * Every closing of an order (admin cancel, timer release, admin mark-paid) supersedes the open attempts and returns
--   their Stripe session ids in expire_sessions, so the caller expires the payment pages still open in the buyer's browser.
-- W254b (owner decisions 15.11.2026):
-- * After the reservation deadline (release_at) no NEW online payment attempt opens. An attempt started before it may
--   finish, but the release job's protection ends 30 minutes after the deadline at the latest (cannot be renewed).
-- * Accepting a late transfer that would go over a seat limit (session capacity OR the order's saved price tier, the
--   rules confirm_event_order applies) requires the administrator's explicit confirmation (p_accept_oversold).
--   event_order_seats() gives the preview the same facts the acceptance uses.
-- Bodies otherwise identical to 20261110235905 / 20261110235906.

-- ===== Close the open online payment attempts of an order; caller holds the order row lock =====
CREATE FUNCTION public._supersede_order_payment_attempts(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sessions jsonb;
BEGIN
  WITH closed AS (
    UPDATE public.order_payment_attempts SET status='superseded'
      WHERE transaction_id=p_id AND status IN ('opening','open') RETURNING stripe_session_id
  ) SELECT coalesce(jsonb_agg(stripe_session_id) FILTER (WHERE stripe_session_id IS NOT NULL),'[]'::jsonb) INTO sessions FROM closed;
  RETURN sessions;
END $$;
REVOKE ALL ON FUNCTION public._supersede_order_payment_attempts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._supersede_order_payment_attempts(uuid) TO service_role;

-- Revival attempts opened before this version can no longer complete; a payment that still lands is refunded.
UPDATE public.order_payment_attempts SET status='superseded' WHERE kind='reopen' AND status IN ('opening','open');

-- ===== ONLINE PAYMENT: only an unpaid order =====
CREATE OR REPLACE FUNCTION public.open_order_payment_attempt(p_id uuid,p_kind text,p_amount numeric,p_currency text,p_expires_at timestamptz,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; a public.order_payment_attempts%ROWTYPE;
BEGIN
  IF p_now IS NULL OR p_expires_at IS NULL OR p_expires_at<=p_now OR p_kind IS DISTINCT FROM 'settle' THEN
    RAISE EXCEPTION 'Invalid attempt' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment'
    OR p_amount IS DISTINCT FROM tx.amount OR upper(p_currency)<>upper(tx.currency) THEN
    RAISE EXCEPTION 'Order not payable' USING ERRCODE='22023'; END IF;
  UPDATE public.order_payment_attempts SET status='expired' WHERE transaction_id=p_id AND status IN ('opening','open') AND expires_at<=p_now;
  SELECT * INTO a FROM public.order_payment_attempts WHERE transaction_id=p_id AND status IN ('opening','open');
  IF FOUND THEN RETURN to_jsonb(a)||'{"reused":true}'; END IF;
  -- W254b: past the reservation deadline the order waits for the release job; no new attempt may extend it.
  IF tx.release_at IS NOT NULL AND p_now>=tx.release_at THEN RAISE EXCEPTION 'Payment window closed' USING ERRCODE='22023'; END IF;
  INSERT INTO public.order_payment_attempts(transaction_id,kind,amount,currency,expires_at) VALUES(p_id,p_kind,p_amount,upper(p_currency),p_expires_at) RETURNING * INTO a;
  RETURN to_jsonb(a)||'{"reused":false}';
END $$;
REVOKE ALL ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) TO service_role;

-- Paid online. Completes the same unpaid order once; if it was already paid (admin), cancelled meanwhile or the attempt
-- was superseded, the payment is a duplicate the caller refunds. result: completed | already | duplicate.
CREATE OR REPLACE FUNCTION public.complete_order_payment_attempt(p_attempt uuid,p_session_id text,p_payment_intent text,p_amount numeric,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.order_payment_attempts%ROWTYPE; tx public.payment_transactions%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt;
  IF NOT FOUND OR a.stripe_session_id IS DISTINCT FROM p_session_id OR p_amount IS DISTINCT FROM a.amount THEN
    RAISE EXCEPTION 'Attempt mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=a.transaction_id FOR UPDATE;
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt FOR UPDATE;
  IF a.status IN ('completed','duplicate') THEN
    RETURN jsonb_build_object('result',CASE a.status WHEN 'completed' THEN 'already' ELSE 'duplicate' END,'transaction_id',tx.id,'attempt_status',a.status,'refund_id',a.refund_id);
  END IF;
  IF a.status='superseded' OR a.kind<>'settle' OR tx.status<>'awaiting_payment' THEN
    UPDATE public.order_payment_attempts SET status='duplicate',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
    INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('order_payment_attempts','UPDATE',
      jsonb_build_object('action','order.payment_duplicate','transaction_id',tx.id,'attempt_id',a.id,'payment_intent',p_payment_intent,
        'order_status',tx.status));
    RETURN jsonb_build_object('result','duplicate','transaction_id',tx.id);
  END IF;
  UPDATE public.payment_transactions SET stripe_payment_intent_id=p_payment_intent,settled_via='stripe' WHERE id=tx.id;
  result:=public.complete_offline_order(tx.id,a.amount);
  IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Online completion failed' USING ERRCODE='P0001'; END IF;
  UPDATE public.payment_transactions SET paid_at=p_now WHERE id=tx.id;
  UPDATE public.order_payment_attempts SET status='completed',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.paid_online','transaction_id',tx.id,'attempt_id',a.id,'previous_status',tx.status,'amount',a.amount,
      'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=tx.id),false)));
  RETURN jsonb_build_object('result','completed','transaction_id',tx.id,'reopened',false);
END $$;
REVOKE ALL ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) TO service_role;

-- ===== ADMIN CANCELLATION: also closes the buyer's open online payment =====
CREATE OR REPLACE FUNCTION public.cancel_unpaid_order(p_transaction_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  redeemed uuid;
  sessions jsonb;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider <> 'bank_transfer' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  IF tx.status = 'cancelled' THEN RETURN jsonb_build_object('success', true, 'already_cancelled', true, 'expire_sessions', '[]'::jsonb); END IF;
  IF tx.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id = tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count = greatest(0, current_usage_count - 1) WHERE id = redeemed;
  END LOOP;
  UPDATE public.payment_transactions SET status = 'cancelled', cancel_note = btrim(p_reason), updated_at = now() WHERE id = tx.id;
  sessions := public._supersede_order_payment_attempts(tx.id);
  PERFORM public.log_admin_action('cancel_unpaid_order', 'payment_transaction', tx.id::text,
    jsonb_build_object('reason', p_reason, 'coupon_id', tx.coupon_id, 'transaction_id', tx.id, 'expire_sessions', sessions));
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'expire_sessions', sessions);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_unpaid_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_order(uuid,text) TO service_role;

-- ===== RELEASE: an attempt still running protects the order (at most 30 min past the deadline); a stale one is closed with the release =====
CREATE OR REPLACE FUNCTION public.release_unpaid_transfer(p_id uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; redeemed uuid; sessions jsonb;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'Time required' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment' OR tx.release_at IS NULL
    OR tx.release_at>p_now OR tx.invoice_hold_at IS NOT NULL
    OR (p_now<tx.release_at+interval '30 minutes'
      AND EXISTS(SELECT 1 FROM public.order_payment_attempts a WHERE a.transaction_id=tx.id AND a.status IN ('opening','open') AND a.expires_at>p_now))
    OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status IN ('issuing','issued','corrected')) THEN
    RETURN jsonb_build_object('success',true,'released',false);
  END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id=tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count=greatest(0,current_usage_count-1) WHERE id=redeemed;
  END LOOP;
  PERFORM set_config('sellf.event_context',jsonb_build_object('actor',jsonb_build_object('type','system','id',NULL),'reason','payment_window_expired')::text,true);
  UPDATE public.payment_transactions SET status='cancelled',cancel_reason='payment_window_expired',updated_at=now() WHERE id=tx.id;
  PERFORM set_config('sellf.event_context','',true);
  sessions:=public._supersede_order_payment_attempts(tx.id);
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.released','transaction_id',tx.id,'release_at',tx.release_at,'coupon_id',tx.coupon_id,'expire_sessions',sessions));
  RETURN jsonb_build_object('success',true,'released',true,'transaction_id',tx.id,'expire_sessions',sessions);
END $$;
REVOKE ALL ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) TO service_role;

-- ===== SEATS: what re-taking a released seat would do (one rule for confirmation, preview and acceptance) =====
-- Seats left for one order line, excluding the order itself: session capacity and the saved price tier. NULL = unlimited.
CREATE FUNCTION public._event_line_seats(p_transaction_id uuid, p_session_id uuid, p_tier_id uuid, p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'session',(SELECT s.capacity-coalesce((SELECT sum(r.quantity) FROM public.seat_reservations r WHERE r.session_id=p_session_id
      AND r.transaction_id<>p_transaction_id AND (r.status='confirmed' OR (r.status='held' AND (r.expires_at IS NULL OR r.expires_at>p_at)))),0)
      FROM public.product_sessions s WHERE s.id=p_session_id),
    'tier',(SELECT t.seats-coalesce((SELECT sum(r.quantity) FROM public.seat_reservations r WHERE r.tier_id=p_tier_id
      AND r.transaction_id<>p_transaction_id AND (r.status='confirmed' OR (r.status='held' AND (r.expires_at IS NULL OR r.expires_at>p_at)))),0)
      FROM public.product_price_tiers t WHERE t.id=p_tier_id));
$$;
REVOKE ALL ON FUNCTION public._event_line_seats(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._event_line_seats(uuid,uuid,uuid,timestamptz) TO service_role;

-- Seat facts of an order at p_at: quantity, seats left in the session and in the saved tier (NULL = unlimited), and
-- oversold = completing it now would go over a limit. NULL for an order without a seat. Read-only.
CREATE FUNCTION public.event_order_seats(p_transaction_id uuid, p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('session_id',li.session_id,'quantity',li.quantity,'session_remaining',seats->'session','tier_remaining',seats->'tier',
    'oversold',NOT EXISTS(SELECT 1 FROM public.seat_reservations r WHERE r.transaction_id=p_transaction_id
        AND (r.status='confirmed' OR (r.status='held' AND (r.expires_at IS NULL OR r.expires_at>p_at))))
      AND (coalesce((seats->>'session')::integer<li.quantity,false) OR coalesce((seats->>'tier')::integer<li.quantity,false)))
  FROM public.payment_line_items li CROSS JOIN LATERAL (SELECT public._event_line_seats(p_transaction_id,li.session_id,li.tier_id,p_at) seats) x
  WHERE li.transaction_id=p_transaction_id AND li.session_id IS NOT NULL ORDER BY li.item_type<>'main_product', li.session_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.event_order_seats(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_order_seats(uuid,timestamptz) TO service_role;

-- Same body as 20261110235904 except the seat count, which now comes from _event_line_seats.
CREATE OR REPLACE FUNCTION public.confirm_event_order(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE li public.payment_line_items%ROWTYPE; r public.seat_reservations%ROWTYPE; seats jsonb;
BEGIN
  FOR li IN SELECT * FROM public.payment_line_items WHERE transaction_id=p_transaction_id AND session_id IS NOT NULL ORDER BY session_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(li.session_id::text,0));
    SELECT * INTO r FROM public.seat_reservations WHERE transaction_id=p_transaction_id FOR UPDATE;
    IF r.status='confirmed' THEN CONTINUE; END IF;
    IF r.status='held' AND (r.expires_at IS NULL OR r.expires_at>now()) THEN
      UPDATE public.seat_reservations SET status='confirmed',confirmed_at=now() WHERE id=r.id;
      CONTINUE;
    END IF;
    seats:=public._event_line_seats(p_transaction_id,li.session_id,li.tier_id,now());
    IF coalesce((seats->>'session')::integer<li.quantity,false) OR coalesce((seats->>'tier')::integer<li.quantity,false) THEN
      UPDATE public.payment_transactions SET metadata=coalesce(metadata,'{}'::jsonb)||'{"oversold":true}'::jsonb WHERE id=p_transaction_id;
      UPDATE public.seat_reservations SET status='released',released_at=now() WHERE id=r.id;
      INSERT INTO public.audit_log(table_name,operation,new_values) VALUES ('payment_transactions','UPDATE',
        jsonb_build_object('action','event.oversold','transaction_id',p_transaction_id,'session_id',li.session_id));
      RAISE LOG 'event.oversold transaction=% session=%',p_transaction_id,li.session_id;
    ELSE
      INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,confirmed_at)
        VALUES (li.session_id,li.tier_id,p_transaction_id,li.quantity,'confirmed',now())
        ON CONFLICT (transaction_id) DO UPDATE SET status='confirmed',confirmed_at=now(),released_at=NULL;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.confirm_event_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_event_order(uuid) TO service_role;

-- ===== ADMIN: mark-paid and cancel name the online payment sessions to expire; going over a seat limit needs confirmation =====
DROP FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean);
CREATE FUNCTION public.admin_bank_transfer_order(p_id uuid,p_action text,p_amount numeric DEFAULT NULL,p_paid_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,p_actor uuid DEFAULT NULL,p_accept_cancelled boolean DEFAULT false,p_accept_oversold boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tx public.payment_transactions%ROWTYPE; invoice_status text; reopen boolean:=false; seats jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT status INTO invoice_status FROM public.invoices WHERE transaction_id=p_id;
  IF p_action='mark-paid' THEN
    IF p_paid_at IS NULL THEN RAISE EXCEPTION 'Invalid payment date' USING ERRCODE='22023'; END IF;
    IF p_paid_at>now() THEN RETURN jsonb_build_object('success',false,'error','paid_at_future'); END IF;
    IF p_paid_at<(date_trunc('day',tx.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN
      RETURN jsonb_build_object('success',false,'error','paid_at_before_order');
    END IF;
    IF tx.status='cancelled' THEN
      IF NOT coalesce(p_accept_cancelled,false) THEN RETURN jsonb_build_object('success',false,'error','order_cancelled'); END IF;
      IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Acceptance reason required' USING ERRCODE='22023'; END IF;
      IF invoice_status='corrected' THEN RETURN jsonb_build_object('success',false,'error','invoice_corrected'); END IF;
      IF p_amount IS DISTINCT FROM tx.amount THEN RETURN jsonb_build_object('success',false,'error','amount_mismatch'); END IF;
      -- Same session lock as confirm_event_order, so the checked seats cannot change before completion takes them.
      PERFORM pg_advisory_xact_lock(hashtextextended(li.session_id::text,0))
        FROM public.payment_line_items li WHERE li.transaction_id=tx.id AND li.session_id IS NOT NULL ORDER BY li.session_id;
      seats:=public.event_order_seats(tx.id,now());
      IF coalesce((seats->>'oversold')::boolean,false) AND NOT coalesce(p_accept_oversold,false) THEN
        RETURN jsonb_build_object('success',false,'error','oversold_confirmation_required','seats',seats);
      END IF;
      PERFORM public._reopen_cancelled_transfer(tx.id);
      reopen:=true;
    END IF;
    result:=public.complete_offline_order(p_id,p_amount);
    IF (result->>'success')::boolean THEN
      result:=result||jsonb_build_object('expire_sessions',public._supersede_order_payment_attempts(p_id));
    END IF;
    IF (result->>'success')::boolean AND tx.status<>'completed' THEN
      UPDATE public.payment_transactions SET paid_at=p_paid_at,reopened_at=CASE WHEN reopen THEN now() ELSE reopened_at END WHERE id=p_id;
    END IF;
    IF reopen AND (result->>'success')::boolean THEN
      INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values) VALUES('payment_transactions','UPDATE',p_actor,p_actor,
        jsonb_build_object('action','order.reopened','transaction_id',p_id,'previous_status','cancelled','amount',tx.amount,'reason',p_reason,
          'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=p_id),false),
          'oversold_confirmed',coalesce((seats->>'oversold')::boolean,false)));
      result:=result||jsonb_build_object('reopened',true,'previous_status','cancelled');
    ELSIF reopen THEN RAISE EXCEPTION 'Late acceptance failed' USING ERRCODE='P0001';
    END IF;
  ELSIF p_action='cancel' THEN
    result:=public.cancel_unpaid_order(p_id,p_reason);
    IF (result->>'success')::boolean AND tx.status='awaiting_payment' THEN
      UPDATE public.payment_transactions SET cancel_reason='admin' WHERE id=p_id;
    END IF;
    result:=result||jsonb_build_object('invoice_correction_required',invoice_status IN ('issued','issuing'));
  ELSIF p_action='invoice-issued' THEN
    result:=public.hold_transfer_for_invoice(p_id,now());
  ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
  IF (result->>'success')::boolean AND tx.status='awaiting_payment' THEN
    INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values)
      VALUES('payment_transactions','UPDATE',p_actor,p_actor,jsonb_build_object('action',p_action,'transaction_id',p_id));
  END IF;
  RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean,boolean) TO service_role;
