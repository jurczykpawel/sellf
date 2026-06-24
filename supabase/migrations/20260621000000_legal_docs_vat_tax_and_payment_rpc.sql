-- Consolidated pre-release migration (project rule: until a migration reaches prod, ALL
-- changes since the last release stay in ONE file). THREE concerns live here:
--   1) Legal document generation (Sellf x legal-engine) — seller company fields, anon
--      column-grants, public `legal` Storage bucket. (Sections 1–3 below.)
--   2) VAT tax snapshot — per-line tax columns + CHECKs + products.vat_exempt.
--   3) Payment-completion RPC net/gross fix — process_stripe_payment_completion_with_bump
--      gains amount_subtotal_param; validates NET for net-priced products (GROSS for brutto).
-- (Was 20260621000000_legal_document_generation.sql before (2)/(3) were folded in.)
--
-- ===== Concern 1: Legal document generation =====
-- (1) seller company fields on shop_config,
-- (2) column-level anon SELECT so the new seller-PII fields are admin-only,
-- (3) the public `legal` Storage bucket for generated Terms/Privacy HTML.

-- ============================================================================
-- 1) Seller company fields (read by the legal-engine API to build doc config)
-- ============================================================================
alter table public.shop_config
  add column if not exists legal_form text check (legal_form in ('jdg','spzoo','fundacja','osoba_fizyczna')),
  add column if not exists company_legal_name text,
  add column if not exists nip text,
  add column if not exists regon text,
  add column if not exists krs text,
  add column if not exists company_street text,
  add column if not exists company_building_no text,
  add column if not exists company_flat_no text,
  add column if not exists company_city text,
  add column if not exists company_postal text,
  add column if not exists company_phone text,
  add column if not exists complaints_email text,
  add column if not exists is_vat_exempt boolean not null default false,
  add column if not exists is_micro_enterprise boolean not null default false,
  add column if not exists has_dpo boolean not null default false,
  add column if not exists dpo_contact text;

-- ============================================================================
-- 1b) Shop country (ISO-3166-1 alpha-2, nullable) — gates Poland-only features
-- ============================================================================
alter table public.shop_config
  add column if not exists country text;

-- ============================================================================
-- 2) Restrict anon SELECT to public-safe columns (seller PII = admin-only)
-- ============================================================================
-- shop_config already had a blanket GRANT SELECT ... TO anon (20250103000000_features.sql)
-- + a "Public read access" row policy USING (true). With the new PII columns that would
-- make NIP/REGON/KRS/address/phone/DPO world-readable via PostgREST. Switch anon to a
-- column-level grant covering only what the public storefront needs.
--
-- contact_email IS public — it's the shop's intentionally-public contact, already shown
-- to anonymous visitors on the "Coming Soon" page; NOT seller PII.
-- Excluded (admin-only): legal_form, company_legal_name, nip, regon, krs, company_street,
-- company_building_no, company_flat_no, company_city, company_postal, company_phone,
-- complaints_email, is_vat_exempt, is_micro_enterprise, has_dpo, dpo_contact.
--
-- NOTE: the app-side getShopConfig() (shop-config.ts) selects this exact column list via
-- the anon client (NOT select('*'), which column-level grants would deny). Keep the SQL
-- grant list and SHOP_CONFIG_PUBLIC_COLUMNS in sync.
REVOKE SELECT ON public.shop_config FROM anon;

GRANT SELECT (
  id,
  shop_name,
  default_currency,
  tax_rate,
  tax_mode,
  stripe_tax_rate_cache,
  logo_url,
  font_family,
  checkout_theme,
  automatic_tax_enabled,
  tax_id_collection_enabled,
  checkout_billing_address,
  checkout_expires_hours,
  checkout_collect_terms,
  terms_of_service_url,
  privacy_policy_url,
  omnibus_enabled,
  -- custom_settings deliberately NOT anon-readable: free-form jsonb, admin-only, so a
  -- future write (e.g. an integration secret) can't leak via the public storefront read.
  created_at,
  updated_at,
  contact_email
) ON public.shop_config TO anon;

