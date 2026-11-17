/** Disposable affiliate setup stays independent of CLI telemetry. */
import { afterEach, expect, it, vi } from 'vitest';
import { getAffiliateTestConfig, resetAffiliateDatabase } from '../../../affiliates/database';

const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.exec }));
vi.mock('node:fs', () => ({ readFileSync: () => 'project_id = "sellf-fixture"\n[api]\nport = 58121\n' }));
vi.mock('../../../helpers/database-container', () => ({ getTestDatabaseContainer: () => 'supabase_db_sellf-fixture' }));
vi.mock('dotenv', () => ({ config: vi.fn() }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it('bounds status lookup and disables CLI telemetry for status and reset without changing the parent environment', () => {
  vi.stubEnv('AFFILIATE_TEST_ENV', '/fixture/affiliates.env');
  vi.stubEnv('SUPABASE_TEST_WORKDIR', '/fixture');
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:58121');
  vi.stubEnv('SUPABASE_TELEMETRY_DISABLED', '0');
  vi.stubEnv('SUPABASE_CLI_BINARY_OVERRIDE', '/fixture/supabase');
  mocks.exec.mockReturnValue(JSON.stringify({ API_URL: 'http://127.0.0.1:58121' }));

  expect(getAffiliateTestConfig().API_URL).toBe('http://127.0.0.1:58121');
  resetAffiliateDatabase();

  expect(mocks.exec.mock.calls[0][2]).toMatchObject({ timeout: 30000, env: { SUPABASE_TELEMETRY_DISABLED: '1' } });
  expect(mocks.exec.mock.calls[1][2]).toMatchObject({ timeout: 180000, env: { SUPABASE_TELEMETRY_DISABLED: '1' } });
  expect(process.env.SUPABASE_TELEMETRY_DISABLED).toBe('0');
});
