-- =====================================================
-- Per-seller API keys for marketplace
-- =====================================================
-- Adds seller_id to api_keys table so sellers can create
-- their own API keys scoped to their schema.
--
-- NULL seller_id = platform key (seller_main, backward compatible)
-- Non-NULL seller_id = seller key (scoped to seller schema)
--
-- V1 middleware resolves seller schema from API key's seller_id.

-- Allow admin_user_id to be NULL for seller keys (sellers are not in admin_users)
ALTER TABLE public.api_keys ALTER COLUMN admin_user_id DROP NOT NULL;

-- Add seller_id column (nullable for backward compat)
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE;

-- Index for fast lookup by seller
CREATE INDEX IF NOT EXISTS idx_api_keys_seller_id
  ON public.api_keys (seller_id)
  WHERE seller_id IS NOT NULL;

-- Update verify_api_key function to also return seller_id
-- Must DROP first because PostgreSQL cannot change return type of existing function
DROP FUNCTION IF EXISTS public.verify_api_key(TEXT);
CREATE OR REPLACE FUNCTION public.verify_api_key(p_key_hash TEXT)
RETURNS TABLE (
  is_valid BOOLEAN,
  key_id UUID,
  admin_user_id UUID,
  scopes JSONB,
  rate_limit_per_minute INTEGER,
  rejection_reason TEXT,
  seller_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key RECORD;
BEGIN
  IF NOT public.check_rate_limit('verify_api_key', 120, 1) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::integer,
      'Rate limit exceeded'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT ak.id, ak.admin_user_id, ak.scopes, ak.rate_limit_per_minute,
         ak.is_active, ak.expires_at, ak.seller_id, ak.rotation_grace_until
  INTO v_key
  FROM public.api_keys ak
  WHERE ak.key_hash = p_key_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::integer,
      'Invalid API key'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Key disabled: reject UNLESS within rotation grace period
  IF NOT v_key.is_active THEN
    IF v_key.rotation_grace_until IS NOT NULL AND v_key.rotation_grace_until > NOW() THEN
      -- Within grace period — allow (fall through to valid response)
      NULL;
    ELSE
      RETURN QUERY SELECT false, v_key.id, v_key.admin_user_id, v_key.scopes,
        v_key.rate_limit_per_minute, 'API key is disabled'::text, v_key.seller_id;
      RETURN;
    END IF;
  END IF;

  IF v_key.expires_at IS NOT NULL AND v_key.expires_at < NOW() THEN
    RETURN QUERY SELECT false, v_key.id, v_key.admin_user_id, v_key.scopes,
      v_key.rate_limit_per_minute, 'API key has expired'::text, v_key.seller_id;
    RETURN;
  END IF;

  -- Check seller status for seller API keys
  IF v_key.seller_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.sellers WHERE id = v_key.seller_id AND status = 'active') THEN
      RETURN QUERY SELECT false, v_key.id, v_key.admin_user_id, v_key.scopes,
        v_key.rate_limit_per_minute, 'Seller account is inactive'::text, v_key.seller_id;
      RETURN;
    END IF;
  END IF;

  UPDATE public.api_keys SET last_used_at = NOW() WHERE id = v_key.id;

  RETURN QUERY SELECT true, v_key.id, v_key.admin_user_id, v_key.scopes,
    v_key.rate_limit_per_minute, NULL::text, v_key.seller_id;
END;
$$;

-- Ensure every API key has at least one owner and never both
ALTER TABLE public.api_keys ADD CONSTRAINT chk_api_keys_single_owner
  CHECK (admin_user_id IS NOT NULL OR seller_id IS NOT NULL);
ALTER TABLE public.api_keys ADD CONSTRAINT chk_api_keys_no_dual_owner
  CHECK (num_nonnulls(admin_user_id, seller_id) <= 1);

COMMENT ON COLUMN public.api_keys.seller_id IS 'NULL = platform key (seller_main). Non-NULL = seller-specific key scoped to seller schema.';
