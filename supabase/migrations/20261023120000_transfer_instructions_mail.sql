-- Transfer instructions share the Auth email channel.
ALTER TABLE public.payment_transactions ADD COLUMN transfer_mail_sent_at timestamptz;
CREATE INDEX payment_transfer_mail_pending ON public.payment_transactions(created_at)
  WHERE payment_provider='bank_transfer' AND transfer_mail_sent_at IS NULL AND status IN ('awaiting_payment','completed');
CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')-'event_date'-'event_online_url'-'transfer_text')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date','event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text'))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;
