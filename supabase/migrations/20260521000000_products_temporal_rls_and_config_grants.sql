-- Tighten SELECT visibility on products and trim a redundant GRANT.
--
-- products: anonymous and non-admin authenticated callers should only see
-- rows that are currently within their availability window. Admin override
-- and the waitlist fallback are preserved so admin tooling and the public
-- waitlist form continue to work.
--
-- payment_method_config: rows are already gated by the is_admin() RLS
-- policy; the table-level GRANT SELECT/UPDATE to authenticated is therefore
-- redundant and gives non-admin members of the authenticated role surface
-- area they never legitimately use. All admin reads/writes go through
-- service-role-backed server actions in admin-panel/src/lib/actions.

-- NB: no top-level BEGIN/COMMIT here — the production migration runner
-- (apply_migration RPC) executes the file via PL/pgSQL EXECUTE, which does
-- not support transaction commands. The runner already wraps the apply in
-- its own transaction.

-- 1) Temporal visibility on products SELECT policy
DROP POLICY IF EXISTS "SELECT policy for products" ON seller_main.products;
CREATE POLICY "SELECT policy for products" ON seller_main.products
  FOR SELECT
  USING (
    -- Admin users see everything.
    ( select public.is_admin() )
    -- Public users see active products inside their availability window.
    OR (
      is_active = true
      AND (available_from IS NULL OR available_from <= now())
      AND (available_until IS NULL OR available_until >= now())
    )
    -- Inactive products with waitlist enabled stay visible so the waitlist
    -- form can still load even outside the active window.
    OR (is_active = false AND enable_waitlist = true)
  );

-- 2) Redundant authenticated grants on payment_method_config
REVOKE SELECT, UPDATE ON seller_main.payment_method_config FROM authenticated;
GRANT SELECT, UPDATE ON seller_main.payment_method_config TO service_role;
