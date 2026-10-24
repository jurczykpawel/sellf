/** Localized ISO country options shared by server and browser rendering.
 * @see tests/unit/checkout-modules/country-options.test.ts
 */
import countryOptions from '@/lib/checkout/country-options.json';

interface CountryOption { code: string; name: string }

export function getCountryOptions(locale: string, savedCode = ''): CountryOption[] {
  const language = locale.toLowerCase().split('-')[0] === 'pl' ? 'pl' : 'en';
  const countries = countryOptions[language].map(country => ({ ...country }));
  if (savedCode && !countries.some(country => country.code === savedCode)) countries.push({ code: savedCode, name: savedCode });
  return countries;
}
