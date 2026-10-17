/** Bounded public product sitemap. @see lib/seo/sitemap.ts */
import { getSitemapProducts, renderSitemap, SITEMAP_HEADERS, SITEMAP_START } from '@/lib/seo/sitemap';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ cursor: string }> }): Promise<Response> {
  const { cursor } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xml$/.test(cursor)) {
    return new Response(null, { status: 404 });
  }
  const after = cursor.slice(0, -4);
  return new Response(renderSitemap(await getSitemapProducts(after), after === SITEMAP_START), {
    headers: SITEMAP_HEADERS,
  });
}
