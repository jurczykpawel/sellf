/**
 * Legal document Supabase Storage helper
 *
 * Archives the current document before overwriting, then uploads the new one
 * to the public `legal` bucket and returns the public URL.
 *
 * Bucket: `legal` (public) — must be created as a public bucket.
 * If this repo manages buckets via migration/seed, create the bucket there.
 * Otherwise, bucket creation is a required manual setup step (Supabase Dashboard
 * → Storage → New Bucket → Name: "legal" → Public: true).
 *
 * Path layout:
 *   {shopId}/terms.html         ← current document
 *   {shopId}/terms/archive/{ts}.html  ← archived previous version
 *
 * @see /app/api/legal/generate/route.ts — caller
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'legal';

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
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    await supabase.storage
      .from(BUCKET)
      .upload(`${shopId}/${docType}/archive/${ts}.html`, existing, { contentType: 'text/html' });
  }

  // 2) Overwrite the current document
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(currentPath, new Blob([html], { type: 'text/html' }), {
      contentType: 'text/html',
      upsert: true,
    });

  if (error) throw error;

  // 3) Return the public URL
  return supabase.storage.from(BUCKET).getPublicUrl(currentPath).data.publicUrl;
}
