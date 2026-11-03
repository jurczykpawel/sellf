-- Sales invoice, partner commission/payout, refund request and catalogue availability transitions
-- captured transactionally into business_events for signed webhook delivery (W107-10/11/12/14).
-- @see supabase/migrations/20261028184757_business_event_delivery.sql
-- @see admin-panel/src/lib/services/business-events.ts

-- Partner payouts are account-level: they have no product context.
ALTER TABLE public.business_events ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check CHECK (event_type IN (
  'access.granted','access.updated','access.revoked','access.expired','order.abandoned',
  'seats.held','seats.confirmed','seats.released','license.revoked','license.restored',
  'invoicing.issued','invoicing.failed','invoicing.corrected',
  'commission.accrued','commission.reversed','payout.reserved','payout.paid','payout.cancelled',
  'refund.requested','refund.request_approved','refund.request_rejected','refund.request_cancelled',
  'product.published','product.unpublished','product.price_changed','product.sold_out'));

-- ===== SHARED HELPERS =====

CREATE FUNCTION public.business_event_actor() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(nullif(current_setting('sellf.event_context',true),'')::jsonb->'actor',
    jsonb_build_object('type',CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,'id',auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.business_event_actor() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.record_business_event(p_event text, p_product uuid, p_payload jsonb, p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE product jsonb;
BEGIN
  SELECT jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) INTO product FROM public.products p WHERE p.id=p_product;
  INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
  VALUES(p_event,p_product,p_payload||jsonb_build_object(
    'product',CASE WHEN p_product IS NULL THEN NULL ELSE coalesce(product,jsonb_build_object('id',p_product)) END,
    'actor',public.business_event_actor(),'occurredAt',clock_timestamp()),p_key)
  ON CONFLICT(deduplication_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.record_business_event(text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_event_order(p_transaction uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('orderId',t.id,'orderNumber',t.order_number,'amount',t.amount,'currency',t.currency,
    'paymentProvider',t.payment_provider,'status',t.status) FROM public.payment_transactions t WHERE t.id=p_transaction;
$$;
REVOKE ALL ON FUNCTION public.business_event_order(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_event_partner(p_member uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('memberId',m.id,'code',m.code,'displayName',m.display_name,'status',m.status,'userId',m.user_id)
  FROM public.affiliate_memberships m WHERE m.id=p_member;
$$;
REVOKE ALL ON FUNCTION public.business_event_partner(uuid) FROM PUBLIC,anon,authenticated;

-- ===== SALES INVOICES =====

CREATE FUNCTION public.capture_sales_invoice_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('issued','failed','corrected') THEN RETURN NEW; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=NEW.transaction_id;
  PERFORM public.record_business_event('invoicing.'||NEW.status,tx.product_id,jsonb_build_object(
    'amountUnit','minor',
    'invoice',jsonb_build_object('id',NEW.id,'provider',NEW.provider,'providerInvoiceId',NEW.provider_invoice_id,
      'number',NEW.number,'viewUrl',NEW.view_url,'statusBefore',OLD.status,'statusAfter',NEW.status,'attempt',NEW.attempts,
      'error',CASE WHEN NEW.status='failed' THEN NEW.error ELSE NULL END,
      'willRetry',NEW.status='failed' AND NEW.attempts<5,'paymentSynced',NEW.payment_synced),
    'order',public.business_event_order(NEW.transaction_id),
    'customer',jsonb_build_object('userId',tx.user_id,'email',tx.customer_email)),
    'invoicing.'||NEW.status||':'||NEW.id||':'||NEW.attempts||CASE WHEN NEW.status='corrected' THEN ':'||clock_timestamp() ELSE '' END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_sales_invoice_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sales_invoice_business_event AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.capture_sales_invoice_event();

-- ===== REFUND REQUESTS =====

CREATE FUNCTION public.capture_refund_request_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event text := CASE NEW.status WHEN 'pending' THEN 'refund.requested' ELSE 'refund.request_'||NEW.status END;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  PERFORM public.record_business_event(event,NEW.product_id,jsonb_build_object(
    'amountUnit','minor',
    'refundRequest',jsonb_build_object('id',NEW.id,'statusBefore',CASE WHEN TG_OP='INSERT' THEN 'none' ELSE OLD.status END,
      'statusAfter',NEW.status,'requestedAmount',NEW.requested_amount,'currency',NEW.currency,'reason',NEW.reason,
      'adminResponse',NEW.admin_response,'createdAt',NEW.created_at,'processedAt',NEW.processed_at),
    'order',public.business_event_order(NEW.transaction_id),
    'customer',jsonb_build_object('userId',NEW.user_id,'email',NEW.customer_email)),
    event||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_refund_request_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER refund_request_business_event AFTER INSERT OR UPDATE OF status ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.capture_refund_request_event();

-- ===== PARTNER COMMISSIONS AND PAYOUTS =====

CREATE FUNCTION public.capture_commission_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; pid uuid; event text := CASE NEW.kind WHEN 'accrual' THEN 'accrued' ELSE 'reversed' END;
BEGIN
  IF NEW.kind NOT IN ('accrual','reversal') THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.commission_id;
  SELECT coalesce(l.product_id,t.product_id) INTO pid FROM public.payment_transactions t
    LEFT JOIN public.payment_line_items l ON l.id=c.line_item_id WHERE t.id=c.payment_id;
  PERFORM public.record_business_event('commission.'||event,pid,jsonb_build_object(
    'amountUnit','minor',
    'commission',jsonb_build_object('id',c.id,'ledgerEntryId',NEW.id,'amount',NEW.amount_minor,'currency',NEW.currency,
      'baseAmount',c.base_minor,'accruedAmount',c.accrued_minor,'paidAt',c.paid_at,'eligibleAt',c.eligible_at,
      'selfReferral',c.self_referral,'livemode',c.livemode),
    'partner',public.business_event_partner(NEW.member_id),
    'order',public.business_event_order(c.payment_id)),
    'commission.'||event||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_commission_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER commission_business_event AFTER INSERT ON public.affiliate_ledger
  FOR EACH ROW EXECUTE FUNCTION public.capture_commission_event();

-- Deferred so the reservation's allocations exist when the payload is built.
CREATE FUNCTION public.capture_payout_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE before text := CASE WHEN TG_OP='INSERT' THEN 'none' ELSE OLD.status END; current public.affiliate_payouts;
BEGIN
  IF before=NEW.status OR (TG_OP='INSERT' AND NEW.status<>'reserved') THEN RETURN NULL; END IF;
  SELECT * INTO current FROM public.affiliate_payouts WHERE id=NEW.id;
  PERFORM public.record_business_event('payout.'||NEW.status,NULL,jsonb_build_object(
    'amountUnit','minor',
    'payout',jsonb_build_object('id',NEW.id,'statusBefore',before,'statusAfter',NEW.status,'amount',NEW.earnings_minor,
      'currency',NEW.currency,'cutoff',NEW.cutoff,'payeeReference',NEW.payee_reference,'bankReference',NEW.bank_reference,
      'invoiceReference',NEW.invoice_reference,'bankAmount',NEW.bank_amount_minor,'paidAt',NEW.paid_at,'livemode',NEW.livemode,
      'needsReview',current.needs_review,
      'commissionIds',(SELECT coalesce(jsonb_agg(DISTINCT l.commission_id),'[]') FROM public.affiliate_payout_allocations a
        JOIN public.affiliate_ledger l ON l.id=a.entry_id WHERE a.payout_id=NEW.id AND l.commission_id IS NOT NULL)),
    'partner',public.business_event_partner(NEW.member_id)),
    'payout.'||NEW.status||':'||NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.capture_payout_event() FROM PUBLIC,anon,authenticated;
CREATE CONSTRAINT TRIGGER payout_business_event AFTER INSERT OR UPDATE ON public.affiliate_payouts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.capture_payout_event();

-- ===== CATALOGUE AVAILABILITY AND PRICE =====

CREATE FUNCTION public.product_price_snapshot(p public.products) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('price',round(p.price*public.currency_minor_factor(p.currency))::bigint,
    'salePrice',round(p.sale_price*public.currency_minor_factor(p.currency))::bigint,'salePriceUntil',p.sale_price_until,
    'recurringPrice',round(p.recurring_price*public.currency_minor_factor(p.currency))::bigint,'currency',p.currency);
$$;
REVOKE ALL ON FUNCTION public.product_price_snapshot(public.products) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.capture_product_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.products := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  was boolean := TG_OP<>'INSERT' AND OLD.is_active; now_active boolean := TG_OP<>'DELETE' AND NEW.is_active;
  info jsonb; event text; prices_before jsonb; prices_after jsonb;
BEGIN
  info := jsonb_build_object('product',jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'isActive',now_active,
    'availableFrom',r.available_from,'availableUntil',r.available_until,'productType',r.product_type));
  IF was IS DISTINCT FROM now_active AND (was OR now_active) THEN
    event := CASE WHEN now_active THEN 'product.published' ELSE 'product.unpublished' END;
    INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
    VALUES(event,r.id,info||jsonb_build_object('availability',jsonb_build_object(
      'before',CASE WHEN was THEN 'published' ELSE 'unpublished' END,'after',CASE WHEN now_active THEN 'published' ELSE 'unpublished' END),
      'deleted',TG_OP='DELETE','actor',public.business_event_actor(),'occurredAt',clock_timestamp()),
      event||':'||r.id||':'||clock_timestamp())
    ON CONFLICT(deduplication_key) DO NOTHING;
  END IF;
  IF TG_OP='UPDATE' THEN
    prices_before := public.product_price_snapshot(OLD); prices_after := public.product_price_snapshot(NEW);
    IF prices_before IS DISTINCT FROM prices_after THEN
      INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
      VALUES('product.price_changed',r.id,info||jsonb_build_object('amountUnit','minor',
        'price',jsonb_build_object('before',prices_before,'after',prices_after),
        'actor',public.business_event_actor(),'occurredAt',clock_timestamp()),
        'product.price_changed:'||r.id||':'||clock_timestamp())
      ON CONFLICT(deduplication_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.capture_product_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER product_business_event AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.capture_product_event();

-- A session sells out when held (unexpired) plus confirmed seats reach its capacity.
CREATE FUNCTION public.capture_sold_out_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.product_sessions; taken integer;
BEGIN
  IF NEW.status NOT IN ('held','confirmed') OR (TG_OP='UPDATE' AND OLD.status IN ('held','confirmed')) THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.product_sessions WHERE id=NEW.session_id;
  IF s.capacity IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(quantity),0) INTO taken FROM public.seat_reservations
    WHERE session_id=NEW.session_id AND (status='confirmed' OR (status='held' AND (expires_at IS NULL OR expires_at>now())));
  IF taken<s.capacity THEN RETURN NEW; END IF;
  PERFORM public.record_business_event('product.sold_out',s.product_id,jsonb_build_object(
    'session',jsonb_build_object('id',s.id,'label',s.title,'startsAt',s.starts_at,'capacity',s.capacity,'taken',taken,'remaining',0,
      'salesOpen',s.sales_open),
    'reservation',jsonb_build_object('id',NEW.id,'status',NEW.status,'quantity',NEW.quantity)),
    'product.sold_out:'||s.id||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_sold_out_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sold_out_business_event AFTER INSERT OR UPDATE OF status ON public.seat_reservations
  FOR EACH ROW EXECUTE FUNCTION public.capture_sold_out_event();
