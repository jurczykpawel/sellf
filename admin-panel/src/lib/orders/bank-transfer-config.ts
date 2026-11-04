/** Transfer settings and availability. @see checkout-modules/buyer.ts */
import { z } from 'zod';
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';
export function normalizeBankAccount(value: string): string | null {
  const compact = value.replace(/\s/g, '').toUpperCase();
  const iban = /^\d{26}$/.test(compact) ? `PL${compact}` : compact;
  if (!/^PL\d{26}$/.test(iban)) return null;
  const digits = `${iban.slice(4)}2521${iban.slice(2, 4)}`;
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? iban : null;
}
// No control characters and no markup: these values reach the buyer's page and mail (W146 B3).
const text = z.string().trim().max(200, { message: 'too_long' }).regex(/^[^\u0000-\u001f\u007f]*$/, { message: 'control_chars' }).regex(/^[^<>]*$/, { message: 'markup' });
const hours = (min: number, max: number, fallback: number) => z.number({ message: 'range' }).int({ message: 'range' }).min(min, { message: 'range' }).max(max, { message: 'range' }).default(fallback);
export const bankTransferConfigSchema = z.object({
  bank_transfer_enabled: z.boolean().default(false),
  bank_account_holder: text.default(''),
  bank_account_number: z.string().max(64, { message: 'iban' }).transform(v => v === '' ? '' : normalizeBankAccount(v)).refine(v => v !== null, { message: 'iban' }).default(''),
  bank_name: text.default(''),
  bank_transfer_title_template: text.refine(v => v.includes('{order_number}'), { message: 'template' }).default('Zamówienie {order_number}'),
  bank_transfer_due_days: hours(1, 60, 14),
  bank_transfer_grant_access_on_placement: z.boolean().default(true),
  bank_transfer_max_unpaid_per_email: hours(1, 100, 3),
  // Timed reservation of event seats for unpaid transfers (no effect once an invoice is issued).
  reservation_enabled: z.boolean().default(true),
  reservation_reminder_hours: hours(1, 168, 24),
  reservation_release_hours: hours(2, 336, 48),
  declared_hold_hours: hours(0, 336, 72),
}).strict().superRefine((v, ctx) => {
  if (v.bank_transfer_enabled && !v.bank_account_holder) ctx.addIssue({ code: 'custom', path: ['bank_account_holder'], message: 'holder_required' });
  if (v.bank_transfer_enabled && !v.bank_account_number) ctx.addIssue({ code: 'custom', path: ['bank_account_number'], message: 'iban' });
  if (!(v.reservation_release_hours > v.reservation_reminder_hours)) ctx.addIssue({ code: 'custom', path: ['reservation_release_hours'], message: 'release_after_reminder' });
});
/** First error code per field; codes map to `bankTransfer.errors.*`. */
export function bankTransferFieldErrors(values: unknown): Record<string, string> {
  const r = bankTransferConfigSchema.safeParse(values); const out: Record<string, string> = {};
  if (r.success) return out;
  for (const issue of r.error.issues) { const key = String(issue.path[0] ?? ''); if (key && !out[key]) out[key] = issue.message; }
  return out;
}
export function canUseBankTransfer(enabled: boolean, rawProfile: unknown, buyerType: unknown): boolean {
  const profile = checkoutProfileSchema.safeParse(rawProfile);
  return enabled && profile.success && profile.data.modules.some(m => m.id === 'buyer'
    && m.bank_transfer_for?.some(t => t === buyerType) && m.types.some(t => t === buyerType));
}
export function availableTransferMethod(selected: 'online' | 'transfer' | null, enabled: boolean, profile: unknown, buyerType: unknown): 'online' | 'transfer' | null {
  return canUseBankTransfer(enabled, profile, buyerType) ? selected : 'online';
}
/** A timed reservation must end before the session starts; mirrors bank_transfer_order. */
export function transferFitsSession(startsAt: string | undefined, reservationHours: number | null, now = Date.now()): boolean {
  return !startsAt || reservationHours === null || Date.parse(startsAt) > now + reservationHours * 3600000;
}
/** Transfer would otherwise be offered, but the session starts before the reservation could end: say so instead of hiding it silently. */
export function transferBlockedBySession(offered: boolean, startsAt: string | undefined, reservationHours: number | null, now = Date.now()): boolean {
  return offered && !transferFitsSession(startsAt, reservationHours, now);
}
