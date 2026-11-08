/** Effective seat limit for the selected event price. @see components/checkout/EventSessions.tsx */
import type { EventSession } from '@/lib/events/presentation';

export function getEventSeatsLeft(session: EventSession | undefined): number | null {
  if (!session) return null;
  const limits = [session.remaining, session.currentTier?.seatsLeft].filter((value): value is number => value != null);
  return limits.length ? Math.min(...limits) : null;
}
