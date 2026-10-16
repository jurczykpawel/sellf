/** Explicit disposable database target for integrated affiliate acceptance. */
import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
export function resetAffiliateDatabase(): void {
  if (!process.env.AFFILIATE_TEST_ENV) throw new Error('AFFILIATE_TEST_ENV is required');
  config({ path: process.env.AFFILIATE_TEST_ENV, override: true, quiet: true });
  if (process.env.SUPABASE_URL !== 'http://127.0.0.1:55571') throw new Error('Expected the disposable affiliate stack');
  execFileSync('supabase', ['db', 'reset', '--workdir', '/private/tmp/sellf-affembed'], { stdio: 'pipe', timeout: 120000 });
}
