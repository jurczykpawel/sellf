-- Create the `legal` Supabase Storage bucket used to store generated legal docs
-- (Terms of Service, Privacy Policy HTML files).
--
-- The bucket is PUBLIC so the generated document URLs are directly accessible
-- by buyers. No auth is required to download the rendered HTML.
--
-- Path layout (enforced by /lib/legal/storage.ts):
--   {shopId}/terms.html          ← current Terms of Service
--   {shopId}/privacy.html        ← current Privacy Policy
--   {shopId}/terms/archive/...   ← archived previous versions
--   {shopId}/privacy/archive/... ← archived previous versions
--
-- Storage RLS: allow service_role (admin client) to upload/delete;
-- allow anyone (anon / authenticated) to download from the public bucket.
-- This mirrors how Supabase public buckets work — public access is the bucket-level
-- setting, but we add explicit policies so behaviour survives schema resets.

-- Create bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'legal',
  'legal',
  true,           -- public: files are accessible without auth token
  5242880,        -- 5 MB limit per file (HTML docs are tiny)
  ARRAY['text/html', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage.objects in the legal bucket
-- (Supabase auto-enables RLS on storage.objects)

-- Allow authenticated admins (via service_role client) to upload/overwrite objects
CREATE POLICY "legal_bucket_service_role_all"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'legal')
  WITH CHECK (bucket_id = 'legal');

-- Allow public read access (required even for public buckets when RLS is enabled)
CREATE POLICY "legal_bucket_public_read"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'legal');
