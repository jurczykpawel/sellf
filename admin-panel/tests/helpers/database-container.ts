/** Raw SQL tests must use the same local stack as the REST clients. */
export function getTestDatabaseContainer(): string {
  const configured = process.env.SUPABASE_DB_CONTAINER;
  if (configured) {
    if (!/^supabase_db_[a-zA-Z0-9_-]+$/.test(configured)) throw new Error('Invalid test database container');
    return configured;
  }
  const url = new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '54321') {
    throw new Error('Set SUPABASE_DB_CONTAINER for a separate local test stack');
  }
  return 'supabase_db_sellf';
}
