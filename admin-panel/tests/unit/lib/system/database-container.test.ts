/** @see tests/helpers/database-container.ts */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDatabaseContainer } from '../../../helpers/database-container';
const mocks = vi.hoisted(() => ({ docker: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.docker }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
beforeEach(() => {
  vi.stubEnv('SUPABASE_DB_CONTAINER', '');
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:55581');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55581');
  mocks.docker.mockReturnValue('supabase_kong_sellf-rc\n');
});
describe('local test database target', () => {
  it('derives the default container from the configured API port', () => {
    expect(getTestDatabaseContainer()).toBe('supabase_db_sellf-rc');
    expect(mocks.docker).toHaveBeenCalledWith('docker', ['ps', '--filter', 'publish=55581', '--format', '{{.Names}}'], expect.any(Object));
  });
  it('accepts an explicit container only when it matches the selected API', () => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', 'supabase_db_sellf-rc');
    expect(getTestDatabaseContainer()).toBe('supabase_db_sellf-rc');
    vi.stubEnv('SUPABASE_DB_CONTAINER', 'supabase_db_sellf');
    expect(() => getTestDatabaseContainer()).toThrow('does not match');
  });
  it('does not fall back when the selected port has no unique local API container', () => {
    mocks.docker.mockReturnValue('');
    expect(() => getTestDatabaseContainer()).toThrow('one local API container');
    mocks.docker.mockReturnValue('supabase_kong_sellf\nsupabase_kong_sellf-rc\n');
    expect(() => getTestDatabaseContainer()).toThrow('one local API container');
  });
  it('validates the container and both API configurations before querying Docker', () => {
    vi.stubEnv('SUPABASE_DB_CONTAINER', 'invalid name');
    expect(() => getTestDatabaseContainer()).toThrow('Invalid');
    vi.stubEnv('SUPABASE_DB_CONTAINER', '');
    vi.stubEnv('SUPABASE_URL', 'https://example.com');
    expect(() => getTestDatabaseContainer()).toThrow('local');
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:55581');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    expect(() => getTestDatabaseContainer()).toThrow('same local API');
    expect(mocks.docker).not.toHaveBeenCalled();
  });
});
