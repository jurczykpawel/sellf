'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Category } from '@/lib/actions/categories'
import { Tag } from '@/lib/actions/tags'
import CategoriesPageContent from './CategoriesPageContent'
import TagsPageContent from './TagsPageContent'

type TabKey = 'categories' | 'tags'

export default function CategoriesTagsTabs({
  initialCategories,
  initialTags,
}: {
  initialCategories: Category[]
  initialTags: Tag[]
}) {
  const t = useTranslations('admin.categoriesTags')
  const [activeTab, setActiveTab] = useState<TabKey>('categories')

  const tabClass = (tab: TabKey) =>
    `px-4 py-2 font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? 'border-sf-accent text-sf-heading'
        : 'border-transparent text-sf-muted hover:text-sf-heading'
    }`

  return (
    <div className="space-y-6">
      <h1 className="text-[40px] font-[800] text-sf-heading tracking-[-0.03em] leading-[1.1]">
        {t('title', { defaultValue: 'Categories & Tags' })}
      </h1>

      <div className="flex gap-2 border-b border-sf-border" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'categories'}
          onClick={() => setActiveTab('categories')}
          className={tabClass('categories')}
        >
          {t('categoriesTab', { defaultValue: 'Categories' })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'tags'}
          onClick={() => setActiveTab('tags')}
          className={tabClass('tags')}
        >
          {t('tagsTab', { defaultValue: 'Tags' })}
        </button>
      </div>

      {activeTab === 'categories' ? (
        <CategoriesPageContent initialCategories={initialCategories} />
      ) : (
        <TagsPageContent initialTags={initialTags} />
      )}
    </div>
  )
}
