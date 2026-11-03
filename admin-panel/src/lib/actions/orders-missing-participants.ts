'use server';

/**
 * Paid orders whose buyer chose "add participants later" and has not yet done so.
 * @see supabase/migrations/20261103191000_participants_later.sql
 */
import { withAdminClient } from '@/lib/actions/admin-auth';
import type { ActionResponse } from '@/lib/actions/admin-auth';

export interface MissingParticipantsOrder {
  id: string;
  orderNumber: number | null;
  email: string;
  productName: string;
  quantity: number;
  createdAt: string;
  mailSentAt: string | null;
}

interface Row { id: string; order_number: number | null; customer_email: string; product_name: string; quantity: number; created_at: string; mail_sent_at: string | null }

export async function getOrdersMissingParticipants(): Promise<ActionResponse<MissingParticipantsOrder[]>> {
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient.rpc('list_orders_missing_participants', { p_unsent_only: false, p_limit: 100 });
    if (error) {
      console.error('[getOrdersMissingParticipants] Read failed:', error);
      return { success: false, error: 'Unable to load orders' };
    }
    return { success: true, data: ((data ?? []) as Row[]).map(row => ({
      id: row.id, orderNumber: row.order_number, email: row.customer_email, productName: row.product_name,
      quantity: row.quantity, createdAt: row.created_at, mailSentAt: row.mail_sent_at,
    })) };
  });
}
