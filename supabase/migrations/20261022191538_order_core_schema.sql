BEGIN;
-- Provider-independent order references and saved pricing. Existing policies stay in force.
LOCK TABLE public.payment_transactions IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE public.payment_order_number_seq START WITH 1001;
REVOKE ALL ON SEQUENCE public.payment_order_number_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_order_number_seq TO service_role;

ALTER TABLE public.payment_transactions
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe' CHECK (payment_provider IN ('stripe', 'bank_transfer')),
  ADD COLUMN order_number bigint,
  ADD COLUMN pricing_snapshot_version integer CHECK (pricing_snapshot_version = 1),
  ADD COLUMN coupon_id uuid REFERENCES public.coupons(id) ON DELETE RESTRICT,
  ADD COLUMN livemode boolean NOT NULL DEFAULT false;
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) + 1000 AS number
  FROM public.payment_transactions
)
UPDATE public.payment_transactions p SET order_number = n.number FROM numbered n WHERE n.id = p.id;
SELECT setval('public.payment_order_number_seq',
  greatest(1001, coalesce(max(order_number), 1001)), count(*) > 0) FROM public.payment_transactions;
ALTER SEQUENCE public.payment_order_number_seq OWNED BY public.payment_transactions.order_number;
ALTER TABLE public.payment_transactions
  ALTER COLUMN order_number SET NOT NULL,
  ALTER COLUMN order_number SET DEFAULT nextval('public.payment_order_number_seq'),
  ADD CONSTRAINT payment_transactions_order_number_key UNIQUE (order_number),
  ALTER COLUMN session_id DROP NOT NULL,
  DROP CONSTRAINT payment_transactions_session_id_check,
  ADD CONSTRAINT payment_transactions_provider_ref_chk CHECK (
    (payment_provider = 'stripe' AND session_id IS NOT NULL
      AND length(session_id) BETWEEN 1 AND 255 AND session_id ~* '^(cs_|pi_|in_)[a-zA-Z0-9_]+$')
    OR (payment_provider = 'bank_transfer' AND session_id IS NULL
      AND stripe_payment_intent_id IS NULL AND pricing_snapshot_version IS NOT NULL)
  ),
  DROP CONSTRAINT payment_transactions_status_check,
  ADD CONSTRAINT payment_transactions_status_check CHECK (status IN (
    'pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned', 'awaiting_payment', 'cancelled'
  )),
  DROP CONSTRAINT payment_transactions_tax_snapshot_status_chk,
  ADD CONSTRAINT payment_transactions_tax_snapshot_status_chk
    CHECK (tax_snapshot_status IN ('none', 'captured', 'partial', 'unavailable', 'local'));
CREATE INDEX payment_transactions_coupon_idx ON public.payment_transactions(coupon_id) WHERE coupon_id IS NOT NULL;

ALTER TABLE public.payment_line_items ADD COLUMN discounted_total numeric
  CHECK (discounted_total >= 0 AND discounted_total <= 99999999);
COMMENT ON COLUMN public.payment_line_items.discounted_total IS 'MAJOR units after coupon; NULL for legacy lines.';
-- Keep the legacy session join unambiguous when guest rows gain transaction_id.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.claim_guest_purchases_for_user(uuid)'::regprocedure) INTO definition;
  IF position('SELECT gp.*, pt.id as transaction_id' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected guest purchase projection not found';
  END IF;
  EXECUTE replace(definition, 'SELECT gp.*, pt.id as transaction_id',
    'SELECT gp.id, gp.product_id, gp.session_id, pt.id as transaction_id');
END;
$migration$;
ALTER TABLE public.guest_purchases
  ADD COLUMN transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  ALTER COLUMN session_id DROP NOT NULL,
  DROP CONSTRAINT guest_purchases_session_id_check,
  ADD CONSTRAINT guest_purchases_order_ref_chk CHECK (
    (session_id IS NOT NULL OR transaction_id IS NOT NULL)
    AND (session_id IS NULL OR (length(session_id) BETWEEN 1 AND 255 AND session_id ~* '^(cs_|pi_)[a-zA-Z0-9_]+$'))
  );
UPDATE public.guest_purchases g SET transaction_id = p.id
FROM public.payment_transactions p WHERE p.session_id = g.session_id;
CREATE UNIQUE INDEX guest_purchases_transaction_idx ON public.guest_purchases(transaction_id) WHERE transaction_id IS NOT NULL;
ALTER TABLE public.products ADD COLUMN allow_repeat_purchase boolean NOT NULL DEFAULT false;
COMMIT;
