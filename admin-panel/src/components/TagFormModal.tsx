'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createTag, updateTag, Tag } from '@/lib/actions/tags'
import { toast } from 'sonner'
import { X } from 'lucide-react'

interface TagFormModalProps {
  isOpen: boolean
  onClose: () => void
  tag: Tag | null
}

export default function TagFormModal({ isOpen, onClose, tag }: TagFormModalProps) {
  const t = useTranslations('admin.tags')
  const commonT = useTranslations('common')

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (tag) {
      setName(tag.name)
      setSlug(tag.slug)
    } else {
      setName('')
      setSlug('')
    }
  }, [tag, isOpen])

  const generateSlug = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setName(value)
    if (!tag) { // Only auto-generate slug for new tags
      setSlug(generateSlug(value))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const result = tag
        ? await updateTag(tag.id, { name, slug })
        : await createTag({ name, slug })

      if (result && !result.success) {
        toast.error(result.error || commonT('error'))
        return
      }
      toast.success(commonT('success'))
      onClose()
    } catch (error) {
      console.error(error)
      toast.error(commonT('error'))
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-sf-base w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-6 border-b border-sf-border">
          <h2 className="text-xl font-bold text-sf-heading">
            {tag ? t('editTag', { defaultValue: 'Edit Tag' }) : t('createTag', { defaultValue: 'Create Tag' })}
          </h2>
          <button onClick={onClose} className="text-sf-muted hover:text-sf-heading">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-sf-body mb-1">
              {commonT('name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              required
              className="w-full px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-sf-body mb-1">
              {t('slug')}
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className="w-full px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent font-mono text-sm"
            />
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sf-body hover:bg-sf-hover transition-colors"
            >
              {commonT('cancel')}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-sf-accent-bg text-white hover:bg-sf-accent-hover transition-colors disabled:opacity-50"
            >
              {isLoading ? commonT('loading') : commonT('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
