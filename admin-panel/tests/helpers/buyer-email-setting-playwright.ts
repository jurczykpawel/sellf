/** Opt in when a spec verifies the optional Supabase transactional templates. */
import { test, expect } from '@playwright/test';
import { supabaseAdmin as db } from './admin-auth';
export function useSupabaseBuyerEmails(): void {
  let previous: boolean, id: string;
  test.beforeAll(async () => {
    const saved = await db.from('shop_config').select('id,supabase_buyer_emails').single();
    expect(saved.error).toBeNull();
    previous = saved.data!.supabase_buyer_emails; id = saved.data!.id;
    expect((await db.from('shop_config').update({ supabase_buyer_emails: true }).eq('id',id)).error).toBeNull();
  });
  test.afterAll(async () => {
    if (id) expect((await db.from('shop_config').update({ supabase_buyer_emails: previous }).eq('id',id)).error).toBeNull();
  });
}
