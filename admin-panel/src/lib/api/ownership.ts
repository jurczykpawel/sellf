import { NextResponse } from 'next/server';

/**
 * Verify the caller owns the Stripe object referenced in the request.
 *
 * Accepts the object's metadata (typed loosely because Stripe types are
 * `Stripe.Metadata` = `{ [k: string]: string }`) and the authenticated user id
 * (or null for guest paths).
 *
 * Returns null when ownership matches; returns a 403 Response otherwise.
 *
 * Guest invariant: if the Stripe object was created without `user_id` and the
 * caller has no session, the request is allowed (legitimate guest checkout
 * mutation). Once either side has an id, the two must match.
 */
export function assertStripeObjectOwnership(
  objectMetadata: Record<string, unknown> | null | undefined,
  callerUserId: string | null,
): Response | null {
  const objectUserId =
    typeof objectMetadata?.user_id === 'string' && objectMetadata.user_id.length > 0
      ? objectMetadata.user_id
      : null;

  if (objectUserId === null && callerUserId === null) return null;
  if (objectUserId !== null && callerUserId !== null && objectUserId === callerUserId) return null;

  return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
}
