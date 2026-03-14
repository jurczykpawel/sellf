import { getCategories } from '@/lib/actions/categories'
import CategoriesPageContent from '@/components/CategoriesPageContent'
import { verifyAdminAccess } from '@/lib/auth-server'

export default async function CategoriesPage() {
  await verifyAdminAccess()
  const result = await getCategories()

  return <CategoriesPageContent initialCategories={result.data ?? []} />
}