/** Cursor-based public sitemap chunks. @see app/sitemap.xml/route.ts */
import { createPublicClient } from '@/lib/supabase/server';
import { defaultLocale, locales } from '@/lib/locales';
import { getLocalizedUrl, getProductAlternates } from '@/lib/seo/products';
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';

export const SITEMAP_PAGE_SIZE = 1000;
export const SITEMAP_START = '00000000-0000-0000-0000-000000000000';
export const SITEMAP_HEADERS = { 'Content-Type': 'application/xml; charset=utf-8' };

interface SitemapProduct {
  id: string;
  slug: string;
  updated_at: string;
}

export async function getSitemapProducts(after: string, now = new Date()): Promise<SitemapProduct[]> {
  const { data, error } = await createPublicClient().from('products')
    .select('id,slug,updated_at')
    .eq('is_active', true)
    .eq('is_listed', true)
    .or(`available_from.is.null,available_from.lte.${now.toISOString()}`)
    .or(`available_until.is.null,available_until.gt.${now.toISOString()}`)
    .gt('id', after)
    .order('id', { ascending: true })
    .limit(SITEMAP_PAGE_SIZE);
  if (error) throw new Error('Could not load sitemap products');
  return data ?? [];
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[char]!);
}

export async function renderSitemapIndex(): Promise<string> {
  const entries: string[] = [];
  const now = new Date();
  let after = SITEMAP_START;
  while (true) {
    const products = await getSitemapProducts(after, now);
    if (products.length || after === SITEMAP_START) {
      entries.push(`<sitemap><loc>${escapeXml(getPublicBaseUrl())}/sitemaps/${after}.xml</loc></sitemap>`);
    }
    if (products.length < SITEMAP_PAGE_SIZE) break;
    after = products[products.length - 1].id;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</sitemapindex>`;
}

export function renderSitemap(products: SitemapProduct[], includeStatic: boolean): string {
  const entries: string[] = [];
  if (includeStatic) {
    for (const path of ['/', '/about', '/store']) {
      for (const locale of locales) entries.push(`<url><loc>${escapeXml(getLocalizedUrl(path, locale))}</loc></url>`);
    }
  }
  for (const product of products) {
    const languages = getProductAlternates(product.slug, defaultLocale).languages;
    const alternates = Object.entries(languages).map(([locale, url]) =>
      `<xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(url)}"/>`).join('');
    for (const url of Object.values(languages)) {
      entries.push(`<url><loc>${escapeXml(url)}</loc><lastmod>${escapeXml(product.updated_at)}</lastmod>${alternates}</url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>`;
}
