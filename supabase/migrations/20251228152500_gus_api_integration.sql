-- GUS API Integration Migration
-- 1. Adds metadata column to guest_purchases for storing company data from GUS
-- 2. Adds GUS API key columns to integrations_config table

-- Suppress NOTICE messages during migration (e.g., "column already exists, skipping")
SET client_min_messages = warning;

-- Step 1: Add metadata column to guest_purchases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'seller_main'
      AND table_name = 'guest_purchases'
      AND column_name = 'metadata'
  ) THEN
    ALTER TABLE seller_main.guest_purchases
      ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb NOT NULL;

    -- Refresh proxy view to include new column
    CREATE OR REPLACE VIEW public.guest_purchases WITH (security_invoker = on) AS SELECT * FROM seller_main.guest_purchases;

    COMMENT ON COLUMN seller_main.guest_purchases.metadata IS
      'Additional purchase metadata (e.g., NIP, company details from GUS, invoice information)';

    -- Create GIN index for efficient JSONB queries
    CREATE INDEX IF NOT EXISTS idx_guest_purchases_metadata
      ON seller_main.guest_purchases USING GIN (metadata);
  END IF;
END $$;

-- Step 2: Add GUS API key columns to integrations_config
ALTER TABLE seller_main.integrations_config
  ADD COLUMN IF NOT EXISTS gus_api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS gus_api_key_iv TEXT,
  ADD COLUMN IF NOT EXISTS gus_api_key_tag TEXT,
  ADD COLUMN IF NOT EXISTS gus_api_enabled BOOLEAN DEFAULT false NOT NULL;

-- Refresh proxy view to include new columns
CREATE OR REPLACE VIEW public.integrations_config WITH (security_invoker = on) AS SELECT * FROM seller_main.integrations_config;

-- Step 3: Add comments for documentation
COMMENT ON COLUMN seller_main.integrations_config.gus_api_key_encrypted IS 'AES-256-GCM encrypted GUS REGON API key (base64 encoded)';
COMMENT ON COLUMN seller_main.integrations_config.gus_api_key_iv IS 'Initialization vector for GUS API key decryption (base64 encoded)';
COMMENT ON COLUMN seller_main.integrations_config.gus_api_key_tag IS 'Authentication tag for GUS API key decryption (base64 encoded)';
COMMENT ON COLUMN seller_main.integrations_config.gus_api_enabled IS 'Whether GUS API integration is enabled for automatic company data fetching';

-- Step 4: Create index for faster queries on gus_api_enabled
CREATE INDEX IF NOT EXISTS idx_integrations_config_gus_enabled
  ON seller_main.integrations_config (gus_api_enabled)
  WHERE gus_api_enabled = true;
