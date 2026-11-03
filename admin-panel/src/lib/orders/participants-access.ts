/** Who may add participants to an order: holder of the signed link, or the signed-in buyer who owns it. @see ./participants-token.ts */
import { verifyParticipantsToken } from '@/lib/orders/participants-token';
import { createClient } from '@/lib/supabase/server';

export async function canEditParticipants(orderId: string, token: string | undefined, ownerId: string | null): Promise<boolean> {
  if (verifyParticipantsToken(token, orderId)) return true;
  if (!ownerId) return false;
  const { data: { user } } = await (await createClient()).auth.getUser();
  return !!user && user.id === ownerId;
}
