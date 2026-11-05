import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** Null means the policy could not be read; callers must leave delivery pending. */
export async function readBuyerEmailPolicy(client = createAdminClient()): Promise<boolean | null> {
  const { data, error } = await client.from('shop_config').select('supabase_buyer_emails').maybeSingle();
  return error ? null : data?.supabase_buyer_emails === true;
}
