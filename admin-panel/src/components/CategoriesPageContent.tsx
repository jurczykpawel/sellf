'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Category, deleteCategory } from '@/lib/actions/categories'
import { Plus, Edit, Trash2 } from 'lucide-react'
import CategoryFormModal from './CategoryFormModal'
import { useToast } from '@/contexts/ToastContext'

export default function CategoriesPageContent({ initialCategories }: { initialCategories: Category[] }) {
  const t = useTranslations('admin.categories') // Assuming we add this namespace later
  const commonT = useTranslations('common')
  const { addToast } = useToast()
  
  const [categories, setCategories] = useState(initialCategories) // In real app, revalidatePath handles refresh, but optimistic update is nice
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null)

  const handleDelete = async (category: Category) => {
    try {
      const result = await deleteCategory(category.id)
      if (result && !result.success) {
        addToast(result.error || commonT('error', { defaultValue: 'Error' }), 'error')
        return
      }
      addToast(commonT('success', { defaultValue: 'Success' }), 'success')
      setCategoryToDelete(null)
    } catch (error) {
      addToast(commonT('error', { defaultValue: 'Error' }), 'error')
    }
  }

  const openCreateModal = () => {
    setEditingCategory(null)
    setIsModalOpen(true)
  }

  const openEditModal = (category: Category) => {
    setEditingCategory(category)
    setIsModalOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gf-heading">
          {t('title', { defaultValue: 'Categories' })}
        </h1>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          {commonT('create')}
        </button>
      </div>

      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gf-border bg-gf-raised">
              <th className="p-4 font-medium text-gf-muted">{commonT('name')}</th>
              <th className="p-4 font-medium text-gf-muted">{t('slug')}</th>
              <th className="p-4 font-medium text-gf-muted text-right">{commonT('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {initialCategories.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-8 text-center text-gf-muted">
                  {t('noCategories', { defaultValue: 'No categories found' })}
                </td>
              </tr>
            ) : (
              initialCategories.map((category) => (
                <tr key={category.id} className="border-b border-gf-border hover:bg-gf-hover">
                  <td className="p-4 text-gf-heading font-medium">{category.name}</td>
                  <td className="p-4 text-gf-muted font-mono text-sm">{category.slug}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => openEditModal(category)}
                        className="p-2 text-gf-muted hover:text-gf-accent hover:bg-gf-accent-soft rounded-lg transition-colors"
                        title={commonT('edit')}
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => setCategoryToDelete(category)}
                        className="p-2 text-gf-muted hover:text-gf-danger hover:bg-gf-danger-soft rounded-lg transition-colors"
                        title={commonT('delete')}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CategoryFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        category={editingCategory}
      />

      {/* Delete Confirmation Modal */}
      {categoryToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gf-base rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 text-gf-heading">
              {commonT('confirmDelete', { defaultValue: 'Confirm Delete' })}
            </h3>
            <p className="text-gf-body mb-6">
              {t('deleteMessage', {
                defaultValue: 'Are you sure you want to delete the category "{name}"? This action cannot be undone.',
                name: categoryToDelete.name
              })}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setCategoryToDelete(null)}
                className="px-4 py-2 text-gf-body hover:bg-gf-hover rounded-lg transition-colors"
              >
                {commonT('cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={() => handleDelete(categoryToDelete)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                {commonT('delete', { defaultValue: 'Delete' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
