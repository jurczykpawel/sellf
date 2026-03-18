import { getIntegrationsConfig, getScripts } from '@/lib/actions/integrations'
import IntegrationsForm from '@/components/IntegrationsForm'
import { verifyAdminOrSellerAccess } from '@/lib/auth-server'

export default async function IntegrationsPage() {
  await verifyAdminOrSellerAccess()

  const [configResult, scriptsResult] = await Promise.all([
    getIntegrationsConfig(),
    getScripts()
  ])
  const config = configResult.success ? configResult.data as any : null
  const scripts = (scriptsResult.success ? scriptsResult.data : []) as any[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sf-heading">
          Integrations & Tracking
        </h1>
        <p className="mt-1 text-sm text-sf-muted">
          Configure analytics, marketing pixels, and manage custom scripts (GDPR compliant).
        </p>
      </div>

      <IntegrationsForm initialData={config} initialScripts={scripts || []} />
    </div>
  )
}