-- ============================================================================
-- 3) Public `legal` Storage bucket for generated Terms/Privacy HTML
-- ============================================================================
-- Path layout (enforced by lib/legal/storage.ts):
--   {shopId}/terms.html, {shopId}/privacy.html  (current, stable public URLs)
--   {shopId}/terms/archive/..., {shopId}/privacy/archive/...  (frozen previous versions)
-- No RLS policies on storage.objects, by design. The legal feature only WRITES via the service_role
-- admin client (which BYPASSES RLS) and only READS by serving this PUBLIC bucket's public URLs
-- (which also bypass RLS) — those are the only access paths it uses. Explicit storage.objects
-- policies would therefore do nothing here, AND `CREATE POLICY ON storage.objects` requires ownership
-- (supabase_storage_admin) that the service-role migration runner (apply_migration RPC) lacks on
-- managed Supabase → 42501 "must be owner of table objects", which would roll back the whole
-- migration. service_role CAN insert the bucket row itself, so a plain insert is safe. If a future
-- access pattern ever needs RLS on these objects, create the policies out-of-band via the Storage
-- Management API (as supabase_storage_admin), not in a service-role migration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal', 'legal', true, 5242880, array['text/html', 'text/plain'])
on conflict (id) do nothing;

-- ============================================================================
-- VAT TAX SNAPSHOT
-- Consolidated into this single pre-release migration (project rule: until a
-- migration reaches prod, all changes since the last release stay in ONE file).
-- Per-line tax frozen at purchase (numbers from Stripe).
--
-- NOTE ON UNITS: the tax amount columns below are in MINOR units (cents/grosze),
-- matching payment_transactions.amount and Stripe. They sit next to
-- payment_line_items.unit_price/total_price which are MAJOR units. Do not mix.
--
-- @see docs/superpowers/specs/2026-06-22-vat-tax-snapshot-design.md
-- @see docs/superpowers/specs/2026-06-22-vat-tax-snapshot-stripe-extraction-research.md
-- ============================================================================

-- payment_line_items: per-line snapshot
ALTER TABLE public.payment_line_items
  ADD COLUMN tax_breakdown     jsonb   NOT NULL DEFAULT '[]'::jsonb, -- full Stripe components
  ADD COLUMN tax_amount        integer,            -- minor units; line.amount_tax
  ADD COLUMN net_amount        integer,            -- minor units; line.amount_subtotal (post-discount)
  ADD COLUMN vat_rate          numeric(5,2),       -- single-component effective %, else NULL (D5)
  ADD COLUMN tax_behavior      text,               -- 'inclusive' | 'exclusive'
  ADD COLUMN vat_exempt        boolean NOT NULL DEFAULT false, -- snapshot of products.vat_exempt
  ADD COLUMN taxability_reason text;               -- Stripe reason (stripe_tax mode)

COMMENT ON COLUMN public.payment_line_items.tax_amount IS 'MINOR units (cents). Unlike unit_price/total_price which are MAJOR units.';
COMMENT ON COLUMN public.payment_line_items.net_amount IS 'MINOR units (cents). Unlike unit_price/total_price which are MAJOR units.';
COMMENT ON COLUMN public.payment_line_items.tax_breakdown IS 'Array of Stripe tax components: {amount,taxableAmount,rate,effectiveRate,inclusive,taxType,jurisdiction,country,state,taxabilityReason}. amount/taxableAmount in MINOR units.';

