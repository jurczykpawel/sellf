/** Ports and origin of the dedicated PlayerStack lead stack, from env with the historical defaults. */
export const LEADS_APP_PORT = Number(process.env.LEADS_APP_PORT ?? 3893);
export const LEADS_HOST_PORT = Number(process.env.LEADS_HOST_PORT ?? 3894);
export const LEADS_RECEIVER_PORT = Number(process.env.LEADS_RECEIVER_PORT ?? 3895);
export const leadsAppUrl = process.env.LEADS_API_BASE_URL ?? `http://localhost:${LEADS_APP_PORT}`;
export const leadsOrigin = process.env.LEADS_ALLOWED_ORIGIN ?? `http://localhost:${LEADS_HOST_PORT}`;

/** Destructive fixtures run only against a local stack; LEADS_SUPABASE_PORT pins the expected port when set. */
export function assertLocalLeadsStack(check: (actual: unknown, expected: unknown) => void): void {
  const url = new URL(process.env.SUPABASE_URL!);
  check(['127.0.0.1', 'localhost'].includes(url.hostname), true);
  if (process.env.LEADS_SUPABASE_PORT) check(url.port, process.env.LEADS_SUPABASE_PORT);
}
