-- ============================================================================
-- Public price-history surface for the EU Omnibus Directive (2019/2161)
-- ============================================================================
--
-- The Omnibus client needs the lowest historical price for active+listed
-- products. Defines public.omnibus_price_history as a narrowed projection
-- over public.product_price_history exposing only the columns the
-- client consumes; raw table access is restricted to service_role.
--
-- Schema-resolution note: Supabase config exposes both `public` and
-- `public` schemas via PostgREST, with `public` first (default). The
-- supabase-js client used by this app sets `db.schema = 'public'` and
-- therefore sends `Accept-Profile: public` automatically. External REST
-- callers (raw curl, third-party tooling) must set the same header
-- explicitly to reach this view.
-- ============================================================================


-- NOTE: deliberately NOT security_invoker = on. The underlying
-- public.product_price_history is REVOKE'd from anon/authenticated; this
-- narrowed view must run as owner so anon can read price history for the
-- active+listed subset without granting raw table access.
CREATE OR REPLACE VIEW public.omnibus_price_history AS
SELECT
  pph.product_id,
  pph.price,
  pph.sale_price,
  pph.currency,
  pph.effective_from
FROM public.product_price_history pph
INNER JOIN public.products p ON p.id = pph.product_id
WHERE p.is_active = true
  AND p.is_listed = true;

COMMENT ON VIEW public.omnibus_price_history IS
  'Omnibus Directive (2019/2161) public display surface — narrowed columns '
  'over the active+listed product set.';

REVOKE SELECT ON public.product_price_history FROM anon, authenticated;
GRANT SELECT ON public.product_price_history TO service_role;

-- View privileges: explicit allow-list. The default ALTER DEFAULT
-- PRIVILEGES policy in this app grants ALL on public-schema relations to
-- anon/authenticated; revoke first, then grant only SELECT.
REVOKE ALL ON public.omnibus_price_history FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.omnibus_price_history TO anon, authenticated;
GRANT ALL ON public.omnibus_price_history TO service_role;
