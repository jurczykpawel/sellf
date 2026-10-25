/**
 * Direct database key fixture acceptance.
 * @see tests/helpers/api-key.ts
 */
import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { insertTestApiKey } from './helpers/api-key';

test('stores keys sharing the earlier short prefix', async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const owner = await db.from('admin_users').select('id').limit(1).single();
  expect(owner.error).toBeNull();
  const head = randomBytes(2).toString('hex');
  const ids: string[] = [];
  try {
    for (const suffix of ['0000', '1111']) {
      const key = `sf_test_${head}${suffix}${randomBytes(28).toString('hex')}`;
      const result = await insertTestApiKey(db, key, { name: 'Fixture prefix acceptance', admin_user_id: owner.data!.id });
      ids.push(result.data.id);
      expect(result.data.key_prefix).toBe(key.slice(0, 16));
    }
  } finally {
    const { error } = await db.from('api_keys').delete().in('id', ids);
    expect(error).toBeNull();
  }
});
