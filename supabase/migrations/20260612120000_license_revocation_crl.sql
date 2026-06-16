-- Revocation list (CRL) reader for issued licenses.
-- Licensed products verify offline (no callback), so a refunded/abused token would keep
-- working until expiry. The public /api/licenses/revoked endpoint reads this to publish a
-- seller-scoped list of SHA-256 order hashes; the consumer hashes its token's `order` claim.
--
-- SECURITY DEFINER so the public endpoint can read JUST irreversible order hashes without
-- issued_licenses (which carries emails + the signed token) being readable by anon/authenticated.
-- Mirrors public.seller_license_public_keys. Order ids are opaque (Stripe ids / synthetic) and
-- carry no token material — safe to publish; everything else stays service-role only.
CREATE OR REPLACE FUNCTION public.seller_revoked_orders(seller UUID)
RETURNS TABLE (order_hash TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(extensions.digest(convert_to(l.order_id, 'UTF8'), 'sha256'), 'hex')
  FROM public.issued_licenses l
  WHERE l.seller_id = seller AND l.revoked_at IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.seller_revoked_orders(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_revoked_orders(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.seller_revoked_orders IS
  'Returns SHA-256 order hashes for a seller CRL; never exposes raw order ids, tokens, or PII columns.';
