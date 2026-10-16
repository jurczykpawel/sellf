/** Session history convenience page. @see storefront-templates/lifecycle.ts */
import { verifyAdminAccess } from '@/lib/auth-server';
import TemplateHistory from '@/components/storefront/TemplateHistory';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function TemplateHistoryPage() {
  await verifyAdminAccess();
  return <TemplateHistory />;
}
