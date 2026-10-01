/**
 * Locale key parity
 *
 * en.json and pl.json must declare the exact same set of translation keys.
 * A key present in one locale but missing from the other means English (or
 * Polish) users see a raw key or a next-intl fallback instead of real copy.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type JsonRecord = { [key: string]: unknown };

function loadLocale(locale: 'en' | 'pl'): JsonRecord {
  return JSON.parse(
    readFileSync(resolve(__dirname, `../../src/messages/${locale}.json`), 'utf-8'),
  );
}

function flattenKeys(obj: JsonRecord, prefix = '', out: string[] = []): string[] {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value as JsonRecord, fullKey, out);
    } else {
      out.push(fullKey);
    }
  }
  return out;
}

describe('locale key parity (en.json vs pl.json)', () => {
  const en = loadLocale('en');
  const pl = loadLocale('pl');
  const enKeys = new Set(flattenKeys(en));
  const plKeys = new Set(flattenKeys(pl));

  it('has no keys present in en.json but missing from pl.json', () => {
    const missingFromPl = [...enKeys].filter((k) => !plKeys.has(k)).sort();
    expect(missingFromPl).toEqual([]);
  });

  it('has no keys present in pl.json but missing from en.json', () => {
    const missingFromEn = [...plKeys].filter((k) => !enKeys.has(k)).sort();
    expect(missingFromEn).toEqual([]);
  });
});
