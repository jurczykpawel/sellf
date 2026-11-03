'use server';
/** Public presentation contains availability only. @see bank-transfer-config.ts */
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
export interface TransferAvailability { enabled: boolean; dueDays: number; reservationHours: number | null }
export async function getTransferAvailability(): Promise<TransferAvailability> {
  if (!await checkRateLimit('transfer_availability', 120, 1)) return { enabled: false, dueDays: 14, reservationHours: null };
  const { data } = await createAdminClient().from('bank_transfer_config').select('bank_transfer_enabled,bank_transfer_due_days,reservation_enabled,reservation_release_hours').single();
  return { enabled: data?.bank_transfer_enabled === true, dueDays: data?.bank_transfer_due_days ?? 14,
    reservationHours: data?.reservation_enabled ? data.reservation_release_hours : null };
}
