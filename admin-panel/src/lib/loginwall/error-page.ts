/** Localized navigation errors. @see lib/loginwall/request.ts */
import { NextResponse } from 'next/server';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
export function invalidRedirectPage(pathname: string): NextResponse {
  const locale = pathname.startsWith('/pl/') ? 'pl' : 'en';
  const text = (locale === 'pl' ? pl : en).loginwallError;
  return new NextResponse(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${text.title}</title><body><main><h1>${text.title}</h1><p>${text.description}</p></main></body></html>`, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
