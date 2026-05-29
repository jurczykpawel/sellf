-- Seller-issued product license keys.
-- Sellers can issue ECDSA-signed license tokens to buyers on purchase, verified
-- offline with the seller's public key. Private keys are stored encrypted at rest
-- (same AES-256-GCM mechanism as Stripe secrets) and never leave the service role.

-- ── Seller keypairs (one active per seller; supports rotation) ───────────────
CREATE TABLE IF NOT EXISTS public.seller_license_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kid TEXT NOT NULL,
  public_key TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_tag TEXT NOT NULL,
  alg TEXT NOT NULL DEFAULT 'ES256',
  custody TEXT NOT NULL CHECK (custody IN ('managed', 'byok')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, kid)
);

CREATE INDEX IF NOT EXISTS idx_seller_license_keys_active
  ON public.seller_license_keys (seller_id)
  WHERE is_active = true;

ALTER TABLE public.seller_license_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON public.seller_license_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Private-key columns must never be reachable by anon/authenticated.
REVOKE ALL ON public.seller_license_keys FROM anon, authenticated;
GRANT ALL ON public.seller_license_keys TO service_role;

-- ── Issued licenses ledger (idempotency + re-issue/audit) ───────────────────
CREATE TABLE IF NOT EXISTS public.issued_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  email TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id TEXT NOT NULL,
  kid TEXT NOT NULL,
  license_key TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_issued_licenses_product ON public.issued_licenses (product_id);

ALTER TABLE public.issued_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON public.issued_licenses
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.issued_licenses FROM anon, authenticated;
GRANT ALL ON public.issued_licenses TO service_role;

-- ── Per-product issuance config ─────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS issue_license_on_purchase BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS license_tier TEXT,
  ADD COLUMN IF NOT EXISTS license_duration_days INTEGER
    CHECK (license_duration_days IS NULL OR license_duration_days > 0);

-- ── Public-keys reader (the only path the public JWKS endpoint uses) ─────────
-- SECURITY DEFINER so the public endpoint can read public keys without the
-- table being readable by anon/authenticated — encrypted columns stay private.
CREATE OR REPLACE FUNCTION public.seller_license_public_keys(seller UUID)
RETURNS TABLE (kid TEXT, public_key TEXT, alg TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT k.kid, k.public_key, k.alg
  FROM public.seller_license_keys k
  WHERE k.seller_id = seller AND k.is_active = true;
$$;

REVOKE EXECUTE ON FUNCTION public.seller_license_public_keys(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_license_public_keys(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.seller_license_public_keys IS
  'Returns active public keys (kid, public_key, alg) for a seller. Public-safe: never exposes encrypted private-key columns.';
