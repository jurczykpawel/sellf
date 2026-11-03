/** @see lib/leads/server.ts */
import { leadOptions, playerstackConfig } from '@/lib/leads/server';
export async function OPTIONS(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return leadOptions(request, (await params).id);
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return playerstackConfig(request, (await params).id);
}
