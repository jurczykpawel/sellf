import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { locales, Locale } from '@/lib/locales';
import { notFound } from 'next/navigation';
import WhitelabelProvider from '@/components/providers/whitelabel-provider';
import { loadThemeData } from '@/lib/theme-loader';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({
  children,
  params
}: Props) {
  const { locale } = await params;

  // Validate locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Enable static rendering by setting the locale
  setRequestLocale(locale);

  // Get messages for the locale
  const [messages, { theme, licenseValid }] = await Promise.all([
    getMessages(),
    loadThemeData(),
  ]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AuthProvider>
        <ToastProvider>
          <WhitelabelProvider theme={theme} licenseValid={licenseValid}>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
              {children}
            </div>
          </WhitelabelProvider>
        </ToastProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  );
}

// Generate static params for supported locales
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
