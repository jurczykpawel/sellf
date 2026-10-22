/** Local database target for SQL-based tests. @see supabase/config.toml */
export function getSupabaseDbContainer(): string {
  const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_sellf';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) {
    throw new Error('Invalid local database container name');
  }
  return container;
}
