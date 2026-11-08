/** Localized product-field constraints shared by the form sections. @see ./hooks/required-fields.ts */
export function productFieldErrorMessage(field: string, locale: string): string {
  const messages: Record<string, [string, string]> = {
    name: ['Nazwa może mieć maksymalnie 200 znaków.', 'Name must be 200 characters or fewer.'],
    slug: ['Użyj do 80 małych liter, cyfr i pojedynczych myślników, bez myślnika na początku i końcu.', 'Use up to 80 lowercase letters, digits and single hyphens, without leading or trailing hyphens.'],
    price: ['Podaj poprawną cenę, nie większą niż 999 999,99.', 'Enter a valid price no greater than 999,999.99.'],
    recurring_price: ['Podaj dodatnią cenę cykliczną, nie większą niż 999 999,99.', 'Enter a positive recurring price no greater than 999,999.99.'],
    trial_days: ['Podaj liczbę całych dni od 0 do 730.', 'Enter a whole number of days from 0 to 730.'],
    license_tier: ['Użyj maksymalnie 80 liter A–Z, cyfr, myślników lub podkreśleń.', 'Use up to 80 letters A–Z, digits, hyphens or underscores.'],
    custom_price_presets: ['Każda widoczna kwota musi wynosić co najmniej minimum produktu i minimum płatności w tej walucie. Wpisz 0, aby ukryć przycisk.', 'Each visible amount must meet the product and currency payment minimums. Enter 0 to hide a button.'],
  };
  return messages[field]?.[locale.startsWith('pl') ? 0 : 1] ?? '';
}
