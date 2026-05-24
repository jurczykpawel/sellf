import { _globalCleanupTestApiKey } from './setup';

/**
 * Vitest globalSetup hook for the API integration suite. Used purely for
 * teardown — we don't pre-create the test API key (each suite still creates
 * it lazily via apiRequest → createTestApiKey), we only ensure it's removed
 * once at the very end of the run instead of after every test file.
 */
export async function setup() {}

export async function teardown() {
  await _globalCleanupTestApiKey();
}
