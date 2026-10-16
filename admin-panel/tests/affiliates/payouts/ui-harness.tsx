import React from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import PayoutPanel from '@/components/affiliates/payouts/PayoutPanel';
import '@/app/globals.css';
const params = new URLSearchParams(location.search), locale = params.get('locale') === 'pl' ? 'pl' : 'en';
document.documentElement.className = params.has('dark') ? 'dark' : 'light';
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale={locale} messages={{ common: { selectOption: locale === 'pl' ? 'Wybierz…' : 'Choose…', noResults: locale === 'pl' ? 'Brak wyników: {searchTerm}' : 'No results: {searchTerm}' } }}><main style={{ minHeight: '100vh', background: 'var(--sf-bg-deep)', fontFamily: 'Arial, sans-serif' }}><PayoutPanel locale={locale} download={() => { document.body.dataset.download = 'ready'; }} /></main></NextIntlClientProvider>);
