import type { MetadataRoute } from 'next';
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const SITE_URL = getPublicBaseUrl();
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/en/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/pl/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/en/store`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/pl/store`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
