/** Existing-channel mail contracts explicitly enable the optional Supabase sender. */
import { beforeAll, afterAll, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
export function useSupabaseBuyerEmails(): void {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let previous: boolean;
  let id: string;
  beforeAll(async () => {
    const saved = await db.from('shop_config').select('id,supabase_buyer_emails').single();
    expect(saved.error).toBeNull();
    previous = saved.data!.supabase_buyer_emails; id = saved.data!.id;
    expect((await db.from('shop_config').update({ supabase_buyer_emails: true }).eq('id',id)).error).toBeNull();
  });
  afterAll(async () => {
    if (id) expect((await db.from('shop_config').update({ supabase_buyer_emails: previous }).eq('id',id)).error).toBeNull();
  });
}
