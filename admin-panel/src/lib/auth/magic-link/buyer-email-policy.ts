import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** Null means the policy could not be read; transactional notifications must remain pending. */
export async function readBuyerEmailPolicy(client = createAdminClient()): Promise<boolean | null> {
  try {
    const { data, error } = await client.from('shop_config').select('supabase_buyer_emails').maybeSingle();
    return error ? null : data?.supabase_buyer_emails === true;
  } catch {
    return null;
  }
}
