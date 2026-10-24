/** Localized participant downloads. @see @/lib/events/presentation */
import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { participantCsv, participantFilename } from '@/lib/events/presentation';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const session = { starts_at: '2099-06-01T22:30:00Z', timezone: 'Europe/Warsaw' };
describe('participant downloads', () => {
  it.each(['pl', 'en'] as const)('exports %s labels, UTF-8 and event-local time', locale => {
    const t = createTranslator({ locale, messages: locale === 'pl' ? pl : en, namespace: 'events' });
    const csv = participantCsv([{ transaction_id: 'tx', status: 'confirmed', order_details: {
      participants: { v: 1, people: [{ first_name: 'Łukasz', last_name: 'Nowak', email: 'l@example.com' }] }, phone: { v: 1, value: '+48123456789' },
    } }], { locale, t, session });
    expect(Buffer.from(csv).subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
    expect(csv).toContain(locale === 'pl' ? '"Zamówienie","Status","Imię","Nazwisko","Email","Termin","Telefon"' : '"Order","Status","First name","Last name","Email","Session","Phone"');
    expect(csv).toContain(locale === 'pl' ? '"Potwierdzone"' : '"Confirmed"');
    expect(csv).toContain('Łukasz');
    expect(csv).toContain(locale === 'pl' ? '00:30' : '12:30 AM');
    expect(csv).toContain('Europe/Warsaw');
    expect(csv).toContain('"\'+48123456789"');
    expect(participantFilename('warsztat', session, t)).toBe(`${locale === 'pl' ? 'uczestnicy' : 'participants'}-warsztat-2099-06-02.csv`);
  });
  it.each(['=', '+', '-', '@'])('quotes prefix %s and embedded punctuation', prefix => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'events' });
    const csv = participantCsv([{ transaction_id: prefix + 'id', status: 'confirmed', customer_email: 'a@example.com', order_details: { buyer: { v: 1, first_name: prefix + 'A,"B"\nC' } } }], { locale: 'en', t, session });
    expect(csv).toContain(`"'${prefix}id"`);
    expect(csv).toContain(`"'${prefix}A,""B""\nC"`);
    expect(csv).toContain(',""');
  });
});
