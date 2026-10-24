import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { locales, Locale } from '@/lib/locales';
import { notFound } from 'next/navigation';
import LocalizedFormValidation from '@/components/providers/LocalizedFormValidation';
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
      <LocalizedFormValidation />
      <AuthProvider>
        <WhitelabelProvider theme={theme} licenseValid={licenseValid}>
          <div className="min-h-screen bg-sf-deep">
            {children}
          </div>
        </WhitelabelProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: 'bg-sf-raised border border-sf-border backdrop-blur-sm text-sf-heading',
              success: '!bg-sf-success-soft !border-sf-success/20 !text-sf-success',
              error: '!bg-sf-danger-soft !border-sf-danger/20 !text-sf-danger',
              warning: '!bg-sf-warning-soft !border-sf-warning/20 !text-sf-warning',
              info: '!bg-sf-accent-soft !border-sf-accent/20 !text-sf-accent',
              closeButton: '!bg-sf-raised !border-sf-border !text-sf-muted',
            },
          }}
        />
      </AuthProvider>
    </NextIntlClientProvider>
  );
}

// Generate static params for supported locales
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
