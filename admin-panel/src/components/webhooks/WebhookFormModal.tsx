'use client';

import React, { useState, useEffect } from 'react';
import { WebhookEndpoint, WEBHOOK_EVENTS } from '@/types/webhooks';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '../ui/Modal';
import { useTranslations } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';

interface WebhookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  editingEndpoint: WebhookEndpoint | null;
  isSubmitting: boolean;
}

export default function WebhookFormModal({
  isOpen,
  onClose,
  onSubmit,
  editingEndpoint,
  isSubmitting
}: WebhookFormModalProps) {
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');
  const { addToast } = useToast();

  const [formData, setFormData] = useState({
    url: '',
    description: '',
    events: [] as string[]
  });

  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (editingEndpoint) {
      setFormData({
        url: editingEndpoint.url,
        description: editingEndpoint.description || '',
        events: editingEndpoint.events
      });
    } else {
      setFormData({ url: '', description: '', events: [] });
    }
    setShowSecret(false);
  }, [editingEndpoint, isOpen]);

  const toggleEvent = (event: string) => {
    setFormData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event]
    }));
  };

  const getEventLabel = (eventValue: string) => {
    const key = eventValue.replace('.', '_');
    try {
      return t(`events_list.${key}`);
    } catch {
      return eventValue;
    }
  };

  const handleCopySecret = () => {
    if (editingEndpoint?.secret) {
      navigator.clipboard.writeText(editingEndpoint.secret);
      addToast(t('secretCopied'), 'success');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader title={editingEndpoint ? t('editWebhook') : t('addEndpoint')} />
      <ModalBody>
        <form
          id="webhook-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(formData);
          }}
          className="space-y-4"
        >
          {/* URL & Secret Row */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gf-body mb-1">
                {t('url')}
              </label>
              <input
                type="url"
                required
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="w-full px-3 py-2 bg-gf-input text-gf-heading border border-gf-border rounded-lg focus:ring-2 focus:ring-gf-accent focus:border-transparent outline-none transition-all"
                placeholder={t('urlPlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gf-body mb-1">
                {t('secret')}
              </label>
              {editingEndpoint ? (
                <div className="flex relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    readOnly
                    value={editingEndpoint.secret || ''}
                    className="w-full px-3 py-2 border border-gf-border rounded-lg bg-gf-deep text-gf-muted font-mono text-sm pr-20"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex space-x-1">
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="p-1.5 text-gf-muted hover:text-gf-heading rounded-md hover:bg-gf-raised"
                      title={showSecret ? t('hide') : t('show')}
                    >
                      {showSecret ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      className="p-1.5 text-gf-muted hover:text-gf-heading rounded-md hover:bg-gf-raised"
                      title={t('copy')}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full px-3 py-2 border border-gf-border rounded-lg bg-gf-deep text-gf-muted italic text-sm">
                  {t('secretAutoGenerated')}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gf-body mb-1">
              {t('description')}
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-gf-input text-gf-heading border border-gf-border rounded-lg focus:ring-2 focus:ring-gf-accent focus:border-transparent outline-none transition-all"
              placeholder={t('descriptionPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gf-body mb-2">
              {t('events')}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gf-deep p-4 rounded-lg border border-gf-border">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev.value} className="flex items-center space-x-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={formData.events.includes(ev.value)}
                    onChange={() => toggleEvent(ev.value)}
                    className="h-4 w-4 rounded border-gf-border text-gf-accent focus:ring-gf-accent transition-colors"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gf-heading group-hover:text-gf-accent transition-colors">
                      {getEventLabel(ev.value)}
                    </span>
                    <span className="text-[10px] text-gf-muted font-mono">{t('eventTypeLabel', { value: ev.value })}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant="secondary">
          {tCommon('cancel')}
        </Button>
        <Button type="submit" form="webhook-form" loading={isSubmitting} variant="primary">
          {editingEndpoint ? t('update') : t('create')}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}