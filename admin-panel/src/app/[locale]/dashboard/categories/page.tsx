import { getCategories } from '@/lib/actions/categories'
import { getTags } from '@/lib/actions/tags'
import CategoriesTagsTabs from '@/components/CategoriesTagsTabs'
import { verifyAdminAccess } from '@/lib/auth-server'

export default async function CategoriesPage() {
  await verifyAdminAccess()
  const [categoriesResult, tagsResult] = await Promise.all([getCategories(), getTags()])

  return (
    <CategoriesTagsTabs
      initialCategories={categoriesResult.data ?? []}
      initialTags={tagsResult.data ?? []}
    />
  )
}
