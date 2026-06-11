import ProductsPageContent from '@/components/ProductsPageContent';
import { checkFeature } from '@/lib/license/resolve';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Products - Sellf Admin',
};

export default async function ProductsPage() {
  const hasLicenseIssuance = await checkFeature('license-key-issuance');
  return <ProductsPageContent hasLicenseIssuance={hasLicenseIssuance} />;
}
