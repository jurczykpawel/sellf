'use server';
/** Public presentation contains availability only. @see bank-transfer-config.ts */
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
export async function getTransferAvailability(): Promise<{ enabled: boolean; dueDays: number }> {
  if (!await checkRateLimit('transfer_availability', 120, 1)) return { enabled: false, dueDays: 14 };
  const { data } = await createAdminClient().from('bank_transfer_config').select('bank_transfer_enabled,bank_transfer_due_days').single();
  return { enabled: data?.bank_transfer_enabled === true, dueDays: data?.bank_transfer_due_days ?? 14 };
}
