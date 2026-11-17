/**
 * The 503 answer of maintenance mode: a self-contained page for visitors (PL/EN, no scripts, no
 * database) and JSON for API calls. Both carry Retry-After (seconds until the expected end, else 5 min).
 * The page text lives here, not in messages/*.json, because the proxy renders it without next-intl.
 *
 * @see src/proxy.ts
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { MaintenanceSurface } from '@/lib/maintenance/surfaces';
import type { MaintenanceState } from '@/lib/maintenance/state';

type PageLocale = 'en' | 'pl';

const DEFAULT_RETRY_SECONDS = 300;
const MIN_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 86_400;

const TEXT: Record<PageLocale, { title: string; lead: string; expected: string; api: string; timeZone: string }> = {
  en: {
    title: 'Down for maintenance',
    lead: 'The shop is down for maintenance. We’ll be back soon.',
    expected: 'Expected back',
    api: 'The shop is down for maintenance. Please try again later.',
    timeZone: 'UTC',
  },
  pl: {
    title: 'Przerwa techniczna',
    lead: 'Sklep ma przerwę techniczną. Wracamy wkrótce.',
    expected: 'Przewidywany powrót',
    api: 'Sklep ma przerwę techniczną. Spróbuj ponownie później.',
    timeZone: 'Europe/Warsaw',
  },
};

export function maintenanceLocale(request: NextRequest): PageLocale {
  const prefix = request.nextUrl.pathname.match(/^\/(en|pl)(?=\/|$)/)?.[1];
  if (prefix === 'en' || prefix === 'pl') return prefix;
  const cookie = request.cookies.get('NEXT_LOCALE')?.value;
  if (cookie === 'en' || cookie === 'pl') return cookie;
  return /^\s*pl\b/i.test(request.headers.get('accept-language') ?? '') ? 'pl' : 'en';
}

export function retryAfterSeconds(expectedEndAt: string | null, now = Date.now()): number {
  const end = expectedEndAt ? Date.parse(expectedEndAt) : NaN;
  if (!Number.isFinite(end) || end <= now) return DEFAULT_RETRY_SECONDS;
  return Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, Math.ceil((end - now) / 1000)));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function formatExpected(expectedEndAt: string, locale: PageLocale): string {
  return new Intl.DateTimeFormat(locale === 'pl' ? 'pl-PL' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TEXT[locale].timeZone, timeZoneName: 'short',
  }).format(new Date(expectedEndAt));
}

function renderPage(locale: PageLocale, state: MaintenanceState): string {
  const text = TEXT[locale];
  const expected = state.expectedEndAt && Date.parse(state.expectedEndAt) > Date.now()
    ? `<p class="when">${text.expected}: <time datetime="${escapeHtml(state.expectedEndAt)}">${escapeHtml(formatExpected(state.expectedEndAt, locale))}</time></p>`
    : '';
  const message = state.message ? `<p class="note">${escapeHtml(state.message)}</p>` : '';
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${text.title}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#1d1d1b;--muted:#5c5c57;--line:#d9d9d4}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#f0f0ec;--muted:#a8a8a2;--line:#33332f}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:34rem;border-top:3px solid var(--fg);padding-top:24px}
h1{margin:0 0 12px;font-size:clamp(28px,6vw,40px);line-height:1.1;letter-spacing:-.02em}
p{margin:0 0 12px}
.note{border-left:3px solid var(--line);padding-left:12px;white-space:pre-line}
.when{color:var(--muted)}
</style>
</head>
<body>
<main>
<h1>${text.title}</h1>
<p>${text.lead}</p>
${message}
${expected}
</main>
</body>
</html>`;
}

export function buildMaintenanceResponse(request: NextRequest, surface: MaintenanceSurface, state: MaintenanceState): NextResponse {
  const locale = maintenanceLocale(request);
  const headers = {
    'Retry-After': String(retryAfterSeconds(state.expectedEndAt)),
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  };
  if (surface === 'api') {
    // Public content only, so any calling origin may read it (embed checkout runs on seller pages);
    // without this the browser hides the 503 and the embed shows "could not connect".
    const origin = request.headers.get('origin');
    const cors: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    return NextResponse.json({
      error: TEXT[locale].api,
      code: 'MAINTENANCE',
      maintenance: { message: state.message, expected_end_at: state.expectedEndAt },
    }, { status: 503, headers: { ...headers, ...cors } });
  }
  return new NextResponse(renderPage(locale, state), {
    status: 503,
    headers: {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    },
  });
}
