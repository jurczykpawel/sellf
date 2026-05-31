import WebhooksPageContent from '@/components/WebhooksPageContent';
import { resolveCurrentTier, hasFeature } from '@/lib/license/features';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Webhooks - Sellf Admin',
};

export default async function WebhooksPage() {
  const tier = await resolveCurrentTier();
  const scopingLocked = !hasFeature(tier, 'webhook-product-scoping');
  return <WebhooksPageContent scopingLocked={scopingLocked} />;
}
