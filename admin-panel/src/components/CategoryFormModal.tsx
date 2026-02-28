'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createCategory, updateCategory, Category } from '@/lib/actions/categories'
import { useToast } from '@/contexts/ToastContext'
import { X } from 'lucide-react'

interface CategoryFormModalProps {
  isOpen: boolean
  onClose: () => void
  category: Category | null
}

export default function CategoryFormModal({ isOpen, onClose, category }: CategoryFormModalProps) {
  const t = useTranslations('admin.categories') // To define
  const commonT = useTranslations('common')
  const { addToast } = useToast()
  
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (category) {
      setName(category.name)
      setSlug(category.slug)
      setDescription(category.description || '')
    } else {
      setName('')
      setSlug('')
      setDescription('')
    }
  }, [category, isOpen])

  const generateSlug = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setName(value)
    if (!category) { // Only auto-generate slug for new categories
      setSlug(generateSlug(value))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const result = category
        ? await updateCategory(category.id, { name, slug, description })
        : await createCategory({ name, slug, description })

      if (result && !result.success) {
        addToast(result.error || commonT('error'), 'error')
        return
      }
      addToast(commonT('success'), 'success')
      onClose()
    } catch (error) {
      console.error(error)
      addToast(commonT('error'), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-gf-base rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-6 border-b border-gf-border">
          <h2 className="text-xl font-bold text-gf-heading">
            {category ? t('editCategory', { defaultValue: 'Edit Category' }) : t('createCategory', { defaultValue: 'Create Category' })}
          </h2>
          <button onClick={onClose} className="text-gf-muted hover:text-gf-heading">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gf-body mb-1">
              {commonT('name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              required
              className="w-full px-3 py-2 bg-gf-input text-gf-heading border border-gf-border rounded-lg focus:ring-2 focus:ring-gf-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gf-body mb-1">
              {t('slug')}
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className="w-full px-3 py-2 bg-gf-input text-gf-heading border border-gf-border rounded-lg focus:ring-2 focus:ring-gf-accent font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gf-body mb-1">
              {commonT('description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-gf-input text-gf-heading border border-gf-border rounded-lg focus:ring-2 focus:ring-gf-accent"
            />
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gf-body hover:bg-gf-hover rounded-lg transition-colors"
            >
              {commonT('cancel')}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-gf-accent text-gf-inverse rounded-lg hover:bg-gf-accent-hover transition-colors disabled:opacity-50"
            >
              {isLoading ? commonT('loading') : commonT('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
