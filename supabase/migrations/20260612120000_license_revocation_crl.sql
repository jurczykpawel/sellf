-- Revocation list (CRL) reader for issued licenses.
-- Licensed products verify offline (no callback), so a refunded/abused token would keep
-- working until expiry. The public /api/licenses/revoked endpoint reads this to publish a
-- seller-scoped list of revoked order ids; the consumer refuses a token whose `order` is on it.
--
-- SECURITY DEFINER so the public endpoint can read JUST the revoked order ids without
-- issued_licenses (which carries emails + the signed token) being readable by anon/authenticated.
-- Mirrors public.seller_license_public_keys. Order ids are opaque (Stripe ids / synthetic) and
-- carry no token material — safe to publish; everything else stays service-role only.
CREATE OR REPLACE FUNCTION public.seller_revoked_orders(seller UUID)
RETURNS TABLE (order_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.order_id
  FROM public.issued_licenses l
  WHERE l.seller_id = seller AND l.revoked_at IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.seller_revoked_orders(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_revoked_orders(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.seller_revoked_orders IS
  'Returns revoked order ids for a seller (license revocation list / CRL). Public-safe: only opaque order ids of revoked licenses, never token or PII columns.';
