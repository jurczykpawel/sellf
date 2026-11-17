/**
 * Effective maintenance mode = server source (file / env, read first, no database) OR the database
 * switch (panel / API v1). The file wins: when it is present the database is not asked at all.
 *
 * The database switch is read through the public get_maintenance_mode RPC with the anon key and
 * cached for a few seconds. The cache lives on globalThis, shared by the proxy and route bundles of
 * one Node process, so a switch from the panel or API takes effect at once (invalidateMaintenanceCache);
 * other processes follow within the cache window. An unreachable database never switches the mode on.
 *
 * @see src/lib/maintenance/file.ts
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 */
import { cleanMaintenanceMessage, cleanTimestamp, readServerMaintenance } from '@/lib/maintenance/file';
import { getRuntimeSupabaseAnonKey, getRuntimeSupabaseUrl } from '@/lib/config/runtime-env';
import type { ServerMaintenance } from '@/lib/maintenance/file';

export type MaintenanceSource = 'file' | 'env' | 'database';

export interface MaintenanceState {
  source: MaintenanceSource;
  message: string | null;
  expectedEndAt: string | null;
  /** Server source details (file path, reason); null for the database switch. */
  server: ServerMaintenance | null;
}

export interface DatabaseMaintenance {
  enabled: boolean;
  message: string | null;
  expectedEndAt: string | null;
}

const CACHE_TTL_MS = 5_000;
const FETCH_TIMEOUT_MS = 2_000;
const CACHE_KEY = Symbol.for('sellf.maintenance.database');

interface CacheEntry { value: DatabaseMaintenance; expiresAt: number }
type CacheHolder = { [CACHE_KEY]?: CacheEntry };

const OFF: DatabaseMaintenance = { enabled: false, message: null, expectedEndAt: null };

function cache(): CacheHolder {
  return globalThis as unknown as CacheHolder;
}

/** Forget the cached database switch (after a change in this process). */
export function invalidateMaintenanceCache(): void {
  delete cache()[CACHE_KEY];
}

export function parseDatabaseMaintenance(data: unknown): DatabaseMaintenance {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row || row.enabled !== true) return OFF;
  return { enabled: true, message: cleanMaintenanceMessage(row.message), expectedEndAt: cleanTimestamp(row.expected_end_at) };
}

async function fetchDatabaseMaintenance(previous: DatabaseMaintenance): Promise<DatabaseMaintenance> {
  const supabaseUrl = getRuntimeSupabaseUrl();
  const anonKey = getRuntimeSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) return OFF;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_maintenance_mode`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseDatabaseMaintenance(await response.json());
  } catch (error) {
    // Keep the last known value; a database that cannot answer does not switch the shop off.
    console.error('[readDatabaseMaintenance] Error:', error instanceof Error ? error.message : 'Unknown error');
    return previous;
  }
}

export async function readDatabaseMaintenance(): Promise<DatabaseMaintenance> {
  const holder = cache();
  const entry = holder[CACHE_KEY];
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  const value = await fetchDatabaseMaintenance(entry?.value ?? OFF);
  holder[CACHE_KEY] = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** The active maintenance mode, or null when the shop is open. */
export async function getMaintenanceState(): Promise<MaintenanceState | null> {
  const server = readServerMaintenance();
  if (server) return { source: server.source, message: server.message, expectedEndAt: server.expectedEndAt, server };
  const database = await readDatabaseMaintenance();
  return database.enabled ? { source: 'database', message: database.message, expectedEndAt: database.expectedEndAt, server: null } : null;
}
