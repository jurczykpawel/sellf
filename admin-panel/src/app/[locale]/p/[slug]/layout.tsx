/** Core product route appearance. @see components/storefront/ProtectedThemeLayout.tsx */
import ProtectedThemeLayout from '@/components/storefront/ProtectedThemeLayout';

export const metadata = {
  title: 'Product Page',
  description: 'Purchase or download product',
};

export default function ProductLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ProtectedThemeLayout>{children}</ProtectedThemeLayout>;
}
