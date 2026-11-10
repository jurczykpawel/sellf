/** Real PostgREST projections used by the transaction dialog. */
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ dataClient: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }) }));
import { getPaymentEventDetails, getPaymentLicenseDetails, getPaymentPartnerDetails } from '@/lib/actions/payment-details';
it('loads the seeded order through all real relation projections', async () => {
 const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
 const tx = await db.from('payment_transactions').select('id').limit(1).single();
 expect(tx.error).toBeNull();
 const results = await Promise.all([getPaymentPartnerDetails(tx.data!.id), getPaymentEventDetails(tx.data!.id), getPaymentLicenseDetails(tx.data!.id)]);
 for (const result of results) expect(result.success, JSON.stringify(result)).toBe(true);
});
