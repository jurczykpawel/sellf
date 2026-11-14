import { defaultLocale, locales } from '@/lib/locales';

/** Prefixes an internal path with the active locale (the default locale stays unprefixed, `localePrefix: 'as-needed'`). */
export function localizedPath(locale: string, href: string): string {
  if (!href.startsWith('/') || href.startsWith('//') || locale === defaultLocale) return href;
  if (locales.some(known => href === `/${known}` || /^\/[a-z]{2}(?=[/?#])/.test(href) && href.startsWith(`/${known}`))) return href;
  return href === '/' ? `/${locale}` : `/${locale}${href}`;
}
