import { checkPublicFeature } from '@/lib/license/public-snapshot';
import VariantSelectorClient from './VariantSelectorClient';

interface PageProps {
  params: Promise<{ groupId: string; locale: string }>;
}

export default async function VariantSelectorPage({ params }: PageProps) {
  const { groupId } = await params;

  // Check Sellf license validity (controls "Powered by" branding)
  const licenseValid = await checkPublicFeature('watermark-removal');

  return <VariantSelectorClient groupId={groupId} licenseValid={licenseValid} />;
}
