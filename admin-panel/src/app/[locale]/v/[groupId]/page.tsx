import { checkFeature } from '@/lib/license/resolve';
import VariantSelectorClient from './VariantSelectorClient';

interface PageProps {
  params: Promise<{ groupId: string; locale: string }>;
}

export default async function VariantSelectorPage({ params }: PageProps) {
  const { groupId } = await params;

  // Check Sellf license validity (controls "Powered by" branding)
  const licenseValid = await checkFeature('watermark-removal');

  return <VariantSelectorClient groupId={groupId} licenseValid={licenseValid} />;
}
