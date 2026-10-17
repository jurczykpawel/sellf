/** Revenue chart with deterministic analytics and the real date controls. */
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import RevenueChart from '@/components/dashboard/RevenueChart';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const locale = new URLSearchParams(location.search).get('locale') === 'pl' ? 'pl' : 'en';
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider timeZone="UTC" locale={locale} messages={locale === 'pl' ? pl : en}>
    <main className="p-4 sm:p-6 lg:p-8"><div className="max-w-7xl mx-auto"><RevenueChart /></div></main>
  </NextIntlClientProvider>,
);
