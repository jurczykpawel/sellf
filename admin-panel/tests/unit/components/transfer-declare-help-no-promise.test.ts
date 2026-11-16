/** A page left open across the deadline must not promise an extension — the pre-deadline help is conditional. */
import { describe, expect, it } from 'vitest';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

describe('transfer declaration help text', () => {
  it('never promises an unconditional extension (PL/EN)', () => {
    const help = { pl: (pl as { bankTransfer: { declareHelp: string } }).bankTransfer.declareHelp, en: (en as { bankTransfer: { declareHelp: string } }).bankTransfer.declareHelp };
    expect(help.pl).toMatch(/przed terminem/);
    expect(help.pl).toMatch(/po terminie tylko informuje/);
    expect(help.en).toMatch(/Before the reservation deadline/);
    expect(help.en).toMatch(/only informs the seller/);
  });
});
