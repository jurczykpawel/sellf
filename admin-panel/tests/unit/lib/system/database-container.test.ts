/** @see tests/helpers/database-container.ts */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTestDatabaseContainer } from '../../../helpers/database-container';
afterEach(() => vi.unstubAllEnvs());
describe('local test database target', () => {
  it('requires a matching container configuration for a separate API', () => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', '');
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:55321');
    expect(() => getTestDatabaseContainer()).toThrow('Set SUPABASE_DB_CONTAINER');
  });
  it('selects the configured isolated container', () => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', 'supabase_db_sellf-upgrade-matrix');
    expect(getTestDatabaseContainer()).toBe('supabase_db_sellf-upgrade-matrix');
  });
  it('validates the container name', () => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', 'invalid name');
    expect(() => getTestDatabaseContainer()).toThrow('Invalid');
  });
});
