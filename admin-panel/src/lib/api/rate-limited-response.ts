import { NextResponse } from 'next/server';

export const COUPON_RATE_WINDOW_SECONDS = 60 * 60;

export function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'rate_limited', retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}
