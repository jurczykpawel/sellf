import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { createPublicClient } from '@/lib/supabase/server'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Privacy Policy - GateFlow',
  description: 'Privacy Policy for GateFlow platform',
  robots: 'index, follow'
}

// Force dynamic rendering - this page does redirect() which is inherently dynamic
// Runtime caching happens via browser cache-control headers
export const dynamic = 'force-dynamic'

export default async function PrivacyPage() {
  const t = await getTranslations('legalPages.privacy');
  // Disable cache for this request
  noStore()

  // First check database for configured URL
  const supabase = createPublicClient()
  const { data: config } = await supabase
    .from('shop_config')
    .select('privacy_policy_url')
    .single()

  // Priority: Database > Environment variable
  const privacyUrl = config?.privacy_policy_url || process.env.PRIVACY_POLICY_URL

  if (privacyUrl) {
    // Validate: only allow http/https URLs or relative paths
    const isRelative = privacyUrl.startsWith('/') && !privacyUrl.startsWith('//')
    const isHttps = privacyUrl.startsWith('https://') || privacyUrl.startsWith('http://')
    if (isRelative || isHttps) {
      redirect(privacyUrl)
    }
  }

  // Fallback content if no URL is configured
  return (
    <div className="min-h-screen bg-wl-deep py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-white/20">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-4">{t('title')}</h1>
            <p className="text-gray-300">{t('configRequired')}</p>
          </div>

          <div className="prose prose-invert max-w-none space-y-6 text-gray-300">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3">{t('configRequired')}</h2>
              <p>{t('configDescription')}</p>

              <div className="mt-4 p-4 bg-wl-accent-soft border border-wl-border-accent rounded-lg">
                <p className="text-wl-accent font-medium">{t('option1Title')}</p>
                <p className="text-wl-accent text-sm mt-2">{t('option1Description')}</p>
              </div>

              <div className="mt-4 p-4 bg-blue-900/30 border border-blue-500/30 rounded-lg">
                <p className="text-blue-200 font-medium">{t('option2Title')}</p>
                <p className="text-blue-300 text-sm font-mono mt-2">{t('option2EnvVar')}</p>
              </div>

              <p className="mt-4 text-sm text-gray-400">{t('urlHelp')}</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
