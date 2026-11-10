ALTER TABLE public.invoices DROP CONSTRAINT invoices_provider_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_provider_check
  CHECK (provider = 'fakturownia' OR (provider = 'manual' AND status = 'corrected'));

CREATE FUNCTION public.record_invoice_correction(p_transaction uuid, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; existing public.invoices%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN
    RETURN false;
  END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_transaction FOR UPDATE;
  IF NOT FOUND OR tx.status NOT IN ('cancelled','refunded') THEN RETURN false; END IF;
  SELECT * INTO existing FROM public.invoices WHERE transaction_id=p_transaction FOR UPDATE;
  IF FOUND THEN
    IF existing.status='corrected' THEN RETURN true; END IF;
    IF existing.status<>'issued' THEN RETURN false; END IF;
    UPDATE public.invoices SET status='corrected',updated_at=now() WHERE id=existing.id;
  ELSE
    IF tx.invoice_hold_at IS NULL THEN RETURN false; END IF;
    INSERT INTO public.invoices(transaction_id,provider,status,external_key,provider_domain)
      VALUES(p_transaction,'manual','corrected','manual:'||p_transaction::text,'');
  END IF;
  INSERT INTO public.audit_log(table_name,operation,performed_by,new_values)
    VALUES('invoices','UPDATE',p_actor,jsonb_build_object('transaction_id',p_transaction,'action','corrected'));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_invoice_correction(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_correction(uuid,uuid) TO service_role;
