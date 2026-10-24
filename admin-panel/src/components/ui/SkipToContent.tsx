/** Keyboard entry to page content after navigation. @see DashboardLayout.tsx */
import { useLocale } from 'next-intl';

export default function SkipToContent() {
  const locale = useLocale();
  return <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-sf-base focus:px-4 focus:py-3 focus:text-sf-heading focus:ring-2 focus:ring-sf-accent">{locale === 'pl' ? 'Przejdź do treści' : 'Skip to content'}</a>;
}
