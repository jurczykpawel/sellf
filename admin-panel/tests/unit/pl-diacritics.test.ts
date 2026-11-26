/**
 * Polish copy keeps its diacritics
 *
 * pl.json once shipped strings typed without Polish letters
 * ("Oferta specjalna konczy sie za:", "uprawnien ... maja pelny dostep").
 * The listed words are ASCII forms that do not exist in correct Polish
 * without diacritics, so any whole-word hit is a broken string. URLs, e-mail
 * addresses and domain-like slugs are skipped (they are legitimately ASCII).
 *
 * @see src/messages/pl.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ASCII_DISTORTIONS = [
  'sie', 'konczy', 'moze', 'mozesz', 'mozna', 'wiecej', 'zostal', 'zostala',
  'zostalo', 'zostaly',
  'uprawnien', 'pelny', 'pelna', 'pelne', 'dostep', 'dostepu', 'juz',
  'bedzie', 'beda', 'ktory', 'ktora', 'ktore', 'nalezy', 'takze', 'rowniez',
  'prosze', 'wyswietla', 'pilnosci', 'wejscia', 'platnosc\\p{L}*',
  'uzytkownik\\p{L}*', 'dziekujemy',
];

const DISTORTION_RE = new RegExp(
  `(?<!\\p{L})(${ASCII_DISTORTIONS.join('|')})(?!\\p{L})`,
  'giu',
);

function stripAsciiTokens(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\w.+-]+@[\w.-]+/g, '')
    .replace(/\S*\.(?:pl|com|app|io|example)\S*/g, '');
}

function collect(node: unknown, path: string[], out: Array<[string, string]>): void {
  if (typeof node === 'string') {
    out.push([path.join('.'), node]);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collect(value, [...path, key], out);
  }
}

describe('pl.json diacritics', () => {
  it('contains no Polish words typed without diacritics', () => {
    const pl = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/messages/pl.json'), 'utf-8'),
    );
    const strings: Array<[string, string]> = [];
    collect(pl, [], strings);

    const offenders = strings
      .map(([key, value]) => [key, stripAsciiTokens(value).match(DISTORTION_RE)] as const)
      .filter(([, hits]) => hits !== null)
      .map(([key, hits]) => `${key}: ${hits!.join(', ')}`);

    expect(offenders).toEqual([]);
  });
});
