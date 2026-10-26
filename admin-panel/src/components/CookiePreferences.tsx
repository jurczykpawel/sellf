'use client';

/** Shared consent access for storefront and buyer footers. @see TrackingProvider.tsx */
import { usePathname } from 'next/navigation';
import { useTrackingConfig } from '@/components/providers/tracking-config-provider';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

export default function CookiePreferences({ locale }: { locale: string }) {
  const config = useTrackingConfig();
  if (!config?.cookie_consent_enabled) return null;
  const label = (locale === 'pl' ? pl : en).landing.footer.cookiePreferences;
  return <button type="button" className="mt-2 cursor-pointer text-xs text-sf-muted underline underline-offset-2 hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
    onClick={async () => { const consent = await import('vanilla-cookieconsent'); consent.showPreferences(); }}>
    {label}
  </button>;
}

export function BuyerCookieFooter() {
  const pathname = usePathname();
  const config = useTrackingConfig();
  const locale = pathname.split('/')[1] === 'pl' ? 'pl' : 'en';
  const path = pathname.replace(/^\/(en|pl)(?=\/|$)/, '') || '/';
  if (!config?.cookie_consent_enabled || path.startsWith('/dashboard') || path.startsWith('/template-preview') || ['/', '/store', '/about'].includes(path)) return null;
  return <footer className="border-t border-sf-border px-6 py-6 text-center"><CookiePreferences locale={locale} /></footer>;
}
