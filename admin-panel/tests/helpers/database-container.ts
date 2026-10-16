/** Raw SQL tests must use the same local stack as the REST clients. */
import { execFileSync } from 'node:child_process';

export function getTestDatabaseContainer(): string {
  const configured = process.env.SUPABASE_DB_CONTAINER;
  if (configured && !/^supabase_db_[a-zA-Z0-9_-]+$/.test(configured)) {
    throw new Error('Invalid test database container');
  }
  const urls = [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL].filter(Boolean)
    .map(value => new URL(value!));
  if (!urls.length) urls.push(new URL('http://127.0.0.1:54321'));
  if (urls.some(url => url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('Direct SQL tests require a local API');
  }
  if (urls.some(url => url.port !== urls[0].port)) throw new Error('Tests must use the same local API');
  const containers = execFileSync('docker', ['ps', '--filter', `publish=${urls[0].port || '80'}`, '--format', '{{.Names}}'], {
    encoding: 'utf8', timeout: 10000,
  }).trim().split('\n').filter(name => /^supabase_kong_[a-zA-Z0-9_-]+$/.test(name));
  if (containers.length !== 1) throw new Error('Expected one local API container for the configured port');
  const expected = containers[0].replace('supabase_kong_', 'supabase_db_');
  if (configured && configured !== expected) throw new Error('Test database container does not match the configured API');
  return expected;
}
