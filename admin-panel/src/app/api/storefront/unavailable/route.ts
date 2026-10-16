/** Terminal failure response for public SSR (Server Components cannot set HTTP status). @see PublicStorefrontPage.tsx */
import { NextResponse } from 'next/server';
import { catalogueLabels } from '@/lib/storefront-templates/catalogue-section';
import type { NextRequest } from 'next/server';

export function GET(request: NextRequest): NextResponse {
  const locale = request.nextUrl.searchParams.get('locale') === 'pl' ? 'pl' : 'en';
  const labels = catalogueLabels[locale];
  return new NextResponse(`<!doctype html><html lang="${locale}"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width"><title>Sellf</title><main><h1>${labels.error}</h1><a href="${locale === 'pl' ? '/pl/store' : '/store'}">${labels.retry}</a></main></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' },
  });
}
