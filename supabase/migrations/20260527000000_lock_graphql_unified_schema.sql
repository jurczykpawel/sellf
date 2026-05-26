-- ============================================================================
-- Lock GraphQL introspection after schema unification (seller_main → public).
--
-- Pre-unification: domain tables lived in seller_main. pg_graphql introspects
-- only the public schema, so seller_main tables were invisible to GraphQL
-- automatically — schema isolation acted as a free GraphQL lock.
--
-- Post-unification: every table lives in public. pg_graphql does not support
-- excluding tables via comment directives (issue supabase/pg_graphql#470);
-- the only way to hide a table is to REVOKE SELECT from anon/authenticated.
-- We REVOKE on tables that are NOT part of the storefront read path. Products,
-- categories, tags etc. remain anon-readable (storefront needs them) and are
-- intentionally exposed in GraphQL — the runtime test allowlist is relaxed to
-- match.
--
-- See: vault/brands/_shared/reference/* (post-spike doc TBD)
-- ============================================================================

-- Admin/internal-only tables — no anon SELECT path needed.
REVOKE SELECT ON public.consent_logs FROM anon, authenticated;
REVOKE SELECT ON public.coupon_redemptions FROM anon, authenticated;
REVOKE SELECT ON public.coupon_reservations FROM anon, authenticated;
REVOKE SELECT ON public.profiles FROM anon, authenticated;
REVOKE SELECT ON public.user_product_access FROM anon, authenticated;
REVOKE SELECT ON public.video_events FROM anon, authenticated;
REVOKE SELECT ON public.video_progress FROM anon, authenticated;

-- Service-role still needs to read these, plus authenticated needs RLS-gated
-- access to its own rows.
GRANT SELECT ON public.consent_logs TO service_role;
GRANT SELECT ON public.coupon_redemptions TO service_role;
GRANT SELECT ON public.coupon_reservations TO service_role;
GRANT SELECT ON public.profiles TO authenticated, service_role;
GRANT SELECT ON public.user_product_access TO authenticated, service_role;
GRANT SELECT ON public.video_events TO authenticated, service_role;
GRANT SELECT ON public.video_progress TO authenticated, service_role;

-- Re-apply admin_save_oto_offer GraphQL exclusion + REVOKE on the current
-- 10-arg signature. The original directive + REVOKE from
-- 20260429110000_lock_graphql_introspection were attached to the 6-arg
-- signature, which was replaced by 20260515110000_funnel_downsell (DROP +
-- CREATE with downsell params) and silently lost both — anon got default
-- EXECUTE, so pg_graphql exposed the function as a Mutation.
REVOKE EXECUTE ON FUNCTION public.admin_save_oto_offer(
  uuid, uuid, text, numeric, integer, boolean,
  uuid, text, numeric, integer
) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_save_oto_offer(
  uuid, uuid, text, numeric, integer, boolean,
  uuid, text, numeric, integer
) TO service_role;

COMMENT ON FUNCTION public.admin_save_oto_offer(
  uuid, uuid, text, numeric, integer, boolean,
  uuid, text, numeric, integer
) IS E'@graphql({"include": false})';

-- omnibus_price_history security_invoker is fixed in the upstream migration
-- 20260429100000_narrow_price_history_public_view.sql (one-line edit).