-- tax_behavior is OUR derived value (from the component's `inclusive` flag), never Stripe's
-- raw 'unspecified' — so it's only ever 'inclusive' | 'exclusive' | NULL. Guard it.
-- (taxability_reason deliberately has NO check: it comes verbatim from Stripe, which may add
-- new reason codes — a snapshot must not reject those.)
ALTER TABLE public.payment_line_items
  ADD CONSTRAINT payment_line_items_tax_behavior_chk
  CHECK (tax_behavior IN ('inclusive', 'exclusive'));

-- payment_transactions: order-level totals + honesty flag
ALTER TABLE public.payment_transactions
  ADD COLUMN net_total integer,  -- minor units; session.amount_subtotal
  ADD COLUMN tax_total integer,  -- minor units; session.total_details.amount_tax
  ADD COLUMN tax_snapshot_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_tax_snapshot_status_chk
  CHECK (tax_snapshot_status IN ('none', 'captured', 'partial', 'unavailable'));

COMMENT ON COLUMN public.payment_transactions.tax_total IS 'MINOR units (cents); matches Stripe total_details.amount_tax verbatim.';
COMMENT ON COLUMN public.payment_transactions.net_total IS 'MINOR units (cents); Stripe amount_subtotal.';
COMMENT ON COLUMN public.payment_transactions.tax_snapshot_status IS 'none = no tax line; captured = full per-line snapshot; partial = totals only (line match failed); unavailable = tax not computable.';

-- products: explicit VAT-exempt status (distinct from rate 0)
ALTER TABLE public.products
  ADD COLUMN vat_exempt      boolean NOT NULL DEFAULT false,
  ADD COLUMN vat_exempt_note text;

COMMENT ON COLUMN public.products.vat_exempt IS 'Product sold VAT-exempt ("zwolniony / zw."), distinct from a 0% rate. Carried into the order tax snapshot. Default for new products inherits shop_config.is_vat_exempt.';

-- NOTE: the shop-level default for a new product's vat_exempt reuses the existing
-- shop_config.is_vat_exempt (company VAT-exempt status, from the legal-docs feature) —
-- no separate default_vat_exempt column (DRY).

-- Grants: products.vat_exempt/note must be readable by checkout (like vat_rate).
-- Column-level grant: harmless if products already has table-level SELECT to these
-- roles, required if products uses column-level grants. shop_config.default_vat_exempt
-- is admin-only (read via getMyShopConfig) — NO anon grant. New payment_* columns stay
-- service-role-only (inherit existing table grants).
GRANT SELECT (vat_exempt, vat_exempt_note) ON public.products TO anon, authenticated;

-- ============================================================================
-- VAT net/gross amount validation in the payment-completion RPC
-- Adding amount_subtotal_param changes the signature → DROP + recreate both the
-- wrapper and the impl, then re-GRANT. Bodies are copied VERBATIM from
-- 20260617 (impl) / 20260610112649 (wrapper); the ONLY behavioural change is the
-- amount-validation basis: NET (amount_subtotal) for net-priced products, GROSS
-- (amount_total) for brutto. Holds for local AND stripe_tax (net invariant for
-- exclusive, gross invariant for inclusive). See priv reference §6.
-- ============================================================================

-- Drop wrapper first (it calls the impl), then the impl. Old 9-arg signatures.
DROP FUNCTION IF EXISTS public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
);
DROP FUNCTION IF EXISTS public._process_stripe_payment_completion_with_bump_impl(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
);

CREATE OR REPLACE FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_ids_param UUID[] DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL,
  amount_subtotal_param NUMERIC DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  pi_param TEXT := stripe_payment_intent_id;
  current_user_id UUID;
  product_record RECORD;
  existing_user_id UUID;
  access_expires_at TIMESTAMPTZ := NULL;
  transaction_id_var UUID;
  pending_transaction_id UUID;
  bump_rec RECORD;
  total_bump_price NUMERIC := 0;
  bump_count INTEGER := 0;
  bump_ids_found UUID[] := '{}';
  main_line_item_price NUMERIC := 0;
  effective_unit_price NUMERIC := 0;
  existing_transaction_id UUID;
  caller_email TEXT;
  charge_basis NUMERIC := 0;  -- net for net-priced products, else gross
