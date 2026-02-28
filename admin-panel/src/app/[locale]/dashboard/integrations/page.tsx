import { getIntegrationsConfig, getScripts } from '@/lib/actions/integrations'
import IntegrationsForm from '@/components/IntegrationsForm'
import { verifyAdminAccess } from '@/lib/auth-server'

export default async function IntegrationsPage() {
  await verifyAdminAccess()

  const [config, scripts] = await Promise.all([
    getIntegrationsConfig(),
    getScripts()
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gf-heading">
          Integrations & Tracking
        </h1>
        <p className="mt-1 text-sm text-gf-muted">
          Configure analytics, marketing pixels, and manage custom scripts (GDPR compliant).
        </p>
      </div>

      <IntegrationsForm initialData={config} initialScripts={scripts || []} />
    </div>
  )
}