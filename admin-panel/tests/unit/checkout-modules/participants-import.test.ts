import { describe, expect, it } from 'vitest';
import { parseParticipantList } from '@/lib/checkout-modules/participants-import';

describe('participant list import', () => {
  it('reads first name, last name and email per line with comma, semicolon or tab', () => {
    const text = 'Jan, Nowak, jan@example.com\nAnna;Kowalska;anna@example.com\nPiotr\tWiśniewski\tpiotr@example.com';
    expect(parseParticipantList(text, 10).people).toEqual([
      { first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' },
      { first_name: 'Anna', last_name: 'Kowalska', email: 'anna@example.com' },
      { first_name: 'Piotr', last_name: 'Wiśniewski', email: 'piotr@example.com' },
    ]);
  });
  it('skips a header row and blank lines, and understands quoted CSV cells', () => {
    const text = 'imię,nazwisko,email\r\n\r\n"Maria","Curie-Skłodowska","maria@example.com"\r\n';
    expect(parseParticipantList(text, 5).people).toEqual([{ first_name: 'Maria', last_name: 'Curie-Skłodowska', email: 'maria@example.com' }]);
  });
  it('accepts "Name Surname email" pasted without separators', () => {
    expect(parseParticipantList('Jan Maria Nowak jan@example.com', 5).people).toEqual([{ first_name: 'Jan', last_name: 'Maria Nowak', email: 'jan@example.com' }]);
  });
  it('keeps only as many people as the quantity and reports the overflow and unreadable lines', () => {
    const result = parseParticipantList('A,B,a@example.com\nC,D,c@example.com\nbroken line\nE,F,e@example.com', 2);
    expect(result.people).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.overflow).toBe(1);
  });
});
