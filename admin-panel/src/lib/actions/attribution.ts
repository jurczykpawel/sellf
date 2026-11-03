'use server';

/**
 * Admin read of an order's frozen purchase source (payment details "Source" box).
 * @see supabase/migrations/20261103120000_purchase_attribution.sql
 */

import { z } from 'zod';
import { PURCHASE_ATTRIBUTION_COLUMNS, toPurchaseAttributionView } from '@/lib/attribution/report';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { PurchaseAttributionView } from '@/lib/attribution/report';

export async function getPurchaseAttribution(transactionId: string): Promise<ActionResponse<PurchaseAttributionView | null>> {
  if (!z.uuid().safeParse(transactionId).success) return { success: false, error: 'Invalid transaction' };
  return withAdminAuth(async ({ supabase }) => {
    // RLS: purchase_attribution is readable only by admins.
    const { data, error } = await supabase.from('purchase_attribution')
      .select(PURCHASE_ATTRIBUTION_COLUMNS).eq('transaction_id', transactionId).maybeSingle();
    if (error) {
      console.error('[getPurchaseAttribution] Error:', error.message);
      return { success: false, error: 'Failed to load source' };
    }
    return { success: true, data: data ? toPurchaseAttributionView(data as unknown as Parameters<typeof toPurchaseAttributionView>[0]) : null };
  });
}

export interface AttributionRuleInput {
  id?: string;
  priority: number;
  channel: string;
  field: 'source' | 'medium' | 'campaign' | 'referrer_host' | 'click_id_type';
  operator: 'equals' | 'in' | 'contains' | 'host_in' | 'exists';
  value: string | null;
  is_active: boolean;
  is_default?: boolean;
}

export interface AttributionConfig {
  click_id_retention_days: number;
  rules: AttributionRuleInput[];
}

const ruleSchema = z.object({
  id: z.uuid().optional(),
  priority: z.number().int().min(0).max(100000),
  channel: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,40}$/),
  field: z.enum(['source', 'medium', 'campaign', 'referrer_host', 'click_id_type']),
  operator: z.enum(['equals', 'in', 'contains', 'host_in', 'exists']),
  value: z.string().trim().max(2000).nullable(),
  is_active: z.boolean(),
  is_default: z.boolean().optional(),
}).refine(r => r.operator === 'exists' || (r.value !== null && r.value.length > 0), { message: 'Value required' });

const configSchema = z.object({
  click_id_retention_days: z.number().int().min(1).max(365),
  rules: z.array(ruleSchema).max(200),
});

export async function getAttributionConfig(): Promise<ActionResponse<AttributionConfig>> {
  return withAdminAuth(async ({ supabase }) => {
    const [settings, rules] = await Promise.all([
      supabase.from('attribution_settings').select('click_id_retention_days').eq('id', 1).maybeSingle(),
      supabase.from('attribution_channel_rules').select('id, priority, channel, field, operator, value, is_active, is_default')
        .order('priority').order('created_at'),
    ]);
    if (settings.error || rules.error || !settings.data) return { success: false, error: 'Failed to load settings' };
    return { success: true, data: {
      click_id_retention_days: settings.data.click_id_retention_days,
      rules: (rules.data ?? []) as AttributionRuleInput[],
    } };
  });
}

export async function saveAttributionConfig(input: AttributionConfig): Promise<ActionResponse<void>> {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  return withAdminAuth(async ({ supabase }) => {
    const rules = parsed.data.rules.map(r => (r.is_default && r.id ? { id: r.id, is_active: r.is_active } : {
      priority: r.priority, channel: r.channel, field: r.field, operator: r.operator, value: r.operator === 'exists' ? null : r.value, is_active: r.is_active,
    }));
    const { error } = await supabase.rpc('save_attribution_config', {
      p_retention_days: parsed.data.click_id_retention_days, p_rules: rules,
    });
    if (error) {
      console.error('[saveAttributionConfig] Error:', error.message);
      return { success: false, error: 'Failed to save settings' };
    }
    return { success: true };
  }, { mutating: true });
}
