'use client';

import React, { useState, useEffect } from 'react';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from './ui/Modal';
import { useTranslations } from 'next-intl';
import { Key } from 'lucide-react';

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

  const AVAILABLE_SCOPES = [
    { value: '*', label: t('scopes.fullAccess'), description: t('scopeDescriptions.fullAccess') },
    { value: 'products:read', label: t('scopes.productsRead'), description: t('scopeDescriptions.productsRead') },
    { value: 'products:write', label: t('scopes.productsWrite'), description: t('scopeDescriptions.productsWrite') },
    { value: 'users:read', label: t('scopes.usersRead'), description: t('scopeDescriptions.usersRead') },
    { value: 'users:write', label: t('scopes.usersWrite'), description: t('scopeDescriptions.usersWrite') },
    { value: 'coupons:read', label: t('scopes.couponsRead'), description: t('scopeDescriptions.couponsRead') },
    { value: 'coupons:write', label: t('scopes.couponsWrite'), description: t('scopeDescriptions.couponsWrite') },
    { value: 'analytics:read', label: t('scopes.analyticsRead'), description: t('scopeDescriptions.analyticsRead') },
    { value: 'webhooks:read', label: t('scopes.webhooksRead'), description: t('scopeDescriptions.webhooksRead') },
    { value: 'webhooks:write', label: t('scopes.webhooksWrite'), description: t('scopeDescriptions.webhooksWrite') },
  ];

  const SCOPE_PRESETS = [
    { id: 'fullAccess', name: t('presets.fullAccess'), scopes: ['*'] },
    { id: 'readOnly', name: t('presets.readOnly'), scopes: ['products:read', 'users:read', 'coupons:read', 'analytics:read', 'webhooks:read'] },
    { id: 'productsOnly', name: t('presets.productsOnly'), scopes: ['products:read', 'products:write'] },
    { id: 'usersOnly', name: t('presets.usersOnly'), scopes: ['users:read', 'users:write'] },
  ];

  const [formData, setFormData] = useState({
    name: '',
    scopes: ['*'] as string[],
    rate_limit_per_minute: 60,
    expires_at: '',
  });

  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({
          name: initialData.name,
          scopes: initialData.scopes,
          rate_limit_per_minute: initialData.rate_limit_per_minute,
          expires_at: '',
        });
        setShowAdvanced(initialData.rate_limit_per_minute !== 60);
      } else {
        setFormData({
          name: '',
          scopes: ['*'],
          rate_limit_per_minute: 60,
          expires_at: '',
        });
        setShowAdvanced(false);
      }
    }
  }, [isOpen, initialData]);

  const toggleScope = (scope: string) => {
    if (scope === '*') {
      setFormData(prev => ({
        ...prev,
        scopes: prev.scopes.includes('*') ? [] : ['*']
      }));
      return;
    }

    setFormData(prev => {
      let newScopes = prev.scopes.filter(s => s !== '*');
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
      scopes: formData.scopes.length > 0 ? formData.scopes : ['*'],
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
                          checked={scope.value === '*'}
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
                          disabled={scope.value !== '*' && formData.scopes.includes('*')}
                          className="mt-1 h-4 w-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent transition-colors disabled:opacity-50"
                        />
                        <div className="flex flex-col">
                          <span className={`text-sm font-medium ${formData.scopes.includes('*') && scope.value !== '*' ? 'text-sf-muted' : 'text-sf-heading group-hover:text-sf-accent'} transition-colors`}>
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
