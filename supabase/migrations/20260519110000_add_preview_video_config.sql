-- preview_video_url + preview_video_config columns on seller_main.products.
-- Backfill of a DDL change that landed on hanna + TSA prod via direct SQL
-- before the file existed in the repo; demo did not get the columns, so
-- the live schemas had drifted. IF NOT EXISTS keeps the apply idempotent
-- for installs that already have the columns.

ALTER TABLE seller_main.products
  ADD COLUMN IF NOT EXISTS preview_video_url TEXT;

ALTER TABLE seller_main.products
  ADD COLUMN IF NOT EXISTS preview_video_config JSONB NOT NULL DEFAULT '{}'::jsonb;
