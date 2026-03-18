import { getIntegrationsConfig } from '@/lib/actions/integrations'
import IntegrationsForm from '@/components/IntegrationsForm'
import { verifyAdminOrSellerAccess } from '@/lib/auth-server'

export default async function IntegrationsPage() {
  await verifyAdminOrSellerAccess()

  const configResult = await getIntegrationsConfig()
  const config = configResult.success ? configResult.data : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sf-heading">
          Integrations & Tracking
        </h1>
        <p className="mt-1 text-sm text-sf-muted">
          Configure analytics, marketing pixels, and cookie consent (GDPR compliant).
        </p>
      </div>

      <IntegrationsForm initialData={config} />
    </div>
  )
}
