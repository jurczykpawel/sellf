-- Keep the processor refund status separate from the payment transaction status.
ALTER TABLE public.payment_transactions
  ADD COLUMN refund_status text
  CHECK (refund_status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'));

COMMENT ON COLUMN public.payment_transactions.refund_status IS
  'Status returned by Stripe for refund_id; NULL when not observed. Never inferred from payment status.';
