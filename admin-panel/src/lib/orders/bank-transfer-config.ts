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
const text = z.string().trim().max(200).regex(/^[^\u0000-\u001f\u007f]*$/);
export const bankTransferConfigSchema = z.object({
  bank_transfer_enabled: z.boolean().default(false),
  bank_account_holder: text.default(''),
  bank_account_number: z.string().max(64).transform(v => v === '' ? '' : normalizeBankAccount(v)).refine(v => v !== null).default(''),
  bank_name: text.default(''),
  bank_transfer_title_template: text.refine(v => v.includes('{order_number}')).default('Zamówienie {order_number}'),
  bank_transfer_due_days: z.number().int().min(1).max(60).default(14),
  bank_transfer_grant_access_on_placement: z.boolean().default(true),
  bank_transfer_max_unpaid_per_email: z.number().int().min(1).max(100).default(3),
}).strict().refine(v => !v.bank_transfer_enabled || (!!v.bank_account_holder && !!v.bank_account_number));
export function canUseBankTransfer(enabled: boolean, rawProfile: unknown, buyerType: unknown): boolean {
  const profile = checkoutProfileSchema.safeParse(rawProfile);
  return enabled && profile.success && profile.data.modules.some(m => m.id === 'buyer'
    && m.bank_transfer_for?.some(t => t === buyerType) && m.types.some(t => t === buyerType));
}
