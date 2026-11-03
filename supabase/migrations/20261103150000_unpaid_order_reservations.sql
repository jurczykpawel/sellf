-- Unpaid transfer orders: seller-configured timed reservation (reminder + release) for event seats,
-- buyer "I have sent the transfer" declaration, hold without expiry once an invoice is issued,
-- and explicit administrator acceptance of a transfer that arrives after cancellation.
-- Owner decisions 2026-11-03: issued invoice = no expiry, only cancellation (with correction) releases;
-- a late transfer after cancellation is decided by the administrator, over the limit if needed.
-- @see priv/plans/2026-10-28-unpaid-orders-plan.md, admin-panel/src/lib/orders/bank-transfer-service.ts

-- ===== SCHEMA =====
ALTER TABLE public.bank_transfer_config
  ADD COLUMN reservation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reservation_reminder_hours integer NOT NULL DEFAULT 24 CHECK (reservation_reminder_hours BETWEEN 1 AND 168),
  ADD COLUMN reservation_release_hours integer NOT NULL DEFAULT 48 CHECK (reservation_release_hours BETWEEN 2 AND 336),
  ADD COLUMN declared_hold_hours integer NOT NULL DEFAULT 72 CHECK (declared_hold_hours BETWEEN 0 AND 336),
  ADD CONSTRAINT bank_transfer_reservation_order CHECK (reservation_release_hours > reservation_reminder_hours);

ALTER TABLE public.payment_transactions
  ADD COLUMN reminder_at timestamptz,
  ADD COLUMN release_at timestamptz,
  ADD COLUMN cancel_reason text CHECK (cancel_reason IN ('admin','payment_window_expired')),
  ADD COLUMN transfer_declared_at timestamptz,
  ADD COLUMN transfer_declared_note text CHECK (length(transfer_declared_note) <= 200),
  ADD COLUMN invoice_hold_at timestamptz,
  ADD COLUMN reopened_at timestamptz,
  ADD COLUMN order_reminder_notified_at timestamptz,
  ADD COLUMN order_transfer_declared_notified_at timestamptz,
  ADD COLUMN order_invoice_issued_notified_at timestamptz,
  ADD COLUMN order_reopened_notified_at timestamptz,
  ADD COLUMN reminder_mail_sent_at timestamptz,
  ADD COLUMN cancelled_mail_sent_at timestamptz;
CREATE INDEX transfer_reminder_due_idx ON public.payment_transactions(reminder_at)
  WHERE status = 'awaiting_payment' AND reminder_at IS NOT NULL AND order_reminder_notified_at IS NULL;
CREATE INDEX transfer_release_due_idx ON public.payment_transactions(release_at)
  WHERE status = 'awaiting_payment' AND release_at IS NOT NULL;

