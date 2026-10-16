/** Match direct SQL helpers to the selected local API instance. */
const configured = process.env.SUPABASE_TEST_CONTAINER;
const api = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!configured && api && new URL(api).port !== '54321') throw new Error('Set SUPABASE_TEST_CONTAINER for the selected database');
export const TEST_DB_CONTAINER = configured || 'supabase_db_sellf';
if (!/^[a-zA-Z0-9_-]+$/.test(TEST_DB_CONTAINER)) throw new Error('Invalid test database container');
