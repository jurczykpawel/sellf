/** Local database container selection. @see tests/helpers/supabase-db-container.ts */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseDbContainer } from '../helpers/supabase-db-container';

afterEach(() => vi.unstubAllEnvs());

describe('local database container', () => {
  it('keeps the default project when unset', () => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', undefined);
    expect(getSupabaseDbContainer()).toBe('supabase_db_sellf');
  });

  it('uses the configured project', () => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', 'supabase_db_sellf-maint');
    expect(getSupabaseDbContainer()).toBe('supabase_db_sellf-maint');
  });

  it.each(['', '-other', 'db name', 'db;true', 'db$(true)', 'db\nother'])('rejects an invalid name: %j', value => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', value);
    expect(() => getSupabaseDbContainer()).toThrow('Invalid local database container name');
  });
});
