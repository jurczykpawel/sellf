import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import PaidProductForm from '@/app/[locale]/checkout/[slug]/components/PaidProductForm';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { Product } from '@/types';

const locale = new URLSearchParams(location.search).get('locale') === 'pl' ? 'pl' : 'en';
createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}>
  <PaidProductForm product={{ id: '11111111-1111-4111-8111-111111111111', name: 'Fixture course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0 } as Product} collectTermsOfService={false} />
  <a href={new URL('/left', location.href).href}>Leave checkout</a>
</NextIntlClientProvider>);
