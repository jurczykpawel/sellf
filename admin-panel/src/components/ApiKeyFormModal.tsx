'use client';

import React, { useState } from 'react';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from './ui/Modal';
import { useTranslations } from 'next-intl';
import { Key } from 'lucide-react';
import {
  ALL_SCOPES,
  WILDCARD_SCOPE,
  API_SCOPES,
  scopeToI18nKey,
} from '@/lib/api/scope-constants';

interface ApiKeyFormData {
  name: string;
  scopes: string[];
  rate_limit_per_minute?: number;
  expires_at?: string;
}

interface ApiKeyInitialData {
  name: string;
  scopes: string[];
  rate_limit_per_minute: number;
}

interface ApiKeyFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ApiKeyFormData) => Promise<void>;
  isSubmitting: boolean;
  initialData?: ApiKeyInitialData;
  scopesLocked?: boolean;
}

export default function ApiKeyFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  initialData,
  scopesLocked = false,
}: ApiKeyFormModalProps) {
  const t = useTranslations('admin.apiKeys');
  const tCommon = useTranslations('common');

  const isEditMode = !!initialData;

  // Wildcard first (preset shortcut), then every concrete scope from the
  // single source of truth. New scopes added to API_SCOPES surface here
  // automatically; their label/description must be added to messages JSON.
  const AVAILABLE_SCOPES = [
    { value: WILDCARD_SCOPE, label: t('scopes.fullAccess'), description: t('scopeDescriptions.fullAccess') },
    ...ALL_SCOPES.map(scope => {
      const i18n = scopeToI18nKey(scope);
      return {
        value: scope,
        label: t(`scopes.${i18n}` as Parameters<typeof t>[0]),
        description: t(`scopeDescriptions.${i18n}` as Parameters<typeof t>[0]),
      };
    }),
  ];

  const SCOPE_PRESETS = [
    { id: 'fullAccess', name: t('presets.fullAccess'), scopes: [WILDCARD_SCOPE] },
    { id: 'readOnly', name: t('presets.readOnly'), scopes: [
      API_SCOPES.PRODUCTS_READ,
      API_SCOPES.USERS_READ,
      API_SCOPES.COUPONS_READ,
      API_SCOPES.ANALYTICS_READ,
      API_SCOPES.WEBHOOKS_READ,
    ] },
    { id: 'productsOnly', name: t('presets.productsOnly'), scopes: [API_SCOPES.PRODUCTS_READ, API_SCOPES.PRODUCTS_WRITE] },
    { id: 'usersOnly', name: t('presets.usersOnly'), scopes: [API_SCOPES.USERS_READ, API_SCOPES.USERS_WRITE] },
  ];

  const buildFormData = (data: ApiKeyInitialData | undefined): ApiKeyFormData => data
    ? {
        name: data.name,
        scopes: data.scopes,
        rate_limit_per_minute: data.rate_limit_per_minute,
        expires_at: '',
      }
    : {
        name: '',
        scopes: [WILDCARD_SCOPE],
        rate_limit_per_minute: 60,
        expires_at: '',
      };

  const [formData, setFormData] = useState<ApiKeyFormData>(() => buildFormData(initialData));
  const [showAdvanced, setShowAdvanced] = useState(() => (initialData?.rate_limit_per_minute ?? 60) !== 60);

  // Re-sync local form when the parent passes a different `initialData` record.
  // setState-during-render is React's documented pattern for "adjusting state
  // when a prop changes" and avoids the effect-cascade the compiler flags.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [trackedInitialData, setTrackedInitialData] = useState(initialData);
  if (initialData !== trackedInitialData) {
    setTrackedInitialData(initialData);
    setFormData(buildFormData(initialData));
    setShowAdvanced((initialData?.rate_limit_per_minute ?? 60) !== 60);
  }

  const toggleScope = (scope: string) => {
    if (scope === WILDCARD_SCOPE) {
      setFormData(prev => ({
        ...prev,
        scopes: prev.scopes.includes(WILDCARD_SCOPE) ? [] : [WILDCARD_SCOPE]
      }));
      return;
    }

    setFormData(prev => {
      let newScopes = prev.scopes.filter(s => s !== WILDCARD_SCOPE);
      if (newScopes.includes(scope)) {
        newScopes = newScopes.filter(s => s !== scope);
      } else {
        newScopes = [...newScopes, scope];
      }
      return { ...prev, scopes: newScopes };
    });
  };

  const applyPreset = (presetScopes: string[]) => {
    setFormData(prev => ({ ...prev, scopes: presetScopes }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: ApiKeyFormData = {
      name: formData.name,
      scopes: formData.scopes.length > 0 ? formData.scopes : [WILDCARD_SCOPE],
    };
    if (formData.rate_limit_per_minute && formData.rate_limit_per_minute !== 60) {
      submitData.rate_limit_per_minute = formData.rate_limit_per_minute;
    }
    if (!isEditMode && formData.expires_at) {
      submitData.expires_at = new Date(formData.expires_at).toISOString();
    }
    await onSubmit(submitData);
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader
        title={isEditMode ? t('editKeyTitle') : t('createKeyTitle')}
        subtitle={isEditMode ? t('editKeySubtitle') : t('createKeySubtitle')}
        icon={<Key className="w-6 h-6 text-blue-500" />}
      />
      <ModalBody>
        <form id="api-key-form" onSubmit={handleSubmit} className="space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-sf-body mb-1">
              {t('keyName')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-transparent outline-none transition-all"
              placeholder={t('keyNamePlaceholder')}
            />
          </div>

          {/* Scope Presets & Scopes — create only */}
          {!isEditMode && (
            scopesLocked ? (
              <div>
                <label className="block text-sm font-medium text-sf-body mb-2">
                  {t('permissions')}
                </label>
                <div className="relative">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-sf-deep p-4 border-2 border-sf-border-medium opacity-50 pointer-events-none select-none" aria-hidden="true">
                    {AVAILABLE_SCOPES.map((scope) => (
                      <label key={scope.value} className="flex items-start space-x-3">
                        <input
                          type="checkbox"
                          checked={scope.value === WILDCARD_SCOPE}
                          disabled
                          className="mt-1 h-4 w-4 rounded border-sf-border text-sf-accent disabled:opacity-50"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-sf-muted">{scope.label}</span>
                          <span className="text-xs text-sf-muted">{scope.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-sf-base border-2 border-sf-border-medium px-4 py-2 shadow-lg">
                      <p className="text-sm font-medium text-sf-heading">{t('scopesLockedTitle')}</p>
                      <p className="text-xs text-sf-muted">{t('scopesLockedDescription')}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-sf-body mb-2">
                    {t('quickPresets')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SCOPE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset.scopes)}
                        className={`px-3 py-1.5 text-sm border transition-colors ${
                          JSON.stringify(formData.scopes.sort()) === JSON.stringify(preset.scopes.sort())
                            ? 'bg-sf-accent-bg text-white border-sf-accent'
                            : 'bg-sf-base text-sf-body border-sf-border hover:bg-sf-hover'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-sf-body mb-2">
                    {t('permissions')}
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-sf-deep p-4 border-2 border-sf-border-medium">
                    {AVAILABLE_SCOPES.map((scope) => (
                      <label key={scope.value} className="flex items-start space-x-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={formData.scopes.includes(scope.value)}
                          onChange={() => toggleScope(scope.value)}
                          disabled={scope.value !== WILDCARD_SCOPE && formData.scopes.includes(WILDCARD_SCOPE)}
                          className="mt-1 h-4 w-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent transition-colors disabled:opacity-50"
                        />
                        <div className="flex flex-col">
                          <span className={`text-sm font-medium ${formData.scopes.includes(WILDCARD_SCOPE) && scope.value !== WILDCARD_SCOPE ? 'text-sf-muted' : 'text-sf-heading group-hover:text-sf-accent'} transition-colors`}>
                            {scope.label}
                          </span>
                          <span className="text-xs text-sf-muted">{scope.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )
          )}

          {/* Advanced Options — create only */}
          {!isEditMode && (
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-sf-accent hover:opacity-80"
              >
                {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4 p-4 bg-sf-deep border-2 border-sf-border-medium">
                  <div>
                    <label className="block text-sm font-medium text-sf-body mb-1">
                      {t('rateLimit')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={formData.rate_limit_per_minute}
                        onChange={(e) => setFormData({ ...formData, rate_limit_per_minute: parseInt(e.target.value) || 60 })}
                        className="w-32 px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-transparent outline-none transition-all"
                      />
                      <span className="text-sm text-sf-muted">{t('requestsPerMinute')}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-sf-body mb-1">
                      {t('expiration')}
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.expires_at}
                      onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-3 py-2 bg-sf-input text-sf-heading border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent focus:border-transparent outline-none transition-all"
                    />
                    <p className="text-xs text-sf-muted mt-1">{t('expirationHelp')}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant="secondary">
          {tCommon('cancel')}
        </Button>
        <Button type="submit" form="api-key-form" loading={isSubmitting} variant="primary">
          {isEditMode ? tCommon('save') : t('createKey')}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}
