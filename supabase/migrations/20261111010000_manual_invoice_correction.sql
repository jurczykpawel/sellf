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

-- ===== W256d: invoice settings + their audit entry in ONE transaction =====
-- Replaces "audit entry first, update, take the entry back on error" in actions/invoicing.ts: a process
-- killed between the two requests left an UPDATE entry while the settings stayed unchanged (W256cr P2,
-- measured with SIGKILL). p_token is the already encrypted token (app-side APP_ENCRYPTION_KEY); NULL
-- keeps the saved one. Validation of the values stays in the table's CHECK constraints.
CREATE FUNCTION public.save_invoicing_config(p_settings jsonb, p_token jsonb, p_performed_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_performed_by IS NULL OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
     OR (p_token IS NOT NULL AND jsonb_typeof(p_token) <> 'object') THEN
    RAISE EXCEPTION 'Invalid invoice settings' USING ERRCODE='22023';
  END IF;
  UPDATE public.invoicing_config SET
    provider = p_settings->>'provider', domain = p_settings->>'domain', mode = p_settings->>'mode',
    exemption = p_settings->>'exemption', template = p_settings->>'template',
    token = CASE WHEN p_token IS NULL THEN token ELSE p_token END
  WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice settings unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.audit_log(table_name, operation, performed_by, new_values)
    VALUES('invoicing_config', 'UPDATE', p_performed_by, jsonb_build_object('provider', p_settings->>'provider'));
END $$;
REVOKE ALL ON FUNCTION public.save_invoicing_config(jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_invoicing_config(jsonb, jsonb, uuid) TO service_role;
