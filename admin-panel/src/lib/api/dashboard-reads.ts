/**
 * Client for `GET /api/admin/dashboard`: the dashboard widgets' reads, abortable and
 * independent of the router's navigation state (unlike server actions).
 * @see src/app/api/admin/dashboard/route.ts
 */
import { api } from '@/lib/api/client';

export function readDashboard<T>(read: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  return api.getInternal<T>('admin/dashboard', { read, ...params }, signal);
}
