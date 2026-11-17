/**
 * Maintenance checks where something NEW starts on the server: a free grant, a free-product request,
 * a lead or a waitlist signup. The proxy pauses these routes too, but the decision must also hold
 * where access is granted, because some of these steps run from pages and callbacks the proxy keeps
 * open (the payment return page, the magic-link callback). A step that completes something recorded
 * before the break (a saved free-grant request, a lead confirmation token) or a payment already made
 * is not checked here.
 *
 * @see src/lib/maintenance/state.ts
 * @see src/lib/maintenance/surfaces.ts (proxy)
 */
import { getMaintenanceState } from '@/lib/maintenance/state';

export const MAINTENANCE_CODE = 'MAINTENANCE';
export const MAINTENANCE_API_MESSAGE = 'The shop is down for maintenance. Please try again later.';

export async function isMaintenanceActive(): Promise<boolean> {
  return (await getMaintenanceState()) !== null;
}

/** JSON body of a 503 answer for a refused step (send it with status 503). */
export function maintenanceErrorBody(): { error: string; code: typeof MAINTENANCE_CODE } {
  return { error: MAINTENANCE_API_MESSAGE, code: MAINTENANCE_CODE };
}
