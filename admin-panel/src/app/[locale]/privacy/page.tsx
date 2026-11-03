import type { Metadata } from 'next'
import LegalDocumentPage from '@/components/LegalDocumentPage'

export const metadata: Metadata = {
  title: 'Privacy Policy - Sellf',
  description: 'Privacy Policy for Sellf platform',
  robots: 'index, follow'
}

// Force dynamic rendering - this page does redirect() which is inherently dynamic
// Runtime caching happens via browser cache-control headers
export const dynamic = 'force-dynamic'

export default function PrivacyPage() {
  return LegalDocumentPage({ namespace: 'legalPages.privacy', column: 'privacy_policy_url', envUrl: process.env.PRIVACY_POLICY_URL })
}
