-- Issued-license ledger columns + CRL hardened to a k-anonymity prefix range query.
--
-- This is a SEPARATE migration from 20260612120000 (which only created the original
-- seller_revoked_orders(uuid) full-dump function): that one already shipped to environments,
-- and migrations are applied once by name. Mutating it in place would silently NOT run on a
-- DB that already applied it, leaving the columns/function out of sync. So all of this lives
-- here, idempotently, and reaches every environment.

-- Ledger columns: how a license was issued (purchase vs manual) and its bound domain.
ALTER TABLE public.issued_licenses
  ADD COLUMN IF NOT EXISTS issuance_source TEXT NOT NULL DEFAULT 'purchase'
    CHECK (issuance_source IN ('purchase', 'manual')),
  ADD COLUMN IF NOT EXISTS license_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_issued_licenses_source_issued_at
  ON public.issued_licenses (issuance_source, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_issued_licenses_domain
  ON public.issued_licenses (license_domain)
  WHERE license_domain IS NOT NULL;

-- CRL: replace the full-dump reader with a k-anonymity RANGE query. The caller passes a hex
-- PREFIX of SHA-256(order) and gets back only the revoked hashes in that bucket — the server
-- never sees the full hash and no single request yields the whole list (hiding the revocation
-- count). EXECUTE is service-role only: the public /api/licenses/revoked endpoint (which enforces
-- the hex-prefix contract) is the sole caller, so anon/authenticated cannot invoke it directly
-- and bypass the prefix with a wildcard.
DROP FUNCTION IF EXISTS public.seller_revoked_orders(UUID);

CREATE OR REPLACE FUNCTION public.seller_revoked_orders(seller UUID, hash_prefix TEXT)
RETURNS TABLE (order_hash TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT h.order_hash
  FROM public.issued_licenses l
  CROSS JOIN LATERAL (
    SELECT encode(extensions.digest(convert_to(l.order_id, 'UTF8'), 'sha256'), 'hex') AS order_hash
  ) h
  WHERE l.seller_id = seller
    AND l.revoked_at IS NOT NULL
    -- Defense in depth: reject anything but a hex prefix so a wildcard ('%','_') can never
    -- widen the bucket to the whole list. A non-hex prefix simply matches nothing.
    AND hash_prefix ~ '^[0-9a-f]{1,64}$'
    AND h.order_hash LIKE hash_prefix || '%';
$$;

REVOKE EXECUTE ON FUNCTION public.seller_revoked_orders(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_revoked_orders(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.seller_revoked_orders IS
  'k-anonymity CRL range query: returns revoked SHA-256 order hashes matching a hex prefix for a seller. Service-role only; never exposes raw order ids, tokens, or PII columns.';
