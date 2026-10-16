/** Isolated product-editor fixture with the production section and translations. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { MarketingSection } from '@/components/ProductFormModal/sections/MarketingSection';
import { initialFormData } from '@/components/ProductFormModal/types';
import { marketingFieldsSchema } from '@/lib/validations/product-marketing';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

function Fixture() {
  const t = useTranslations('admin.products.form');
  const [formData, setFormData] = useState(() => ({ ...initialFormData,
    marketing_fields: marketingFieldsSchema.parse(JSON.parse(localStorage.getItem('marketing') ?? JSON.stringify({
      format: 'workshop', sourceLocale: 'en', en: { result: 'ą'.repeat(240), tools: ['n8n'], requirements: ['Spreadsheet knowledge'] },
    }))),
  }));
  const [saved, setSaved] = useState(false);
  return <main className="mx-auto max-w-xl p-4 text-sf-heading">
    <h1 className="text-xl mb-4">Product editor fixture</h1>
    <form onSubmit={event => {
      event.preventDefault();
      if (!marketingFieldsSchema.safeParse(formData.marketing_fields).success) return;
      localStorage.setItem('marketing', JSON.stringify(formData.marketing_fields));
      setSaved(true);
    }}>
      <MarketingSection formData={formData} setFormData={setFormData} t={t} />
      <button className="mt-4 border p-2 focus:ring-2 focus:ring-sf-accent" type="submit">Save fixture</button>
      {saved && <p role="status">Saved</p>}
    </form>
  </main>;
}
const locale = new URLSearchParams(location.search).get('locale') === 'pl' ? 'pl' : 'en';
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}><Fixture /></NextIntlClientProvider>);
