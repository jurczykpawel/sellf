import ApiKeysPageContent from '@/components/ApiKeysPageContent';
import { resolveCurrentTier, hasFeature } from '@/lib/license/features';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Keys - Sellf Admin',
};

export default async function ApiKeysPage() {
  const tier = await resolveCurrentTier();
  const scopesLocked = !hasFeature(tier, 'api-key-scopes');
  return <ApiKeysPageContent scopesLocked={scopesLocked} />;
}
