import { SELLF_GITHUB_URL } from '@/lib/constants';
import packageJson from '../../../../package.json';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sellf.app';

export function buildLandingJsonLd(locale: string) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Sellf',
      url: SITE_URL,
      logo: `${SITE_URL}/logo.svg`,
      sameAs: [SELLF_GITHUB_URL],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Sellf',
      url: SITE_URL,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE_URL}/${locale}/store?q={query}`,
        'query-input': 'required name=query',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Sellf',
      operatingSystem: 'Linux, macOS, Windows (via Node.js)',
      applicationCategory: 'BusinessApplication',
      description:
        'Self-hosted digital product monetization platform. Zero platform fees, full data ownership, EU-compliant.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      softwareVersion: packageJson.version,
      sameAs: [SELLF_GITHUB_URL],
      image: `${SITE_URL}/api/og/about?locale=${locale}`,
    },
  ];
}
