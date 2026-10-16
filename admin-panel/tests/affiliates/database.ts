/** Explicit disposable database target for integrated affiliate acceptance. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { getTestDatabaseContainer } from '../helpers/database-container';

export function getAffiliateTestWorkdir(): string {
  if (!process.env.AFFILIATE_TEST_ENV) throw new Error('AFFILIATE_TEST_ENV is required');
  config({ path: process.env.AFFILIATE_TEST_ENV, override: true, quiet: true });
  const workdir = process.env.SUPABASE_TEST_WORKDIR;
  if (!workdir) throw new Error('SUPABASE_TEST_WORKDIR is required');
  const toml = readFileSync(join(workdir, 'supabase/config.toml'), 'utf8');
  const project = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(toml)?.[1];
  const port = /\[api\][\s\S]*?^port\s*=\s*(\d+)/m.exec(toml)?.[1];
  const url = new URL(process.env.SUPABASE_URL!);
  if (!project || project === 'sellf' || url.port !== port || getTestDatabaseContainer() !== `supabase_db_${project}`) {
    throw new Error('Expected a matching disposable affiliate stack');
  }
  return workdir;
}

export function getAffiliateTestConfig(): { API_URL: string; SERVICE_ROLE_KEY: string; ANON_KEY: string } {
  const workdir = getAffiliateTestWorkdir();
  const result = JSON.parse(execFileSync(process.env.SUPABASE_CLI_BINARY_OVERRIDE || 'supabase', ['status', '--workdir', workdir, '-o', 'json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (result.API_URL !== process.env.SUPABASE_URL) throw new Error('Affiliate API configuration does not match');
  return result;
}

export function resetAffiliateDatabase(): void {
  const workdir = getAffiliateTestWorkdir();
  execFileSync(process.env.SUPABASE_CLI_BINARY_OVERRIDE || 'supabase', ['db', 'reset', '--workdir', workdir], { stdio: 'pipe', timeout: 120000 });
}