BEGIN
  IF NOT public.check_rate_limit('process_stripe_payment_completion', 100, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded');
  END IF;

  IF session_id_param IS NULL OR length(session_id_param) = 0 OR length(session_id_param) > 255 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID');
  END IF;

  IF NOT (session_id_param ~* '^(cs_|pi_)[a-zA-Z0-9_]+$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID format');
  END IF;

  IF product_id_param IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product ID is required');
  END IF;

  IF NOT public.validate_email_format(customer_email_param) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid email address is required');
  END IF;

  IF amount_total IS NULL OR amount_total <= 0 OR amount_total > 99999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  IF user_id_param IS NOT NULL THEN
    IF (select auth.role()) = 'service_role' THEN
      current_user_id := user_id_param;
    ELSIF auth.uid() = user_id_param THEN
      current_user_id := user_id_param;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
  ELSE
    current_user_id := NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE session_id = session_id_param AND status != 'pending') THEN
    IF current_user_id IS NOT NULL THEN
      SELECT email INTO caller_email FROM auth.users WHERE id = current_user_id;
      IF caller_email IS NOT NULL AND lower(caller_email) = lower(customer_email_param) THEN
        SELECT id INTO existing_transaction_id
        FROM public.payment_transactions
        WHERE session_id = session_id_param
        LIMIT 1;

        IF EXISTS (
          SELECT 1 FROM public.guest_purchases
          WHERE session_id = session_id_param AND claimed_by_user_id IS NULL
        ) THEN
          PERFORM public.grant_product_access_service_role(current_user_id, product_id_param);

          FOR bump_rec IN
            SELECT pli.product_id, pli.access_duration_override
            FROM public.payment_line_items pli
            WHERE pli.transaction_id = existing_transaction_id
              AND pli.item_type = 'order_bump'
          LOOP
            PERFORM public.grant_product_access_service_role(
              current_user_id,
              bump_rec.product_id,
              override_duration_days_param => bump_rec.access_duration_override
            );
          END LOOP;

          UPDATE public.guest_purchases
          SET claimed_by_user_id = current_user_id,
              claimed_at = NOW()
          WHERE session_id = session_id_param;

          UPDATE public.payment_transactions
          SET user_id = current_user_id,
              updated_at = NOW()
          WHERE id = existing_transaction_id AND user_id IS NULL;

          RETURN jsonb_build_object(
            'success', true,
            'scenario', 'idempotent_claimed_for_logged_in_user',
            'access_granted', true,
            'is_guest_purchase', false,
            'send_magic_link', false,
            'requires_login', false,
            'customer_email', customer_email_param
          );
        END IF;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.guest_purchases WHERE session_id = session_id_param AND claimed_by_user_id IS NULL) THEN
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param,
        'message', 'Payment already processed (idempotent)'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'already_processed_idempotent',
        'access_granted', true,
        'already_had_access', true,
        'message', 'Payment already processed (idempotent)'
      );
    END IF;
  END IF;

  SELECT id, name, auto_grant_duration_days, price, currency, allow_custom_price, custom_price_min,
         sale_price, sale_price_until, sale_quantity_limit, sale_quantity_sold, price_includes_vat INTO product_record
  FROM public.products
  WHERE id = product_id_param AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  IF product_record.currency IS NOT NULL THEN
    IF upper(currency_param) != upper(product_record.currency) THEN
      RAISE EXCEPTION 'Currency mismatch: expected %, got %',
        product_record.currency, currency_param;
    END IF;
  END IF;

  -- Effective unit price = active sale price (Omnibus) when running, else regular.
  effective_unit_price := CASE
    WHEN public.is_sale_price_active(
           product_record.sale_price,
           product_record.sale_price_until,
           product_record.sale_quantity_limit,
           product_record.sale_quantity_sold)
    THEN product_record.sale_price
    ELSE product_record.price
  END;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many bump products (max 20)');
  END IF;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 0 THEN
    FOR bump_rec IN
      SELECT
        p.id,
        p.name,
        ob.id as order_bump_id,
        COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as auto_grant_duration_days,
        COALESCE(ob.bump_price, p.price) as price,
        p.currency
      FROM unnest(bump_product_ids_param) AS bid(id)
      JOIN public.products p ON p.id = bid.id
      JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
      WHERE p.is_active = true
        AND ob.is_active = true
    LOOP
      total_bump_price := total_bump_price + bump_rec.price;
      bump_count := bump_count + 1;
      bump_ids_found := array_append(bump_ids_found, bump_rec.id);
    END LOOP;
  END IF;

  -- Validation basis: NET (amount_subtotal_param) for net-priced (exclusive) products,
  -- else GROSS (amount_total). Stripe charges net+VAT for exclusive pricing and the gross
  -- varies by jurisdiction/reverse-charge under Stripe Tax, so the invariant to validate is
  -- the NET subtotal; for inclusive (brutto) pricing the GROSS is the invariant. Callers pass
  -- amount_subtotal_param (Stripe session.amount_subtotal); NULL keeps the legacy gross check.
  charge_basis := CASE
    WHEN COALESCE(product_record.price_includes_vat, false) = false
         AND amount_subtotal_param IS NOT NULL
    THEN amount_subtotal_param
    ELSE amount_total
  END;

  IF product_record.price IS NOT NULL THEN
    DECLARE
      expected_total NUMERIC;   -- full price + bumps (upper bound)
      effective_total NUMERIC;  -- effective (sale-aware) price + bumps (lower bound)
    BEGIN
      expected_total := product_record.price + total_bump_price;
      effective_total := effective_unit_price + total_bump_price;

      IF product_record.allow_custom_price = true THEN
        IF charge_basis < ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * 100) THEN
          RAISE EXCEPTION 'Amount below minimum: got % cents, minimum is % cents',
            charge_basis, ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * 100);
        END IF;
      ELSIF coupon_id_param IS NULL THEN
        IF charge_basis < (effective_total * 100) OR charge_basis > (expected_total * 100) THEN
          RAISE EXCEPTION 'Amount mismatch: expected between % and % cents (effective % + bumps %), got % cents',
            (effective_total * 100),
            (expected_total * 100),
            (effective_unit_price * 100),
            (total_bump_price * 100),
            charge_basis;
        END IF;
      ELSE
        IF charge_basis <= 0 THEN
          RAISE EXCEPTION 'Invalid amount with coupon: amount cannot be zero or negative';
        END IF;

        IF charge_basis > (expected_total * 100) THEN
          RAISE EXCEPTION 'Amount too high with coupon: got % cents but max possible is % cents',
            charge_basis, (expected_total * 100);
        END IF;
      END IF;
    END;
  END IF;

  IF product_record.allow_custom_price = true THEN
    main_line_item_price := (charge_basis / 100) - total_bump_price;
    IF main_line_item_price < 0 THEN
      RAISE EXCEPTION 'Invalid PWYW line item amount: amount % cents is lower than bump total %',
        charge_basis, total_bump_price;
    END IF;
  ELSE
    main_line_item_price := effective_unit_price;
  END IF;

  SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param;

  IF product_record.auto_grant_duration_days IS NOT NULL THEN
    access_expires_at := NOW() + (product_record.auto_grant_duration_days || ' days')::INTERVAL;
  END IF;

  BEGIN
    IF current_user_id IS NULL AND existing_user_id IS NOT NULL THEN
      current_user_id := existing_user_id;
    END IF;

    SELECT pt.id INTO pending_transaction_id
    FROM public.payment_transactions pt
    WHERE pt.stripe_payment_intent_id = pi_param
      AND pt.status = 'pending'
    LIMIT 1;

    IF pending_transaction_id IS NOT NULL THEN
      UPDATE public.payment_transactions
      SET
        status = 'completed',
        user_id = current_user_id,
        customer_email = customer_email_param,
        metadata = metadata || jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param,
          'converted_from_pending', true
        ),
        updated_at = NOW()
      WHERE id = pending_transaction_id
      RETURNING id INTO transaction_id_var;
    ELSE
      INSERT INTO public.payment_transactions (
        session_id, user_id, product_id, customer_email, amount, currency,
        stripe_payment_intent_id, status, metadata
      ) VALUES (
        session_id_param, current_user_id, product_id_param, customer_email_param,
        amount_total, upper(currency_param), stripe_payment_intent_id, 'completed',
        jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param
        )
      ) RETURNING id INTO transaction_id_var;
    END IF;

    PERFORM public.increment_sale_quantity_sold(product_id_param);

    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price,
      currency, product_name
    ) VALUES (
      transaction_id_var, product_id_param, 'main_product', 1,
      main_line_item_price, main_line_item_price,
      upper(currency_param), product_record.name
    );

    IF bump_count > 0 THEN
      FOR bump_rec IN
        SELECT
          p.id,
          p.name,
          ob.id as order_bump_id,
          ob.access_duration_days as access_duration_override,
          COALESCE(ob.bump_price, p.price) as price,
          p.currency
        FROM unnest(bump_ids_found) AS bid(id)
        JOIN public.products p ON p.id = bid.id
        JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
        WHERE p.is_active = true AND ob.is_active = true
      LOOP
        INSERT INTO public.payment_line_items (
          transaction_id, product_id, item_type, quantity, unit_price, total_price,
          currency, product_name, order_bump_id, access_duration_override
        ) VALUES (
          transaction_id_var, bump_rec.id, 'order_bump', 1,
          bump_rec.price, bump_rec.price,
          upper(COALESCE(bump_rec.currency, currency_param)), bump_rec.name,
          bump_rec.order_bump_id, bump_rec.access_duration_override
        );
      END LOOP;
    END IF;

    IF coupon_id_param IS NOT NULL THEN
      DELETE FROM public.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      UPDATE public.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND is_active = true
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      INSERT INTO public.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

    IF current_user_id IS NOT NULL THEN
      PERFORM public.grant_product_access_service_role(current_user_id, product_id_param);

      IF bump_count > 0 THEN
        FOR bump_rec IN
          SELECT u.bid AS product_id, ob.access_duration_days AS access_duration_override
          FROM unnest(bump_ids_found) AS u(bid)
          JOIN public.order_bumps ob
            ON ob.bump_product_id = u.bid AND ob.main_product_id = product_id_param
        LOOP
          PERFORM public.grant_product_access_service_role(
            current_user_id,
            bump_rec.product_id,
            override_duration_days_param => bump_rec.access_duration_override
          );
        END LOOP;
      END IF;

      IF user_id_param IS NULL AND existing_user_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'scenario', 'guest_purchase_user_exists_with_bump',
          'access_granted', true,
          'is_guest_purchase', false,
          'send_magic_link', true,
          'requires_login', true,
          'bump_access_granted', bump_count > 0,
          'bump_count', bump_count,
          'customer_email', customer_email_param
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'logged_in_user_with_bump',
        'access_granted', true,
        'bump_access_granted', bump_count > 0,
        'bump_count', bump_count,
        'customer_email', customer_email_param
      );
    ELSE
      INSERT INTO public.guest_purchases (customer_email, product_id, transaction_amount, session_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param);

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_process_stripe_payment_completion_with_bump_impl error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment processing failed. Please try again or contact support.',
      'code', SQLSTATE
    );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

