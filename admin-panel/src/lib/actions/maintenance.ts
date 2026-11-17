'use server';
/** Panel actions for maintenance mode ("Przerwa w działaniu"). @see ../maintenance/setting.ts */
import { revalidatePath } from 'next/cache';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { changeMaintenanceMode, maintenanceChangeSchema, readMaintenanceStatus } from '@/lib/maintenance/setting';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { MaintenanceStatus } from '@/lib/maintenance/setting';

export async function getMaintenanceStatus(): Promise<ActionResponse<MaintenanceStatus>> {
  return withAdminClient(async ({ dataClient }) => {
    const status = await readMaintenanceStatus(dataClient);
    if (!status.ok) {
      console.error('[getMaintenanceStatus] Error:', status.error);
      return { success: false, error: 'Maintenance mode could not be read', errorCode: 'DATABASE_ERROR' };
    }
    return { success: true, data: status.data };
  });
}

export async function setMaintenanceMode(input: unknown): Promise<ActionResponse<MaintenanceStatus>> {
  const parsed = maintenanceChangeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid maintenance mode change', errorCode: 'INVALID_INPUT' };
  return withAdminClient(async ({ dataClient, user }) => {
    const saved = await changeMaintenanceMode(dataClient, parsed.data, { performedBy: user.id, details: { auth: 'session' } });
    if (!saved.ok) {
      if (saved.invalid) return { success: false, error: saved.error, errorCode: 'INVALID_INPUT' };
      console.error('[setMaintenanceMode] Error:', saved.error);
      return { success: false, error: 'Maintenance mode not changed', errorCode: 'DATABASE_ERROR' };
    }
    revalidatePath('/dashboard/settings');
    return { success: true, data: saved.data };
  }, { mutating: true });
}
