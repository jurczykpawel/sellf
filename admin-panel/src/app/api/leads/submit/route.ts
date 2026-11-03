/** @see lib/leads/server.ts */
import { leadOptions } from '@/lib/leads/server';
export { leadSubmit as POST } from '@/lib/leads/server';
export async function OPTIONS(request: Request) {
  return leadOptions(request);
}
