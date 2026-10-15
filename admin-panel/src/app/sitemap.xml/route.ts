/** Sitemap index for this installation. @see lib/seo/sitemap.ts */
import { renderSitemapIndex, SITEMAP_HEADERS } from '@/lib/seo/sitemap';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return new Response(await renderSitemapIndex(), { headers: SITEMAP_HEADERS });
}
