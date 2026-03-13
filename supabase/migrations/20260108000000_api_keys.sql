-- API Keys for external authentication (MCP Server, integrations)
-- Migration: 20260108000000_api_keys

SET client_min_messages = warning;

BEGIN;

-- Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Key identification
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100), -- Descriptive name
  key_prefix TEXT NOT NULL CHECK (length(key_prefix) = 12), -- First 12 chars for display (e.g., "sf_live_abc1")
  key_hash TEXT NOT NULL, -- SHA-256 hash of the full key (never store plaintext)

  -- Ownership
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,

  -- Permissions
  scopes JSONB NOT NULL DEFAULT '["*"]'::jsonb, -- Array of scopes, "*" = full access
  -- Valid scopes: products:read, products:write, users:read, users:write,
  -- coupons:read, coupons:write, analytics:read, webhooks:read, webhooks:write, *

  -- Rate limiting
  rate_limit_per_minute INTEGER DEFAULT 60 CHECK (rate_limit_per_minute > 0 AND rate_limit_per_minute <= 1000),

  -- Lifecycle
  is_active BOOLEAN DEFAULT true NOT NULL,
  expires_at TIMESTAMPTZ, -- Optional expiration date
  last_used_at TIMESTAMPTZ,
  last_used_ip INET, -- Last IP that used this key
  usage_count BIGINT DEFAULT 0 NOT NULL, -- Total requests made with this key

  -- Rotation support
  rotated_from_id UUID REFERENCES api_keys(id) ON DELETE SET NULL, -- Previous key if rotated
  rotation_grace_until TIMESTAMPTZ, -- Old key still works until this time during rotation

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  revoked_at TIMESTAMPTZ, -- When was the key revoked (for audit trail)
  revoked_reason TEXT CHECK (revoked_reason IS NULL OR length(revoked_reason) <= 500),

  -- Constraints
  CONSTRAINT unique_key_hash UNIQUE (key_hash),
  CONSTRAINT unique_key_prefix UNIQUE (key_prefix),
  CONSTRAINT check_revoked_consistency CHECK (
    (is_active = true AND revoked_at IS NULL) OR
    (is_active = false) -- revoked_at can be null for disabled but not revoked keys
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_admin_user_id ON api_keys(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active) WHERE is_active = true;

-- Comments
COMMENT ON TABLE api_keys IS 'API keys for external authentication (MCP Server, integrations, external developers)';
COMMENT ON COLUMN api_keys.key_prefix IS 'First 12 characters of the key for identification (shown in UI)';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the full API key - never store plaintext';
COMMENT ON COLUMN api_keys.scopes IS 'JSON array of permission scopes. Use "*" for full access';
COMMENT ON COLUMN api_keys.rotation_grace_until IS 'During key rotation, old key remains valid until this timestamp';

-- RLS Policies
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Admin users can manage their own keys
CREATE POLICY "Admin users can view their own API keys"
  ON api_keys FOR SELECT
  TO authenticated
  USING (
    admin_user_id IN (
      SELECT id FROM admin_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admin users can insert their own API keys"
  ON api_keys FOR INSERT
  TO authenticated
  WITH CHECK (
    admin_user_id IN (
      SELECT id FROM admin_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admin users can update their own API keys"
  ON api_keys FOR UPDATE
  TO authenticated
  USING (
    admin_user_id IN (
      SELECT id FROM admin_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admin users can delete their own API keys"
  ON api_keys FOR DELETE
  TO authenticated
  USING (
    admin_user_id IN (
      SELECT id FROM admin_users WHERE user_id = auth.uid()
    )
  );

-- Function to verify API key and update usage stats
-- Called by application code, not directly exposed
CREATE OR REPLACE FUNCTION verify_api_key(p_key_hash TEXT)
RETURNS TABLE (
  key_id UUID,
  admin_user_id UUID,
  scopes JSONB,
  rate_limit_per_minute INTEGER,
  is_valid BOOLEAN,
  rejection_reason TEXT
) AS $$
DECLARE
  v_key RECORD;
BEGIN
  -- Find the key
  SELECT * INTO v_key
  FROM public.api_keys ak
  WHERE ak.key_hash = p_key_hash;

  -- Key not found
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::UUID, NULL::UUID, NULL::JSONB, NULL::INTEGER,
      false, 'Invalid API key'::TEXT;
    RETURN;
  END IF;

  -- Key is not active
  IF NOT v_key.is_active THEN
    -- Check if it's in rotation grace period
    IF v_key.rotation_grace_until IS NOT NULL AND v_key.rotation_grace_until > NOW() THEN
      -- Still in grace period, allow
    ELSE
      RETURN QUERY SELECT
        v_key.id, v_key.admin_user_id, v_key.scopes, v_key.rate_limit_per_minute,
        false, 'API key has been revoked'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Key has expired
  IF v_key.expires_at IS NOT NULL AND v_key.expires_at < NOW() THEN
    RETURN QUERY SELECT
      v_key.id, v_key.admin_user_id, v_key.scopes, v_key.rate_limit_per_minute,
      false, 'API key has expired'::TEXT;
    RETURN;
  END IF;

  -- Update usage stats (non-blocking)
  UPDATE public.api_keys
  SET
    last_used_at = NOW(),
    usage_count = usage_count + 1
  WHERE id = v_key.id;

  -- Key is valid
  RETURN QUERY SELECT
    v_key.id, v_key.admin_user_id, v_key.scopes, v_key.rate_limit_per_minute,
    true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Audit log for API key events (optional but recommended)
CREATE TABLE IF NOT EXISTS api_key_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'rotated', 'revoked', 'expired', 'used_after_revoke')),
  event_data JSONB DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_key_audit_log_key_id ON api_key_audit_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_audit_log_created_at ON api_key_audit_log(created_at);

COMMENT ON TABLE api_key_audit_log IS 'Audit trail for API key lifecycle events';

-- Restrict table-level grants: anon has no business accessing API keys or their audit log.
-- authenticated admins access via RLS policies below; service_role for internal writes.
REVOKE ALL ON public.api_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

REVOKE ALL ON public.api_key_audit_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.api_key_audit_log TO authenticated;
GRANT ALL ON public.api_key_audit_log TO service_role;

-- RLS for audit log - admins can view logs for their own keys
ALTER TABLE api_key_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin users can view audit logs for their own keys"
  ON api_key_audit_log FOR SELECT
  TO authenticated
  USING (
    api_key_id IN (
      SELECT ak.id FROM api_keys ak
      JOIN admin_users au ON ak.admin_user_id = au.id
      WHERE au.user_id = auth.uid()
    )
  );

COMMIT;
