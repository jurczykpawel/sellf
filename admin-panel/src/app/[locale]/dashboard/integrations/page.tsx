import { getTranslations } from 'next-intl/server'
import { getIntegrationsConfig } from '@/lib/actions/integrations'
import IntegrationsForm from '@/components/IntegrationsForm'
import type { IntegrationsFormInitialData } from '@/components/IntegrationsForm'
import { verifyAdminAccess } from '@/lib/auth-server'

export default async function IntegrationsPage() {
  await verifyAdminAccess()
  const t = await getTranslations('integrations')

  const configResult = await getIntegrationsConfig()
  const config = configResult.success ? configResult.data : null
  const formConfig = config ? Object.fromEntries(Object.entries(config).filter(([key]) =>
    key !== 'sellf_license_env_configured' && key !== 'sellf_license_env_status'
  )) as IntegrationsFormInitialData : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sf-heading">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-sf-muted">
          {t('subtitle')}
        </p>
      </div>

      <IntegrationsForm initialData={formConfig} />
    </div>
  )
}
