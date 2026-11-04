-- W148-5: background template-key confirmations were rejected once the app clock ran ahead of
-- the database clock (checked_at > clock_timestamp()), so every refresh after the first one
-- failed and the panel showed "unknown". Accept a bounded skew and never store a future time.
-- Same signature, grants and safeguards as 20261016231510_template_credential_status.sql.
CREATE OR REPLACE FUNCTION public.record_template_credential_status(template_id text, expected_key text, expected_iv text,
  expected_tag text, verification_state text, checked_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR verification_state IS NULL OR
    verification_state NOT IN ('valid','expired','revoked','invalid','unknown') OR
    checked_at IS NULL OR checked_at > clock_timestamp() + interval '5 minutes' OR
    checked_at < clock_timestamp() - interval '60 seconds' THEN
    RETURN false;
  END IF;
  UPDATE public.template_credentials AS stored SET state=verification_state,
    verified_at=CASE WHEN verification_state='unknown' THEN NULL ELSE least(checked_at, clock_timestamp()) END
    WHERE stored.template_id=record_template_credential_status.template_id AND stored.encrypted_key=expected_key AND
      stored.encryption_iv=expected_iv AND stored.encryption_tag=expected_tag AND
      (stored.verified_at IS NULL OR stored.verified_at<=checked_at) AND
      (stored.state<>'revoked' OR verification_state='revoked');
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('template_credentials','UPDATE',
    jsonb_build_object('templateId',template_id,'state',verification_state,'source','background'));
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_template_credential_status(text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_template_credential_status(text,text,text,text,text,timestamptz) TO service_role;
