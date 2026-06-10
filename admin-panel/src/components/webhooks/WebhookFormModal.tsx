'use client';

import React, { useState, useEffect } from 'react';
import { WebhookEndpoint, WEBHOOK_EVENTS } from '@/types/webhooks';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '../ui/Modal';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useProductsDropdown } from '@/hooks/useProducts';
import { buildCustomizationPayload, PAYLOAD_TOP_LEVEL_KEYS, PLACEHOLDER_HINTS } from '@/lib/webhooks/customization-form';

interface WebhookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  editingEndpoint: WebhookEndpoint | null;
  isSubmitting: boolean;
  scopingLocked?: boolean;
  customizationLocked?: boolean;
}

export default function WebhookFormModal({
  isOpen,
  onClose,
  onSubmit,
  editingEndpoint,
  isSubmitting,
  scopingLocked = false,
  customizationLocked = false
}: WebhookFormModalProps) {
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');
  const { products, loading: productsLoading, fetchProducts } = useProductsDropdown('all');

  const buildFormData = (endpoint: typeof editingEndpoint) => endpoint
    ? {
        url: endpoint.url,
        description: endpoint.description || '',
        events: endpoint.events,
        product_filter_mode: endpoint.product_filter_mode ?? 'all',
        product_ids: endpoint.product_ids ?? [],
      }
    : { url: '', description: '', events: [] as string[], product_filter_mode: 'all' as 'all' | 'selected', product_ids: [] as string[] };

  const [formData, setFormData] = useState(() => buildFormData(editingEndpoint));
  const [showSecret, setShowSecret] = useState(false);

  const buildCustomState = (endpoint: typeof editingEndpoint) => ({
    payloadFieldsSelected: endpoint?.payload_field_selection ?? [...PAYLOAD_TOP_LEVEL_KEYS],
    extraFields: endpoint?.custom_payload_fields
      ? Object.entries(endpoint.custom_payload_fields).map(([key, value]) => ({ key, value: String(value) }))
      : [] as { key: string; value: string }[],
    headerRows: [] as { key: string; value: string }[],
    deleteHeaders: false,
  });
  const [customState, setCustomState] = useState(() => buildCustomState(editingEndpoint));
  const [showCustom, setShowCustom] = useState(false);

  // Re-sync when parent swaps the endpoint or re-opens the modal.
  // setState-during-render avoids the effect-cascade (https://react.dev/learn/you-might-not-need-an-effect).
  const syncKey = isOpen ? editingEndpoint : null;
  const [trackedSyncKey, setTrackedSyncKey] = useState(syncKey);
  if (syncKey !== trackedSyncKey) {
    setTrackedSyncKey(syncKey);
    setFormData(buildFormData(editingEndpoint));
    setShowSecret(false);
    setCustomState(buildCustomState(editingEndpoint));
    setShowCustom(false);
  }

  useEffect(() => {
    if (isOpen) fetchProducts();
  }, [isOpen, fetchProducts]);

  const toggleEvent = (event: string) => {
    setFormData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event]
    }));
  };

  const setFilterMode = (mode: 'all' | 'selected') => {
    setFormData(prev => ({ ...prev, product_filter_mode: mode }));
  };

  const toggleProduct = (id: string) => {
    setFormData(prev => ({
      ...prev,
      product_ids: prev.product_ids.includes(id)
        ? prev.product_ids.filter(p => p !== id)
        : [...prev.product_ids, id]
    }));
  };

  const allProductsSelected = products.length > 0 && products.every((p) => formData.product_ids.includes(p.id));
  const toggleAllProducts = () => setFormData((prev) => ({
    ...prev,
    product_ids: allProductsSelected ? [] : products.map((p) => p.id),
  }));

  const allFieldsSelected = PAYLOAD_TOP_LEVEL_KEYS.every((k) => customState.payloadFieldsSelected.includes(k));
  const toggleAllFields = () => setCustomState((s) => ({
    ...s,
    payloadFieldsSelected: allFieldsSelected ? [] : [...PAYLOAD_TOP_LEVEL_KEYS],
  }));

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
      toast.success(t('secretCopied'));
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
            const mode = scopingLocked ? 'all' : formData.product_filter_mode;
            const customization = customizationLocked ? {} : buildCustomizationPayload({
              ...customState,
              hadHeaders: editingEndpoint?.has_custom_headers ?? false,
            });
            onSubmit({
              ...formData,
              product_filter_mode: mode,
              product_ids: mode === 'selected' ? formData.product_ids : [],
              ...customization,
            });
          }}
          className="space-y-4"
        >
          {/* URL & Secret Row */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sf-body mb-1">
                {t('url')}
              </label>
              <input
                type="url"
                required
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="w-full px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-transparent outline-none transition-all"
                placeholder={t('urlPlaceholder')}
              />
              <p className="mt-1.5 text-xs text-amber-600">
                {t('urlSensitiveDataWarning', {
                  defaultValue:
                    'Outbound payloads contain customer email, Stripe identifiers, and invoice URLs. Use a domain you control.',
                })}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-sf-body mb-1">
                {t('secret')}
              </label>
              {editingEndpoint ? (
                <div className="flex relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    readOnly
                    value={editingEndpoint.secret || ''}
                    className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-deep text-sf-muted font-mono text-sm pr-20"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex space-x-1">
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="p-1.5 text-sf-muted hover:text-sf-heading hover:bg-sf-raised"
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
                      className="p-1.5 text-sf-muted hover:text-sf-heading hover:bg-sf-raised"
                      title={t('copy')}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-deep text-sf-muted italic text-sm">
                  {t('secretAutoGenerated')}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-sf-body mb-1">
              {t('description')}
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-transparent outline-none transition-all"
              placeholder={t('descriptionPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-sf-body mb-2">
              {t('events')}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-sf-deep p-4 border-2 border-sf-border-medium">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev.value} className="flex items-center space-x-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={formData.events.includes(ev.value)}
                    onChange={() => toggleEvent(ev.value)}
                    className="h-4 w-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent transition-colors"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-sf-heading group-hover:text-sf-accent transition-colors">
                      {getEventLabel(ev.value)}
                    </span>
                    <span className="text-[10px] text-sf-muted font-mono">{t('eventTypeLabel', { value: ev.value })}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-sf-body mb-2">
              {t('productFilterLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 text-sm border transition-colors ${
                  formData.product_filter_mode === 'all'
                    ? 'bg-sf-accent-bg text-white border-sf-accent'
                    : 'bg-sf-base text-sf-body border-sf-border hover:bg-sf-hover'
                }`}
              >
                {t('scopeModeAll')}
              </button>
              {scopingLocked ? (
                <div className="px-3 py-1.5 text-sm border border-sf-border bg-sf-deep text-sf-muted opacity-60 cursor-not-allowed select-none">
                  {t('scopeModeSelected')}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setFilterMode('selected')}
                  className={`px-3 py-1.5 text-sm border transition-colors ${
                    formData.product_filter_mode === 'selected'
                      ? 'bg-sf-accent-bg text-white border-sf-accent'
                      : 'bg-sf-base text-sf-body border-sf-border hover:bg-sf-hover'
                  }`}
                >
                  {t('scopeModeSelected')}
                </button>
              )}
            </div>

            {scopingLocked && (
              <div className="mt-3 p-4 bg-sf-base border-2 border-sf-border-medium shadow-lg">
                <p className="text-sm font-medium text-sf-heading">{t('scopingLockedTitle')}</p>
                <p className="text-xs text-sf-muted">{t('scopingLockedDescription')}</p>
              </div>
            )}

            {!scopingLocked && formData.product_filter_mode === 'selected' && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-sf-body">{t('selectProductsLabel')}</label>
                  {products.length > 0 && (
                    <button type="button" onClick={toggleAllProducts} className="text-xs text-sf-accent hover:underline">
                      {allProductsSelected ? t('deselectAll') : t('selectAll')}
                    </button>
                  )}
                </div>
                {productsLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  </div>
                ) : products.length === 0 ? (
                  <p className="text-sm text-sf-muted">{t('noProductsToSelect')}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-sf-deep p-4 border-2 border-sf-border-medium max-h-56 overflow-y-auto">
                    {products.map((product) => (
                      <label key={product.id} className="flex items-center space-x-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={formData.product_ids.includes(product.id)}
                          onChange={() => toggleProduct(product.id)}
                          className="h-4 w-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent transition-colors"
                        />
                        <span className="text-sm font-medium text-sf-heading group-hover:text-sf-accent transition-colors truncate">
                          {product.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-sf-muted">{t('scopingNonProductNote')}</p>
              </div>
            )}
          </div>

          {/* Custom integration (Pro) */}
          <div className="border-t border-sf-border-medium pt-4">
            <button type="button" onClick={() => setShowCustom((v) => !v)}
              className="flex items-center justify-between w-full text-sm font-medium text-sf-body">
              <span>{t('customization.title')}</span>
              <span className="text-sf-muted">{showCustom ? '−' : '+'}</span>
            </button>

            {showCustom && customizationLocked && (
              <div className="mt-3 p-4 bg-sf-base border-2 border-sf-border-medium shadow-lg">
                <p className="text-sm font-medium text-sf-heading">{t('customization.lockedTitle')}</p>
                <p className="text-xs text-sf-muted">{t('customization.lockedDescription')}</p>
              </div>
            )}

            {showCustom && !customizationLocked && (
              <div className="mt-3 space-y-4">
                {/* Payload field selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-sf-body">{t('customization.fieldsLabel')}</label>
                    <button type="button" onClick={toggleAllFields} className="text-xs text-sf-accent hover:underline">
                      {allFieldsSelected ? t('deselectAll') : t('selectAll')}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-sf-deep p-4 border-2 border-sf-border-medium">
                    {PAYLOAD_TOP_LEVEL_KEYS.map((k) => (
                      <label key={k} className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={customState.payloadFieldsSelected.includes(k)}
                          onChange={() => setCustomState((s) => ({ ...s, payloadFieldsSelected:
                            s.payloadFieldsSelected.includes(k) ? s.payloadFieldsSelected.filter((x) => x !== k) : [...s.payloadFieldsSelected, k] }))}
                          className="h-4 w-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent" />
                        <span className="text-sm text-sf-heading font-mono">{k}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-sf-muted">{t('customization.fieldsHint')}</p>
                </div>

                {/* Extra fields */}
                <div>
                  <label className="block text-sm font-medium text-sf-body mb-2">{t('customization.extraFieldsLabel')}</label>
                  {customState.extraFields.map((row, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input value={row.key} placeholder={t('customization.keyPlaceholder')}
                        onChange={(e) => setCustomState((s) => ({ ...s, extraFields: s.extraFields.map((r, j) => j === i ? { ...r, key: e.target.value } : r) }))}
                        className="flex-1 px-2 py-1.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium text-sm" />
                      <input value={row.value} placeholder={t('customization.valuePlaceholder')}
                        onChange={(e) => setCustomState((s) => ({ ...s, extraFields: s.extraFields.map((r, j) => j === i ? { ...r, value: e.target.value } : r) }))}
                        className="flex-1 px-2 py-1.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium text-sm" />
                      <button type="button" onClick={() => setCustomState((s) => ({ ...s, extraFields: s.extraFields.filter((_, j) => j !== i) }))}
                        className="px-2 text-sf-muted hover:text-red-500">×</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setCustomState((s) => ({ ...s, extraFields: [...s.extraFields, { key: '', value: '' }] }))}
                    className="text-sm text-sf-accent hover:underline">{t('customization.addField')}</button>
                  <p className="mt-1 text-xs text-sf-muted">{t('customization.placeholdersHint', { tokens: PLACEHOLDER_HINTS.map((p) => `{{${p}}}`).join(', ') })}</p>
                </div>

                {/* Custom headers (write-only) */}
                <div>
                  <label className="block text-sm font-medium text-sf-body mb-2">{t('customization.headersLabel')}</label>
                  {editingEndpoint?.has_custom_headers && !customState.deleteHeaders && (
                    <div className="flex items-center justify-between mb-2 p-2 bg-sf-deep border-2 border-sf-border-medium">
                      <span className="text-sm text-sf-muted">{t('customization.headersConfigured')}</span>
                      <button type="button" onClick={() => setCustomState((s) => ({ ...s, deleteHeaders: true }))}
                        className="text-sm text-red-500 hover:underline">{t('customization.deleteHeaders')}</button>
                    </div>
                  )}
                  {customState.headerRows.map((row, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input value={row.key} placeholder={t('customization.headerNamePlaceholder')}
                        onChange={(e) => setCustomState((s) => ({ ...s, headerRows: s.headerRows.map((r, j) => j === i ? { ...r, key: e.target.value } : r) }))}
                        className="flex-1 px-2 py-1.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium text-sm" />
                      <input type="password" value={row.value} placeholder={t('customization.headerValuePlaceholder')}
                        onChange={(e) => setCustomState((s) => ({ ...s, headerRows: s.headerRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r) }))}
                        className="flex-1 px-2 py-1.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium text-sm font-mono" />
                      <button type="button" onClick={() => setCustomState((s) => ({ ...s, headerRows: s.headerRows.filter((_, j) => j !== i) }))}
                        className="px-2 text-sf-muted hover:text-red-500">×</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setCustomState((s) => ({ ...s, headerRows: [...s.headerRows, { key: '', value: '' }] }))}
                    className="text-sm text-sf-accent hover:underline">{t('customization.addHeader')}</button>
                </div>
              </div>
            )}
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