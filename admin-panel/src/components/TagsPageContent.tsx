'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Tag, deleteTag } from '@/lib/actions/tags'
import { Plus, Edit, Trash2 } from 'lucide-react'
import TagFormModal from './TagFormModal'
import { toast } from 'sonner'

export default function TagsPageContent({ initialTags }: { initialTags: Tag[] }) {
  const t = useTranslations('admin.tags')
  const commonT = useTranslations('common')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null)

  const handleDelete = async (tag: Tag) => {
    try {
      const result = await deleteTag(tag.id)
      if (result && !result.success) {
        toast.error(result.error || commonT('error', { defaultValue: 'Error' }))
        return
      }
      toast.success(commonT('success', { defaultValue: 'Success' }))
      setTagToDelete(null)
    } catch {
      toast.error(commonT('error', { defaultValue: 'Error' }))
    }
  }

  const openCreateModal = () => {
    setEditingTag(null)
    setIsModalOpen(true)
  }

  const openEditModal = (tag: Tag) => {
    setEditingTag(tag)
    setIsModalOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end items-center">
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          {commonT('create')}
        </button>
      </div>

      <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-sf-border bg-sf-raised">
              <th className="p-4 font-medium text-sf-muted">{commonT('name')}</th>
              <th className="p-4 font-medium text-sf-muted">{t('slug')}</th>
              <th className="p-4 font-medium text-sf-muted text-right">{commonT('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {initialTags.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-8 text-center text-sf-muted">
                  {t('noTags', { defaultValue: 'No tags found' })}
                </td>
              </tr>
            ) : (
              initialTags.map((tag, index) => (
                <tr key={tag.id} className={`border-b border-sf-border hover:bg-sf-hover ${index % 2 === 1 ? 'bg-sf-row-alt' : ''}`}>
                  <td className="p-4 text-sf-heading font-medium">{tag.name}</td>
                  <td className="p-4 text-sf-muted font-mono text-sm">{tag.slug}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditModal(tag)}
                        className="p-2 text-sf-muted hover:text-sf-accent hover:bg-sf-accent-soft transition-colors"
                        title={commonT('edit')}
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => setTagToDelete(tag)}
                        className="p-2 text-sf-muted hover:text-sf-danger hover:bg-sf-danger-soft transition-colors"
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

      <TagFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tag={editingTag}
      />

      {/* Delete Confirmation Modal */}
      {tagToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-sf-base p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 text-sf-heading">
              {commonT('confirmDelete', { defaultValue: 'Confirm Delete' })}
            </h3>
            <p className="text-sf-body mb-6">
              {t('deleteMessage', {
                defaultValue: 'Are you sure you want to delete the tag "{name}"? This action cannot be undone.',
                name: tagToDelete.name
              })}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setTagToDelete(null)}
                className="px-4 py-2 text-sf-body hover:bg-sf-hover transition-colors"
              >
                {commonT('cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={() => handleDelete(tagToDelete)}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
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
