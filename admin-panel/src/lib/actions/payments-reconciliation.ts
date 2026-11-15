'use server';

/**
 * Paid Stripe payments that could not be fulfilled because their product was deleted.
 * @see src/lib/stripe/payment-reconciliation.ts
 */
import { withAdminClient } from '@/lib/actions/admin-auth';
import { listPaymentsNeedingReconciliation } from '@/lib/stripe/payment-reconciliation';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { PaymentToReconcile } from '@/lib/stripe/payment-reconciliation';

export async function getPaymentsNeedingReconciliation(): Promise<ActionResponse<PaymentToReconcile[]>> {
  return withAdminClient(async ({ dataClient }) => {
    try {
      return { success: true, data: await listPaymentsNeedingReconciliation(dataClient as never) };
    } catch (error) {
      console.error('[getPaymentsNeedingReconciliation] Read failed:', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, error: 'Unable to load payments' };
    }
  });
}
