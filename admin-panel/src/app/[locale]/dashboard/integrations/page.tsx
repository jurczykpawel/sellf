import { getIntegrationsConfig } from '@/lib/actions/integrations'
import IntegrationsForm from '@/components/IntegrationsForm'
import { verifyAdminAccess } from '@/lib/auth-server'
import type { IntegrationsInput } from '@/lib/validations/integrations'

export default async function IntegrationsPage() {
  await verifyAdminAccess()

  const configResult = await getIntegrationsConfig()
  const config = configResult.success ? configResult.data : null
  const formConfig = config
    ? (({
        sellf_license_env_configured: _envLicenseConfigured,
        sellf_license_env_status: _envLicenseStatus,
        ...editableConfig
      }) => editableConfig)(config as Record<string, unknown>) as IntegrationsInput
    : null

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

      <IntegrationsForm initialData={formConfig} />
    </div>
  )
}
