/**
 * Shared /terms and /privacy behaviour: redirect to the configured document URL
 * (database first, env fallback), otherwise show how to configure it.
 * @see src/app/[locale]/terms/page.tsx
 * @see src/app/[locale]/privacy/page.tsx
 */
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';

interface LegalDocumentConfig {
  namespace: 'legalPages.terms' | 'legalPages.privacy';
  column: 'terms_of_service_url' | 'privacy_policy_url';
  envUrl: string | undefined;
}

function isAllowedUrl(url: string): boolean {
  const isRelative = url.startsWith('/') && !url.startsWith('//');
  return isRelative || url.startsWith('https://') || url.startsWith('http://');
}

export default async function LegalDocumentPage({ namespace, column, envUrl }: LegalDocumentConfig) {
  const t = await getTranslations(namespace);
  noStore();

  const { data: config } = await createPublicClient().from('shop_config').select(column).single();
  // Priority: Database > Environment variable
  const url = (config as Record<string, string | null> | null)?.[column] || envUrl;
  if (url && isAllowedUrl(url)) redirect(url);

  return (
    <div className="min-h-screen bg-sf-deep py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-sf-raised/80 backdrop-blur-sm rounded-2xl p-8 shadow-[var(--sf-shadow-accent)] border border-sf-border">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-sf-heading mb-4">{t('title')}</h1>
            <p className="text-sf-body">{t('configRequired')}</p>
          </div>

          <div className="prose prose-invert max-w-none space-y-6 text-sf-body">
            <section>
              <p>{t('configDescription')}</p>

              <div className="mt-4 p-4 bg-sf-accent-soft border border-sf-border-accent rounded-xl">
                <p className="text-sf-accent font-medium">{t('option1Title')}</p>
                <p className="text-sf-accent text-sm mt-2">{t('option1Description')}</p>
              </div>

              <div className="mt-4 p-4 bg-sf-accent-soft border border-sf-accent/30 rounded-xl">
                <p className="text-sf-accent font-medium">{t('option2Title')}</p>
                <p className="text-sf-accent text-sm font-mono mt-2">{t('option2EnvVar')}</p>
              </div>

              <p className="mt-4 text-sm text-sf-muted">{t('urlHelp')}</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