REVOKE EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC
) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC
) TO service_role;


CREATE OR REPLACE FUNCTION public.process_stripe_payment_completion_with_bump(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_ids_param UUID[] DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL,
  amount_subtotal_param NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  resolved_sid TEXT;
  pi_param TEXT := stripe_payment_intent_id;
  result JSONB;
BEGIN
  -- One writer per purchase: serialize on the payment-intent (shared by the
  -- cs_/pi_ events and verification); fall back to session id when absent.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(coalesce(pi_param, session_id_param))
  );

  IF pi_param IS NOT NULL THEN
    SELECT pt.session_id INTO resolved_sid
      FROM public.payment_transactions pt
     WHERE pt.stripe_payment_intent_id = pi_param
       AND pt.status <> 'pending'
       AND pt.session_id <> session_id_param
     LIMIT 1;

    IF resolved_sid IS NOT NULL THEN
      session_id_param := resolved_sid;
    END IF;
  END IF;

  result := public._process_stripe_payment_completion_with_bump_impl(
    session_id_param, product_id_param, customer_email_param, amount_total,
    currency_param, stripe_payment_intent_id, user_id_param,
    bump_product_ids_param, coupon_id_param, amount_subtotal_param
  );

  -- Some idempotent re-entry branches in the impl omit already_had_access
  -- (guest re-entry carries the idempotent message; the claimed-logged-in
  -- branch carries only its scenario). Stamp it so callers consistently skip
  -- duplicate side-effects on a second completion of the same purchase.
  IF (result->>'message') = 'Payment already processed (idempotent)'
     OR (result->>'scenario') = 'idempotent_claimed_for_logged_in_user' THEN
    result := result || jsonb_build_object('already_had_access', true);
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC
) TO service_role;
-- A fresh CREATE grants EXECUTE to PUBLIC by default; lock it back down to service_role
-- only (mirrors the original wrapper grant in 20260610112649, which the recreate replaces).
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC
) FROM anon, authenticated, PUBLIC;
