import { getCategories } from '@/lib/actions/categories'
import CategoriesPageContent from '@/components/CategoriesPageContent'
import { verifyAdminOrSellerAccess } from '@/lib/auth-server'

export default async function CategoriesPage() {
  await verifyAdminOrSellerAccess()
  const result = await getCategories()

  return <CategoriesPageContent initialCategories={result.data ?? []} />
}