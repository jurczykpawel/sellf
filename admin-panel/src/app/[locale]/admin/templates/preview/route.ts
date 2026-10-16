/** Standalone authenticated snapshot without the session application shell. @see preview.ts */
import { NextResponse } from 'next/server';
import { verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import { PREVIEW_HEADERS, previewStorefront } from '@/lib/storefront-templates/preview';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const revision = params.get('revision');
  const response = await previewStorefront(await verifyTemplateSession(request), {
    revision: revision !== null && /^(0|[1-9][0-9]*)$/.test(revision) ? Number(revision) : -1,
    locale: params.get('locale'), fixture: params.get('fixture'),
  });
  if (!response.success) {
    const locale = params.get('locale') === 'pl' ? 'pl' : 'en';
    const labels = (locale === 'pl' ? pl : en).templatePreview;
    return new NextResponse(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${labels.previewUnavailable}</title></head><body><main style="max-width:40rem;margin:10vh auto;padding:24px;font:16px/1.6 system-ui"><h1>${labels.previewUnavailable}</h1><p>${labels.previewRetry}</p><details><summary>${labels.technical}</summary><p>${response.code}</p></details></main></body></html>`, { status: response.status, headers: { ...PREVIEW_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" } });
  }
  const { html, css } = response.data;
  const images = [...new Set(response.data.assets.filter(a => a.kind === 'image').map(a => a.url.startsWith('data:image/svg+xml,') ? 'data:' : a.url.startsWith('/') ? "'self'" : new URL(a.url).origin))];
  return new NextResponse(html.replace('</head>', `<style>${css}</style></head>`), { headers: {
    ...PREVIEW_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Preview-Expires-At': response.data.expiresAt,
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src ${images.join(' ') || "'none'"}; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    Refresh: `${Math.max(0, Math.floor((Date.parse(response.data.expiresAt) - Date.now()) / 1000))};url=${request.nextUrl.pathname}?revision=-1&locale=${response.data.locale}&fixture=standard`,
  } });
}
