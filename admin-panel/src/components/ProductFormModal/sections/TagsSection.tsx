'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import { TagsSectionProps } from '../types';

export function TagsSection({
  formData,
  setFormData,
  t,
  allTags,
  loadingTags,
}: TagsSectionProps) {
  const handleTagToggle = (tagId: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      tags: checked
        ? [...prev.tags, tagId]
        : prev.tags.filter(id => id !== tagId)
    }));
  };

  return (
    <ModalSection title={t('tags', { defaultValue: 'Tags' })} collapsible defaultExpanded={formData.tags.length > 0}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-sf-body mb-2">
            {t('tags', { defaultValue: 'Tags' })}
          </label>
          <div className="border-2 border-sf-border-medium max-h-40 overflow-y-auto p-2 bg-sf-input">
            {loadingTags ? (
              <div className="text-sm text-sf-muted p-2">Loading tags...</div>
            ) : allTags.length === 0 ? (
              <div className="text-sm text-sf-muted p-2">No tags found. Create one in Settings &gt; Categories &amp; Tags.</div>
            ) : (
              <div className="space-y-2">
                {allTags.map((tag) => (
                  <label key={tag.id} className="flex items-center space-x-2 cursor-pointer hover:bg-sf-hover p-1">
                    <input
                      type="checkbox"
                      checked={formData.tags.includes(tag.id)}
                      onChange={(e) => handleTagToggle(tag.id, e.target.checked)}
                      className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
                    />
                    <span className="text-sm text-sf-heading">{tag.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalSection>
  );
}
