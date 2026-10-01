/**
 * Legal document Supabase Storage helper
 *
 * Archives the current document before overwriting, then uploads the new one
 * to the `legal` bucket and returns the internal Sellf page path that renders
 * it — never the storage object's own URL.
 *
 * The bucket is PRIVATE (see the migration that flips `storage.buckets.public`
 * to false). Nothing links to a storage URL directly: Supabase Storage serves
 * `text/html` objects as `text/plain` (buyers would see raw markup), and on
 * self-hosted installs the stored `SUPABASE_URL` is often an internal address
 * (e.g. Coolify's `http://kong:8000/...`) unreachable from the buyer's
 * browser. `/legal/[type]` reads the same object with the service-role client
 * and renders it through a sanitizing pipeline instead.
 * If this repo manages buckets via migration/seed, create the bucket there.
 * Otherwise, bucket creation is a required manual setup step (Supabase Dashboard
 * → Storage → New Bucket → Name: "legal" → Public: false).
 *
 * Path layout:
 *   {shopId}/terms.html         ← current document
 *   {shopId}/terms/archive/{ts}.html  ← archived previous version
 *
 * @see /app/api/legal/generate/route.ts — caller
 * @see /app/[locale]/legal/[type]/page.tsx — reads the same object and renders it
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const BUCKET = 'legal';

export async function publishSnapshot(
  supabase: SupabaseClient,
  shopId: string,
  docType: 'terms' | 'privacy',
  html: string,
): Promise<string> {
  const currentPath = `${shopId}/${docType}.html`;

  // 1) Archive the current version if it exists
  const { data: existing } = await supabase.storage.from(BUCKET).download(currentPath);
  if (existing) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const { error: archiveErr } = await supabase.storage
      .from(BUCKET)
      .upload(`${shopId}/${docType}/archive/${ts}.html`, existing, { contentType: 'text/html' });
    if (archiveErr) {
      console.warn('[publishSnapshot] archive failed:', archiveErr);
    }
  }

  // 2) Overwrite the current document
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(currentPath, new Blob([html], { type: 'text/html' }), {
      contentType: 'text/html',
      upsert: true,
    });

  if (error) throw error;

  // 3) Return the internal page path — never the storage object's own URL.
  return `/legal/${docType}`;
}
