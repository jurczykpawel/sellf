-- Historical guest rows retain their original session association for access mail.
CREATE OR REPLACE FUNCTION public.event_mail_access(p_email text,p_product_id uuid,p_transaction_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
SELECT EXISTS(SELECT 1 FROM public.user_product_access a JOIN auth.users u ON u.id=a.user_id
  WHERE lower(u.email)=lower(p_email) AND a.product_id=p_product_id AND (a.access_expires_at IS NULL OR a.access_expires_at>now()))
OR EXISTS(SELECT 1 FROM public.guest_purchases g
  WHERE lower(g.customer_email)=lower(p_email) AND g.product_id=p_product_id AND g.claimed_by_user_id IS NULL
    AND (g.transaction_id=p_transaction_id OR (g.transaction_id IS NULL AND EXISTS(
      SELECT 1 FROM public.payment_transactions t WHERE t.id=p_transaction_id AND t.product_id=g.product_id
        AND lower(t.customer_email)=lower(g.customer_email) AND t.status='completed'
        AND t.session_id IS NOT NULL AND t.session_id=g.session_id))));
$$;
REVOKE ALL ON FUNCTION public.event_mail_access(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_mail_access(text,uuid,uuid) TO service_role;
