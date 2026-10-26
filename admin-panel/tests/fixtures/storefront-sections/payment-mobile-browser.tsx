import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import StripeSettings from '@/components/settings/StripeSettings';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const locale = location.search.includes('pl') ? 'pl' : 'en';
createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}>
  <StripeSettings siteUrl="https://shop.example.test" />
</NextIntlClientProvider>);
