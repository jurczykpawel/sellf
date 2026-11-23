/** Completes one email-confirmed submission. @see lib/leads/server.ts */
import { NextResponse } from 'next/server';
import { confirmLead } from '@/lib/leads/server';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { createClient } from '@/lib/supabase/server';
export async function GET(request: Request): Promise<NextResponse> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in using the email link' }, { status: 401 });
  const result = await confirmLead(new URL(request.url).searchParams.get('token') ?? '', user, client);
  if (!result.ok) return NextResponse.json({ error: 'Unable to confirm submission. Reload to retry.' }, { status: 400 });
  const prefix = result.locale === 'pl' ? '/pl' : '/en';
  const destination = result.productSlug ? `${prefix}/p/${encodeURIComponent(result.productSlug)}` : `${prefix}/my-products`;
  const response = NextResponse.redirect(new URL(destination, getSellfBaseUrl()));
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