-- Online payment of an unpaid transfer order from the pay link (Stripe Checkout). The order keeps
-- payment_provider='bank_transfer'; settled_via records how it was paid.
ALTER TABLE public.payment_transactions ADD COLUMN settled_via text CHECK (settled_via IN ('bank_transfer','stripe'));
-- A transfer order paid online keeps its Stripe PaymentIntent so refunds and disputes reconcile as for card orders.
ALTER TABLE public.payment_transactions DROP CONSTRAINT payment_transactions_provider_ref_chk,
  ADD CONSTRAINT payment_transactions_provider_ref_chk CHECK (
    (payment_provider = 'stripe' AND session_id IS NOT NULL
      AND length(session_id) BETWEEN 1 AND 255 AND session_id ~* '^(cs_|pi_|in_)[a-zA-Z0-9_]+$')
    OR (payment_provider = 'bank_transfer' AND session_id IS NULL AND pricing_snapshot_version IS NOT NULL
      AND (stripe_payment_intent_id IS NULL OR (settled_via IS NOT DISTINCT FROM 'stripe' AND stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$')))
  );
CREATE TABLE public.order_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('settle','reopen')),
  stripe_session_id text UNIQUE,
  checkout_url text CHECK (length(checkout_url) <= 2048),
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'opening' CHECK (status IN ('opening','open','completed','expired','superseded','duplicate')),
  stripe_payment_intent_id text,
  refund_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX order_payment_attempt_open_idx ON public.order_payment_attempts(transaction_id) WHERE status IN ('opening','open');
ALTER TABLE public.order_payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.order_payment_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON public.order_payment_attempts FOR SELECT TO authenticated USING ((select public.is_admin()));
REVOKE ALL ON public.order_payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_payment_attempts TO authenticated;
GRANT ALL ON public.order_payment_attempts TO service_role;

-- ===== SETTINGS =====
CREATE OR REPLACE FUNCTION public.save_bank_transfer_config(p_config jsonb,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.bank_transfer_config%ROWTYPE; cur public.bank_transfer_config%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT cur FROM public.bank_transfer_config WHERE id;
  cfg:=jsonb_populate_record(cur,p_config);
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=cfg.bank_transfer_enabled,bank_account_holder=cfg.bank_account_holder,
    bank_account_number=cfg.bank_account_number,bank_name=cfg.bank_name,bank_transfer_title_template=cfg.bank_transfer_title_template,
    bank_transfer_due_days=cfg.bank_transfer_due_days,bank_transfer_grant_access_on_placement=cfg.bank_transfer_grant_access_on_placement,
    bank_transfer_max_unpaid_per_email=cfg.bank_transfer_max_unpaid_per_email,reservation_enabled=cfg.reservation_enabled,
    reservation_reminder_hours=cfg.reservation_reminder_hours,reservation_release_hours=cfg.reservation_release_hours,
    declared_hold_hours=cfg.declared_hold_hours WHERE id;
  INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values) VALUES('bank_transfer_config','UPDATE',p_actor,p_actor,
    jsonb_build_object('action','bank_transfer.settings','enabled',cfg.bank_transfer_enabled,'reservation_enabled',cfg.reservation_enabled,
      'reminder_hours',cfg.reservation_reminder_hours,'release_hours',cfg.reservation_release_hours,'declared_hold_hours',cfg.declared_hold_hours));
END $$;
REVOKE ALL ON FUNCTION public.save_bank_transfer_config(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_bank_transfer_config(jsonb,uuid) TO service_role;

-- ===== PLACEMENT: timed reservation for event seats =====
CREATE OR REPLACE FUNCTION public.bank_transfer_order(p_order jsonb,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.bank_transfer_config%ROWTYPE; result jsonb; txid uuid; buyer_type text;
  email text:=lower(btrim(p_order->>'customer_email')); profile jsonb; transfer jsonb; person record;
  is_event boolean; starts timestamptz; remind timestamptz; release timestamptz; due timestamptz;
BEGIN
  SELECT * INTO STRICT cfg FROM public.bank_transfer_config WHERE id;
  SELECT checkout_profile,event_mode INTO profile,is_event FROM public.products WHERE id=(p_order->>'product_id')::uuid AND is_active
    AND product_type='one_time' AND NOT is_bundle AND NOT allow_custom_price FOR SHARE;
  buyer_type:=p_order->'order_details'->'buyer'->>'type';
  IF NOT cfg.bank_transfer_enabled OR profile IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(profile->'modules') m
    WHERE m->>'id'='buyer' AND m->'bank_transfer_for' ? buyer_type AND m->'types' ? buyer_type)
    OR NOT public.validate_email_format(email) OR (p_order->'terms_required' IS DISTINCT FROM 'false'::jsonb
      AND (p_order->'order_details'->'buyer'->>'terms_accepted') IS DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='22023';
  END IF;
  IF coalesce(is_event,false) AND cfg.reservation_enabled THEN
    remind:=now()+make_interval(hours=>cfg.reservation_reminder_hours);
    release:=now()+make_interval(hours=>cfg.reservation_release_hours);
    SELECT s.starts_at INTO starts FROM jsonb_array_elements(p_lines) l
      JOIN public.product_sessions s ON s.id=(l->>'session_id')::uuid WHERE l->>'item_type'='main_product';
    -- A transfer cannot hold a seat past the start of the session; the buyer pays online instead.
    IF starts IS NOT NULL AND starts<=release THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='22023'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(email,1));
  IF (SELECT count(*) FROM public.payment_transactions WHERE payment_provider='bank_transfer' AND status='awaiting_payment'
    AND lower(customer_email)=email)>=cfg.bank_transfer_max_unpaid_per_email THEN RAISE EXCEPTION 'unpaid_limit' USING ERRCODE='P0429'; END IF;
  p_order:=p_order||jsonb_build_object('payment_provider','bank_transfer','customer_email',email,'session_id',NULL,'stripe_payment_intent_id',NULL,
    'metadata',coalesce(p_order->'metadata','{}')||jsonb_build_object('access_on_placement',cfg.bank_transfer_grant_access_on_placement));
  result:=public.place_order(p_order,p_lines); txid:=(result->>'transaction_id')::uuid;
  transfer:=jsonb_build_object('holder',cfg.bank_account_holder,'account',cfg.bank_account_number,'bank',cfg.bank_name,
    'title',replace(cfg.bank_transfer_title_template,'{order_number}',result->>'order_number'));
  -- The payment term (invoice deadline) stays the seller's due days; the timed reservation is separate.
  due:=now()+make_interval(days=>cfg.bank_transfer_due_days);
  UPDATE public.payment_transactions SET payment_due_at=due,reminder_at=remind,release_at=release,transfer_details=transfer WHERE id=txid;
  IF cfg.bank_transfer_grant_access_on_placement THEN
    INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,transaction_id)
      SELECT email,product_id,0,txid FROM public.payment_line_items WHERE transaction_id=txid ON CONFLICT DO NOTHING;
    INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,transaction_id)
      SELECT DISTINCT lower(btrim(p->>'email')),li.product_id,0,txid
      FROM jsonb_array_elements(coalesce(p_order->'order_details'->'participants'->'people','[]')) p
      CROSS JOIN public.payment_line_items li WHERE li.transaction_id=txid AND li.item_type='order_bump'
      AND public.validate_email_format(lower(btrim(p->>'email'))) ON CONFLICT DO NOTHING;
    FOR person IN SELECT DISTINCT u.id FROM auth.users u JOIN public.guest_purchases gp ON gp.customer_email=lower(u.email)
      WHERE gp.transaction_id=txid AND u.email_confirmed_at IS NOT NULL LOOP
      PERFORM public.claim_guest_purchases_for_user(person.id);
    END LOOP;
  END IF;
  RETURN result||jsonb_build_object('currency',p_order->>'currency','dueAt',due,'reminderAt',remind,'releaseAt',release,'transfer',transfer);
END $$;
REVOKE ALL ON FUNCTION public.bank_transfer_order(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bank_transfer_order(jsonb,jsonb) TO service_role;

-- ===== INVOICE HOLD: an issued invoice stops the timer for good =====
CREATE FUNCTION public.hold_transfer_for_invoice(p_id uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'Time required' USING ERRCODE='22023'; END IF;
  UPDATE public.payment_transactions SET invoice_hold_at=p_now,release_at=NULL,reminder_at=NULL,updated_at=now()
    WHERE id=p_id AND payment_provider='bank_transfer' AND status='awaiting_payment' AND invoice_hold_at IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('success',EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=p_id AND payment_provider='bank_transfer'
    AND status='awaiting_payment'),'held',changed=1);
END $$;
REVOKE ALL ON FUNCTION public.hold_transfer_for_invoice(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hold_transfer_for_invoice(uuid,timestamptz) TO service_role;

CREATE FUNCTION public.invoice_holds_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.hold_transfer_for_invoice(NEW.transaction_id,now());
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.invoice_holds_transfer() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER invoice_holds_transfer AFTER INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW WHEN (NEW.status='issued') EXECUTE FUNCTION public.invoice_holds_transfer();

-- ===== RELEASE: unpaid order past its window is cancelled; seat, coupon and access return =====
CREATE FUNCTION public.release_unpaid_transfer(p_id uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; redeemed uuid;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'Time required' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment' OR tx.release_at IS NULL
    OR tx.release_at>p_now OR tx.invoice_hold_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.order_payment_attempts a WHERE a.transaction_id=tx.id AND a.status IN ('opening','open') AND a.expires_at>p_now)
    OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status IN ('issuing','issued','corrected')) THEN
    RETURN jsonb_build_object('success',true,'released',false);
  END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id=tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count=greatest(0,current_usage_count-1) WHERE id=redeemed;
  END LOOP;
  PERFORM set_config('sellf.event_context',jsonb_build_object('actor',jsonb_build_object('type','system','id',NULL),'reason','payment_window_expired')::text,true);
  UPDATE public.payment_transactions SET status='cancelled',cancel_reason='payment_window_expired',updated_at=now() WHERE id=tx.id;
  PERFORM set_config('sellf.event_context','',true);
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.released','transaction_id',tx.id,'release_at',tx.release_at,'coupon_id',tx.coupon_id));
  RETURN jsonb_build_object('success',true,'released',true,'transaction_id',tx.id);
END $$;
REVOKE ALL ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) TO service_role;

-- ===== DECLARATION: buyer says the transfer is on its way =====
CREATE FUNCTION public.declare_transfer(p_id uuid,p_note text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; hold integer; note text:=nullif(btrim(p_note),'');
BEGIN
  IF p_now IS NULL OR length(note)>200 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid declaration' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment' THEN
    RETURN jsonb_build_object('success',false,'error','not_awaiting_payment');
  END IF;
  IF tx.transfer_declared_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'already_declared',true,'releaseAt',tx.release_at,'declaredAt',tx.transfer_declared_at);
  END IF;
  SELECT declared_hold_hours INTO STRICT hold FROM public.bank_transfer_config WHERE id;
  UPDATE public.payment_transactions SET transfer_declared_at=p_now,transfer_declared_note=note,
    release_at=CASE WHEN release_at IS NULL THEN NULL ELSE greatest(release_at,p_now+make_interval(hours=>hold)) END,
    updated_at=now() WHERE id=tx.id RETURNING * INTO tx;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.transfer_declared','transaction_id',tx.id,'release_at',tx.release_at));
  RETURN jsonb_build_object('success',true,'already_declared',false,'releaseAt',tx.release_at,'declaredAt',tx.transfer_declared_at);
END $$;
REVOKE ALL ON FUNCTION public.declare_transfer(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.declare_transfer(uuid,text,timestamptz) TO service_role;

-- Back to awaiting payment so the normal completion runs: coupon use re-taken (even past its limit, the order
-- price is honoured) and placement access re-granted by completion. Caller holds the row lock.
CREATE FUNCTION public._reopen_cancelled_transfer(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id=p_id;
  IF tx.coupon_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.coupon_redemptions WHERE transaction_id=tx.id) THEN
    INSERT INTO public.coupon_redemptions(coupon_id,user_id,customer_email,transaction_id,discount_amount)
      VALUES(tx.coupon_id,tx.user_id,tx.customer_email,tx.id,0);
    UPDATE public.coupons SET current_usage_count=coalesce(current_usage_count,0)+1 WHERE id=tx.coupon_id;
  END IF;
  UPDATE public.payment_transactions SET status='awaiting_payment',cancel_reason=NULL,
    metadata=coalesce(metadata,'{}')||'{"access_on_placement":false}'::jsonb WHERE id=tx.id;
END $$;
REVOKE ALL ON FUNCTION public._reopen_cancelled_transfer(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._reopen_cancelled_transfer(uuid) TO service_role;

-- ===== ADMIN: late acceptance of a cancelled order, external invoice mark, cancel reason =====
DROP FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid);
CREATE FUNCTION public.admin_bank_transfer_order(p_id uuid,p_action text,p_amount numeric DEFAULT NULL,p_paid_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,p_actor uuid DEFAULT NULL,p_accept_cancelled boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tx public.payment_transactions%ROWTYPE; invoice_status text; reopen boolean:=false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT status INTO invoice_status FROM public.invoices WHERE transaction_id=p_id;
  IF p_action='mark-paid' THEN
    IF p_paid_at IS NULL OR p_paid_at>now() THEN RAISE EXCEPTION 'Invalid payment date' USING ERRCODE='22023'; END IF;
    IF tx.status='cancelled' THEN
      IF NOT coalesce(p_accept_cancelled,false) THEN RETURN jsonb_build_object('success',false,'error','order_cancelled'); END IF;
      IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Acceptance reason required' USING ERRCODE='22023'; END IF;
      IF invoice_status='corrected' THEN RETURN jsonb_build_object('success',false,'error','invoice_corrected'); END IF;
      IF p_amount IS DISTINCT FROM tx.amount THEN RETURN jsonb_build_object('success',false,'error','amount_mismatch'); END IF;
      PERFORM public._reopen_cancelled_transfer(tx.id);
      reopen:=true;
    END IF;
    result:=public.complete_offline_order(p_id,p_amount);
    IF (result->>'success')::boolean THEN
      UPDATE public.order_payment_attempts SET status='superseded' WHERE transaction_id=p_id AND status IN ('opening','open');
    END IF;
    IF (result->>'success')::boolean AND tx.status<>'completed' THEN
      UPDATE public.payment_transactions SET paid_at=p_paid_at,reopened_at=CASE WHEN reopen THEN now() ELSE reopened_at END WHERE id=p_id;
    END IF;
    IF reopen AND (result->>'success')::boolean THEN
      INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values) VALUES('payment_transactions','UPDATE',p_actor,p_actor,
        jsonb_build_object('action','order.reopened','transaction_id',p_id,'previous_status','cancelled','amount',tx.amount,'reason',p_reason,
          'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=p_id),false)));
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
REVOKE ALL ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean) TO service_role;

-- ===== BUYER MAIL: notice kind, signed order link and reservation text on the Auth channel =====
CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 OR length(p_data->>'purchase_product')>500
    OR length(p_data->>'purchase_amount')>100 OR (p_data->>'locale') NOT IN ('pl','en')
    OR (p_data->>'mail_kind') NOT IN ('transfer_placed','payment_reminder','order_cancelled')
    OR length(p_data->>'pay_url')>2048
    OR (p_data->>'pay_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/transfer\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'release_text')>500
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'purchase_product'-'purchase_amount'-'locale'-'mail_kind'-'pay_url'-'release_text')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== ONLINE PAYMENT OF AN UNPAID ORDER =====
-- One open attempt per order; a stale or expired one is replaced. Amount is the quoted amount (minor units).
CREATE FUNCTION public.open_order_payment_attempt(p_id uuid,p_kind text,p_amount numeric,p_currency text,p_expires_at timestamptz,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; a public.order_payment_attempts%ROWTYPE;
BEGIN
  IF p_now IS NULL OR p_expires_at IS NULL OR p_expires_at<=p_now OR p_kind NOT IN ('settle','reopen') THEN
    RAISE EXCEPTION 'Invalid attempt' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR p_amount IS DISTINCT FROM tx.amount OR upper(p_currency)<>upper(tx.currency)
    OR (p_kind='settle' AND tx.status<>'awaiting_payment') OR (p_kind='reopen' AND (tx.status<>'cancelled'
      OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status='corrected'))) THEN
    RAISE EXCEPTION 'Order not payable' USING ERRCODE='22023'; END IF;
  UPDATE public.order_payment_attempts SET status='expired' WHERE transaction_id=p_id AND status IN ('opening','open') AND expires_at<=p_now;
  SELECT * INTO a FROM public.order_payment_attempts WHERE transaction_id=p_id AND status IN ('opening','open');
  IF FOUND THEN RETURN to_jsonb(a)||'{"reused":true}'; END IF;
  INSERT INTO public.order_payment_attempts(transaction_id,kind,amount,currency,expires_at) VALUES(p_id,p_kind,p_amount,upper(p_currency),p_expires_at) RETURNING * INTO a;
  RETURN to_jsonb(a)||'{"reused":false}';
END $$;
REVOKE ALL ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) TO service_role;

CREATE FUNCTION public.attach_order_payment_session(p_attempt uuid,p_session_id text,p_url text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.order_payment_attempts SET stripe_session_id=p_session_id,checkout_url=p_url,status='open'
    WHERE id=p_attempt AND status='opening';
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not opening' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.attach_order_payment_session(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_order_payment_session(uuid,text,text) TO service_role;

-- Paid online. Completes the same order once; if it was already paid (admin) or is no longer payable the payment
-- is a duplicate the caller refunds. result: completed | already | duplicate.
CREATE FUNCTION public.complete_order_payment_attempt(p_attempt uuid,p_session_id text,p_payment_intent text,p_amount numeric,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.order_payment_attempts%ROWTYPE; tx public.payment_transactions%ROWTYPE; result jsonb; reopen boolean:=false;
BEGIN
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt;
  IF NOT FOUND OR a.stripe_session_id IS DISTINCT FROM p_session_id OR p_amount IS DISTINCT FROM a.amount THEN
    RAISE EXCEPTION 'Attempt mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=a.transaction_id FOR UPDATE;
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt FOR UPDATE;
  IF a.status IN ('completed','duplicate') THEN
    RETURN jsonb_build_object('result',CASE a.status WHEN 'completed' THEN 'already' ELSE 'duplicate' END,'transaction_id',tx.id,'attempt_status',a.status,'refund_id',a.refund_id);
  END IF;
  IF a.status='superseded' OR NOT ((a.kind='settle' AND tx.status='awaiting_payment') OR (a.kind='reopen' AND tx.status='cancelled'
    AND NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status='corrected'))) THEN
    UPDATE public.order_payment_attempts SET status='duplicate',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
    INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('order_payment_attempts','UPDATE',
      jsonb_build_object('action','order.payment_duplicate','transaction_id',tx.id,'attempt_id',a.id,'payment_intent',p_payment_intent));
    RETURN jsonb_build_object('result','duplicate','transaction_id',tx.id);
  END IF;
  IF a.kind='reopen' THEN PERFORM public._reopen_cancelled_transfer(tx.id); reopen:=true; END IF;
  UPDATE public.payment_transactions SET stripe_payment_intent_id=p_payment_intent,settled_via='stripe' WHERE id=tx.id;
  result:=public.complete_offline_order(tx.id,a.amount);
  IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Online completion failed' USING ERRCODE='P0001'; END IF;
  UPDATE public.payment_transactions SET paid_at=p_now,reopened_at=CASE WHEN reopen THEN p_now ELSE reopened_at END WHERE id=tx.id;
  UPDATE public.order_payment_attempts SET status='completed',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action',CASE WHEN reopen THEN 'order.reopened' ELSE 'order.paid_online' END,'transaction_id',tx.id,'attempt_id',a.id,
      'previous_status',tx.status,'amount',a.amount,'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=tx.id),false)));
  RETURN jsonb_build_object('result','completed','transaction_id',tx.id,'reopened',reopen);
END $$;
REVOKE ALL ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) TO service_role;

CREATE FUNCTION public.expire_order_payment_attempt(p_session_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.order_payment_attempts SET status='expired' WHERE stripe_session_id=p_session_id AND status IN ('opening','open');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.expire_order_payment_attempt(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_order_payment_attempt(text) TO service_role;

CREATE FUNCTION public.record_order_payment_refund(p_attempt uuid,p_refund_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.order_payment_attempts SET refund_id=p_refund_id WHERE id=p_attempt AND status='duplicate';
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicate attempt required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('order_payment_attempts','UPDATE',
    jsonb_build_object('action','order.payment_duplicate_refunded','attempt_id',p_attempt,'refund_id',p_refund_id));
END $$;
REVOKE ALL ON FUNCTION public.record_order_payment_refund(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_payment_refund(uuid,text) TO service_role;
