-- Stripe issues a paid zero-total invoice when a subscription trial starts.
-- Retain positive-only amounts for orders without a subscription invoice.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT payment_transactions_amount_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_amount_check CHECK (
    amount <= 99999999 AND (
      amount > 0 OR (
        amount = 0 AND subscription_id IS NOT NULL AND stripe_invoice_id IS NOT NULL
      )
    )
  );
