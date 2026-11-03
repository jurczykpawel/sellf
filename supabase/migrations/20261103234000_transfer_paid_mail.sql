-- Marks that the buyer was told the transfer was booked (the mail context itself: prepare_event_mail superset migration).
ALTER TABLE public.payment_transactions ADD COLUMN transfer_paid_mail_sent_at timestamptz;
-- Orders paid before this release are not announced retroactively.
UPDATE public.payment_transactions SET transfer_paid_mail_sent_at = now()
  WHERE payment_provider = 'bank_transfer' AND status = 'completed' AND transfer_paid_mail_sent_at IS NULL;
CREATE INDEX payment_transactions_transfer_paid_mail_idx ON public.payment_transactions (id)
  WHERE payment_provider = 'bank_transfer' AND status = 'completed' AND transfer_paid_mail_sent_at IS NULL;
