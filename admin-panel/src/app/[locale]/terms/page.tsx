import type { Metadata } from 'next'
import LegalDocumentPage from '@/components/LegalDocumentPage'

export const metadata: Metadata = {
  title: 'Terms of Service - Sellf',
  description: 'Terms of Service for Sellf platform',
  robots: 'index, follow'
}

// Force dynamic rendering - this page does redirect() which is inherently dynamic
// Runtime caching happens via browser cache-control headers
export const dynamic = 'force-dynamic'

export default function TermsPage() {
  return LegalDocumentPage({ namespace: 'legalPages.terms', column: 'terms_of_service_url', envUrl: process.env.TERMS_OF_SERVICE_URL })
}
