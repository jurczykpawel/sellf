import { expect, it } from 'vitest';
import { applyLocalized, localizedFromConfig } from '@/lib/products/localized-metadata';

const config = { localized: { pl: { name: ' Kurs PL ', description: 'Opis PL', image_alt: 'Okładka kursu' }, en: { name: 'Course EN' } } };

it('reads the active locale name, description and image alt text (GitHub #73 AC02)', () => {
  expect(localizedFromConfig(config, 'pl')).toEqual({ name: 'Kurs PL', description: 'Opis PL', imageAlt: 'Okładka kursu' });
  expect(localizedFromConfig(config, 'en')).toEqual({ name: 'Course EN' });
});
it('ignores missing, blank, oversized and non-text values', () => {
  expect(localizedFromConfig({}, 'pl')).toEqual({});
  expect(localizedFromConfig(null, 'pl')).toEqual({});
  expect(localizedFromConfig({ localized: { pl: { name: '  ', description: 5, image_alt: 'x'.repeat(501) } } }, 'pl')).toEqual({});
  expect(localizedFromConfig({ localized: 'pl' }, 'pl')).toEqual({});
  expect(localizedFromConfig({ localized: { pl: { name: 'ok' } } }, '__proto__')).toEqual({});
});
it('falls back to the canonical fields when a translation is missing', () => {
  const product = { id: '1', name: 'Course', description: 'Canonical text', image_url: null };
  expect(applyLocalized(product, { name: 'Kurs' })).toMatchObject({ name: 'Kurs', description: 'Canonical text' });
  expect(applyLocalized(product, undefined)).toEqual(product);
  expect(applyLocalized(product, { imageAlt: 'Okładka' })).toMatchObject({ name: 'Course', imageAlt: 'Okładka' });
});
