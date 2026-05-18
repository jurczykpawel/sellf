import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { anonymizeSupporterName } from './anonymize-supporter';
import { getSupporterActionKey } from './supporter-copy';

const LIMIT = 10;

export interface SupporterEntry {
  displayName: string;
  amount: number;
  currency: string;
  when: string;
  actionKey: string;
  isRecurring: boolean;
}

export interface RecentSupporters {
  supporters: SupporterEntry[];
  totalCount: number;
}

// Shared loader used by:
//   - GET /api/public/products/[slug]/recent-supporters (public JSON endpoint)
//   - <TipJarSidebar /> (RSC inline render — same cache, single source)
//
// Cache key includes the slug so distinct products have isolated entries.
// Tag `product:<slug>` is revalidated by the Stripe webhook in Phase 3c, so
// successful purchases bust the list straight away instead of waiting the
// 5-minute revalidate window.
export function getRecentSupporters(slug: string) {
  return unstable_cache(
    async (): Promise<RecentSupporters | null> => {
      const supabase = createAdminClient();
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, icon')
        .eq('slug', slug)
        .single();
      if (productError || !product) return null;

      const [{ data: txRows }, { count: completedCount }] = await Promise.all([
        supabase
          .from('payment_transactions')
          .select('id, metadata, amount, currency, created_at')
          .eq('product_id', product.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(LIMIT),
        supabase
          .from('payment_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('product_id', product.id)
          .eq('status', 'completed'),
      ]);

      const supporters: SupporterEntry[] = (txRows ?? []).map((row) => {
        const meta = (row.metadata as Record<string, unknown> | null) ?? {};
        const rawName =
          typeof meta.full_name === 'string' && meta.full_name
            ? (meta.full_name as string)
            : typeof meta.first_name === 'string'
              ? (meta.first_name as string)
              : null;
        return {
          displayName: anonymizeSupporterName(rawName, row.id as string),
          amount: typeof row.amount === 'number' ? row.amount : 0,
          currency: (row.currency as string) ?? 'USD',
          when: (row.created_at as string) ?? new Date(0).toISOString(),
          actionKey: getSupporterActionKey((product.icon as string) ?? null),
          isRecurring: false,
        };
      });

      return { supporters, totalCount: completedCount ?? 0 };
    },
    ['recent-supporters', slug],
    { revalidate: 300, tags: ['recent-supporters', `product:${slug}`] },
  )();
}
