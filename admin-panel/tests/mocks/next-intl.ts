/** Shared identity translations for component tests without a locale provider. */
const translate = (key: string): string => key;

export function createNextIntlMock(actual: typeof import('next-intl')) {
  return {
    ...actual,
    useLocale: () => 'en',
    useTranslations: () => translate,
  };
}
