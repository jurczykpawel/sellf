'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useProductsDropdown } from '@/hooks/useProducts';
import { buildCustomizationPayload, PAYLOAD_TOP_LEVEL_KEYS, PLACEHOLDER_HINTS } from '@/lib/webhooks/customization-form';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from '@/components/ui/Modal';
import { Tooltip } from '@/components/ui/Tooltip';
import WebhookSecretRotation from '@/components/webhooks/WebhookSecretRotation';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_CATEGORIES } from '@/types/webhooks';
import type { WebhookEndpoint } from '@/types/webhooks';

interface WebhookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  editingEndpoint: WebhookEndpoint | null;
  isSubmitting: boolean;
  onSecretRotated: () => void;
  scopingLocked?: boolean;
  customizationLocked?: boolean;
}

export default function WebhookFormModal({
  isOpen,
  onClose,
  onSubmit,
  editingEndpoint,
  isSubmitting,
  onSecretRotated,
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
  const [productFilter, setProductFilter] = useState('');

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
    setCustomState(buildCustomState(editingEndpoint));
    setShowCustom(false);
    setProductFilter('');
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

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productFilter.trim().toLowerCase())
  );

  const allVisibleSelected = filteredProducts.length > 0 && filteredProducts.every((p) => formData.product_ids.includes(p.id));
  const toggleAllVisibleProducts = () => setFormData((prev) => {
    const visibleIds = filteredProducts.map((p) => p.id);
    if (allVisibleSelected) {
      const visible = new Set(visibleIds);
      return { ...prev, product_ids: prev.product_ids.filter((id) => !visible.has(id)) };
    }
    return { ...prev, product_ids: Array.from(new Set([...prev.product_ids, ...visibleIds])) };
  });

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
                isOpen && <WebhookSecretRotation key={editingEndpoint.id}
                  endpointId={editingEndpoint.id} secret={editingEndpoint.secret || ''}
                  onRotated={onSecretRotated} />
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
            <div className="space-y-4 bg-sf-deep p-4 border-2 border-sf-border-medium">
              {WEBHOOK_EVENT_CATEGORIES.map((cat) => {
                const categoryEvents = WEBHOOK_EVENTS.filter((ev) => ev.category === cat);
                if (categoryEvents.length === 0) return null;
                return (
                  <div key={cat}>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-sf-muted mb-2">
                      {t(`event_categories.${cat}`)}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {categoryEvents.map((ev) => {
                        const descKey = ev.value.replace('.', '_');
                        const desc = t(`events_desc.${descKey}`);
                        return (
                          <label key={ev.value} className="flex items-center space-x-3 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={formData.events.includes(ev.value)}
                              onChange={() => toggleEvent(ev.value)}
                              className="h-4 w-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent transition-colors"
                            />
                            <div className="flex flex-col">
                              <span className="flex items-center gap-1.5 text-sm font-medium text-sf-heading group-hover:text-sf-accent transition-colors">
                                {getEventLabel(ev.value)}
                                <Tooltip content={desc}>
                                  <span
                                    role="img"
                                    aria-label={desc}
                                    title={desc}
                                    onClick={(e) => e.preventDefault()}
                                    className="inline-flex items-center justify-center w-3.5 h-3.5 text-[10px] text-sf-muted hover:text-sf-accent cursor-help select-none"
                                  >
                                    ⓘ
                                  </span>
                                </Tooltip>
                              </span>
                              <span className="text-[10px] text-sf-muted font-mono">{t('eventTypeLabel', { value: ev.value })}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
                    <button type="button" onClick={toggleAllVisibleProducts} className="text-xs text-sf-accent hover:underline">
                      {allVisibleSelected ? t('deselectAll') : t('selectAll')}
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
                  <>
                    <input
                      type="text"
                      value={productFilter}
                      onChange={(e) => setProductFilter(e.target.value)}
                      placeholder={t('filterProductsPlaceholder')}
                      className="w-full px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-transparent outline-none transition-all text-sm"
                    />
                    {filteredProducts.length === 0 ? (
                      <p className="text-sm text-sf-muted">{t('noProductsMatchFilter')}</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-sf-deep p-4 border-2 border-sf-border-medium max-h-56 overflow-y-auto">
                        {filteredProducts.map((product) => (
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
                  </>
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
                    <div className="mb-2 p-2 bg-sf-deep border-2 border-sf-border-medium">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-sf-muted">{t('customization.headersConfigured')}</span>
                        <button type="button" onClick={() => setCustomState((s) => ({ ...s, deleteHeaders: true }))}
                          className="text-sm text-red-500 hover:underline">{t('customization.deleteHeaders')}</button>
                      </div>
                      <ul className="space-y-0.5">
                        {(editingEndpoint?.custom_header_names ?? []).map((name) => (
                          <li key={name} className="flex justify-between text-xs font-mono text-sf-heading">
                            <span>{name}</span><span className="text-sf-muted">••••••</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {customState.headerRows.map((row, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input value={row.key} placeholder={t('customization.headerNamePlaceholder')}
                        onChange={(e) => setCustomState((s) => ({ ...s, headerRows: s.headerRows.map((r, j) => j === i ? { ...r, key: e.target.value } : r) }))}
                        className="flex-1 px-2 py-1.5 bg-sf-input text-sf-heading border-2 border-sf-border-medium text-sm" />
                      <input type="password" autoComplete="off" value={row.value} placeholder={t('customization.headerValuePlaceholder')}
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