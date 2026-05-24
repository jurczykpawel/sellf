import { describe, it, expect } from 'vitest';
import enMessages from '@/messages/en.json';
import plMessages from '@/messages/pl.json';
import {
  FEATURE_KEYS,
  USE_CASE_KEYS,
  TIER_KEYS,
} from '@/lib/landing/feature-keys';

type MessageRecord = Record<string, unknown>;

function getNested(obj: MessageRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, obj);
}

function expectKeyPresent(messages: MessageRecord, key: string, locale: string) {
  const value = getNested(messages, key);
  expect(value, `missing landing key "${key}" in ${locale}.json`).toBeDefined();
  expect(typeof value, `landing key "${key}" must be a string in ${locale}.json`).toBe('string');
}

describe('landing key inventory', () => {
  it.each(FEATURE_KEYS)('feature "%s" has title+desc in both locales', (key) => {
    expectKeyPresent(enMessages as MessageRecord, `landing.features.${key}.title`, 'en');
    expectKeyPresent(enMessages as MessageRecord, `landing.features.${key}.desc`, 'en');
    expectKeyPresent(plMessages as MessageRecord, `landing.features.${key}.title`, 'pl');
    expectKeyPresent(plMessages as MessageRecord, `landing.features.${key}.desc`, 'pl');
  });

  it.each(USE_CASE_KEYS)('use case "%s" has full keys in both locales', (key) => {
    for (const sub of ['title', 'desc', 'feature1', 'feature2', 'feature3']) {
      expectKeyPresent(enMessages as MessageRecord, `landing.useCases.${key}.${sub}`, 'en');
      expectKeyPresent(plMessages as MessageRecord, `landing.useCases.${key}.${sub}`, 'pl');
    }
  });

  it.each(TIER_KEYS)('license tier "%s" has full keys in both locales', (key) => {
    for (const sub of ['name', 'tagline', 'cta']) {
      expectKeyPresent(enMessages as MessageRecord, `landing.licenseTier.${key}.${sub}`, 'en');
      expectKeyPresent(plMessages as MessageRecord, `landing.licenseTier.${key}.${sub}`, 'pl');
    }
  });
});
