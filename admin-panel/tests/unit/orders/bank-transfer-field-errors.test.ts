/** W146 B3: transfer settings report the exact field and refuse markup. @see src/lib/orders/bank-transfer-config.ts */
import { expect, it } from 'vitest';
import { bankTransferConfigSchema, bankTransferFieldErrors } from '@/lib/orders/bank-transfer-config';

const valid = { ...bankTransferConfigSchema.parse({}), bank_transfer_enabled: true, bank_account_holder: 'Sklep Sp. z o.o.', bank_account_number: 'PL61109010140000071219812874' };

it('accepts a valid configuration', () => expect(bankTransferFieldErrors(valid)).toEqual({}));
it.each([
  [{ bank_account_number: 'PL00' }, { bank_account_number: 'iban' }],
  [{ bank_account_holder: '' }, { bank_account_holder: 'holder_required' }],
  [{ bank_account_holder: '<script>x</script>' }, { bank_account_holder: 'markup' }],
  [{ bank_name: 'Bank <b>' }, { bank_name: 'markup' }],
  [{ bank_transfer_title_template: 'Zamówienie' }, { bank_transfer_title_template: 'template' }],
  [{ bank_transfer_due_days: 61 }, { bank_transfer_due_days: 'range' }],
  [{ reservation_reminder_hours: 48, reservation_release_hours: 48 }, { reservation_release_hours: 'release_after_reminder' }],
])('%j → %j', (patch, expected) => expect(bankTransferFieldErrors({ ...valid, ...patch })).toEqual(expected));
it('keeps ordinary punctuation in names', () => expect(bankTransferFieldErrors({ ...valid, bank_account_holder: 'Kowalski & Syn „Sklep” (PL)' })).toEqual({}));

it('explains why transfer is hidden for a session that starts before the reservation ends (W146 U6)', async () => {
  const { transferBlockedBySession } = await import('@/lib/orders/bank-transfer-config');
  const now = Date.parse('2026-11-04T10:00:00Z');
  expect(transferBlockedBySession(true, '2026-11-05T10:00:00Z', 48, now)).toBe(true);
  expect(transferBlockedBySession(true, '2026-11-10T10:00:00Z', 48, now)).toBe(false);
  expect(transferBlockedBySession(false, '2026-11-05T10:00:00Z', 48, now)).toBe(false);
});
