/**
 * Maintenance mode for the admin (panel + API v1): read the effective state with its source, and
 * switch the database source. The switch and its audit entry are one transaction
 * (set_maintenance_mode): when the entry is refused nothing changes.
 *
 * The server source (file / SELLF_MAINTENANCE) cannot be switched from here; the status says where
 * it comes from and how to remove it.
 *
 * @see src/lib/actions/maintenance.ts (panel)
 * @see src/app/api/v1/system/maintenance/route.ts (API v1)
 * @see supabase/migrations/20261117130000_maintenance_mode.sql
 */
import { z } from 'zod';
import { MAINTENANCE_MESSAGE_MAX, getMaintenanceFilePath, isMaintenanceEnvOn, readServerMaintenance } from '@/lib/maintenance/file';
import { invalidateMaintenanceCache } from '@/lib/maintenance/state';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { MaintenanceSource } from '@/lib/maintenance/state';
import type { Json } from '@/types/database';

export type MaintenanceClient = Pick<ReturnType<typeof createAdminClient>, 'from' | 'rpc'>;

/** PATCH body / panel input: switches the database source. Turning it off clears message and time. */
export const maintenanceChangeSchema = z.object({
  enabled: z.boolean().describe('Switch maintenance mode (the database source) on or off.'),
  message: z.string().trim().max(MAINTENANCE_MESSAGE_MAX).nullable().optional()
    .describe('Optional note shown on the maintenance page, at most 500 characters.'),
  expected_end_at: z.iso.datetime({ offset: true }).nullable().optional()
    .describe('Optional expected end (ISO 8601); shown on the page and used for Retry-After. Must be in the future.'),
}).strict();

export type MaintenanceChange = z.infer<typeof maintenanceChangeSchema>;

export const maintenanceStatusSchema = z.object({
  active: z.boolean().describe('True when the shop is in maintenance mode from any source.'),
  source: z.enum(['file', 'env', 'database']).nullable().describe('Source in effect; the server file wins over the database switch.'),
  message: z.string().nullable(),
  expected_end_at: z.string().nullable(),
  database: z.object({
    enabled: z.boolean(),
    message: z.string().nullable(),
    expected_end_at: z.string().nullable(),
    changed_at: z.string().nullable(),
  }),
  server: z.object({
    file_path: z.string().describe('Where the server file is looked for; delete it to end file maintenance.'),
    file_present: z.boolean(),
    file_reason: z.string().nullable().describe('"upgrade" while an update runs, "migration_state_unknown" when an update left it on.'),
    env: z.boolean().describe('True when SELLF_MAINTENANCE switches it on.'),
  }),
});

export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;

type Result<T> = { ok: true; data: T } | { ok: false; error: string; invalid?: boolean };

export async function readMaintenanceStatus(client: MaintenanceClient): Promise<Result<MaintenanceStatus>> {
  const { data, error } = await client.from('maintenance_mode').select('enabled, message, expected_end_at, changed_at').maybeSingle();
  if (error) return { ok: false, error: error.message };
  const database = {
    enabled: data?.enabled === true,
    message: data?.message ?? null,
    expected_end_at: data?.expected_end_at ?? null,
    changed_at: data?.changed_at ?? null,
  };
  const server = readServerMaintenance();
  const source: MaintenanceSource | null = server?.source ?? (database.enabled ? 'database' : null);
  return {
    ok: true,
    data: {
      active: source !== null,
      source,
      message: server ? server.message : database.enabled ? database.message : null,
      expected_end_at: server ? server.expectedEndAt : database.enabled ? database.expected_end_at : null,
      database,
      server: {
        file_path: getMaintenanceFilePath(),
        file_present: server?.source === 'file',
        file_reason: server?.source === 'file' ? server.reason : null,
        env: isMaintenanceEnvOn(),
      },
    },
  };
}

export interface MaintenanceAudit {
  /** UUID of the admin's auth user (audit_log.performed_by references auth.users). */
  performedBy: string;
  details?: Record<string, Json>;
}

export async function changeMaintenanceMode(client: MaintenanceClient, change: MaintenanceChange, audit: MaintenanceAudit): Promise<Result<MaintenanceStatus>> {
  const message = change.enabled ? change.message || null : null;
  const expectedEndAt = change.enabled ? change.expected_end_at ?? null : null;
  if (expectedEndAt && Date.parse(expectedEndAt) <= Date.now()) {
    return { ok: false, error: 'expected_end_at must be in the future', invalid: true };
  }
  try {
    const { error } = await client.rpc('set_maintenance_mode', {
      p_enabled: change.enabled,
      p_message: message as string,
      p_expected_end_at: expectedEndAt as string,
      p_performed_by: audit.performedBy,
      p_details: audit.details ?? {},
    });
    if (error) return { ok: false, error: error.message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
  invalidateMaintenanceCache();
  return readMaintenanceStatus(client);
}
