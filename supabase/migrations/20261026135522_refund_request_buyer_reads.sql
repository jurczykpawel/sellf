-- Read refund requests using the current session's identity.

DROP POLICY "Users can view own refund requests" ON public.refund_requests;
CREATE POLICY "Users can view own refund requests" ON public.refund_requests
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR customer_email = (SELECT auth.jwt() ->> 'email')
    OR (SELECT public.is_admin())
  );
