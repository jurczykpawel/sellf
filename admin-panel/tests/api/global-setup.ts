import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

/**
 * Vitest globalSetup for the API integration suite.
 *
 * `pool: 'forks'` isolates module state per test file by default, so the
 * naive `let testApiKey: string | null = null;` cache in setup.ts becomes
 * 14 separate caches — one per file — each creating its own admin user
 * and key. That's where the flaky 401s came from: 14× the surface area
 * for a transient `supabase.auth.admin.createUser` race per `test:api`
 * invocation, and 14 leaked rows in api_keys / admin_users / auth.users
 * on every cleanup miss.
 *
 * Fix: create the admin + key here, ONCE, before any test file loads.
 * Pass the plaintext to each file via process.env (forked workers
 * inherit it). setup.ts then prefers the inherited value over creating
 * its own.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface SharedKey {
  plaintext: string;
  apiKeyId: string;
  adminUserId: string;
  authUserId: string;
}

let shared: SharedKey | null = null;

async function createSharedKey(): Promise<SharedKey> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Create auth user (retry — auth.admin.createUser races on busy machines)
  let authUserId = '';
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const email = `vitest-shared-${Date.now()}-${attempt}@example.com`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    if (!error && data?.user) {
      authUserId = data.user.id;
      break;
    }
    lastErr = error?.message ?? 'unknown';
    await new Promise((r) => setTimeout(r, 200 * attempt));
  }
  if (!authUserId) throw new Error(`globalSetup: createUser failed: ${lastErr}`);

  // 2. admin_users row
  const { data: adminRow, error: adminErr } = await supabase
    .from('admin_users')
    .insert({ user_id: authUserId })
    .select('id')
    .single();
  if (adminErr) throw new Error(`globalSetup: admin_users insert failed: ${adminErr.message}`);

  // 3. API key
  const plaintext = `sf_test_${randomBytes(32).toString('hex')}`;
  const { data: keyRow, error: keyErr } = await supabase
    .from('api_keys')
    .insert({
      name: `vitest-shared-${Date.now()}`,
      key_prefix: plaintext.substring(0, 12),
      key_hash: createHash('sha256').update(plaintext).digest('hex'),
      admin_user_id: adminRow!.id,
      scopes: ['*'],
      rate_limit_per_minute: 1000,
      is_active: true,
    })
    .select('id')
    .single();
  if (keyErr) throw new Error(`globalSetup: api_keys insert failed: ${keyErr.message}`);

  return { plaintext, apiKeyId: keyRow!.id, adminUserId: adminRow!.id, authUserId };
}

async function destroySharedKey(s: SharedKey) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await supabase.from('api_keys').delete().eq('id', s.apiKeyId);
  await supabase.from('admin_users').delete().eq('id', s.adminUserId);
  // audit_log FK has no cascade — wipe entries first so deleteUser doesn't 500.
  await supabase.from('audit_log').delete().eq('user_id', s.authUserId);
  await supabase.auth.admin.deleteUser(s.authUserId);
}

export default async function () {
  shared = await createSharedKey();
  // Workers inherit process.env from the parent — this is how the key
  // reaches setup.ts in each forked test file.
  process.env.TEST_API_KEY_PLAINTEXT = shared.plaintext;
  process.env.TEST_API_KEY_ID = shared.apiKeyId;
  process.env.TEST_ADMIN_USER_ID = shared.adminUserId;
  process.env.TEST_AUTH_USER_ID = shared.authUserId;

  return async () => {
    if (shared) await destroySharedKey(shared);
  };
}
