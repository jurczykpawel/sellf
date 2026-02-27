'use client';

import React, { useState, useEffect } from 'react';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from './ui/Modal';
import { useTranslations } from 'next-intl';
import { Key } from 'lucide-react';

interface ApiKeyFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    scopes: string[];
    rate_limit_per_minute?: number;
    expires_at?: string;
  }) => Promise<void>;
  isSubmitting: boolean;
}

export default function ApiKeyFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting
}: ApiKeyFormModalProps) {
  const t = useTranslations('admin.apiKeys');
  const tCommon = useTranslations('common');

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
      setFormData({
        name: '',
        scopes: ['*'],
        rate_limit_per_minute: 60,
        expires_at: '',
      });
      setShowAdvanced(false);
    }
  }, [isOpen]);

  const toggleScope = (scope: string) => {
    // If selecting full access, clear other scopes
    if (scope === '*') {
      setFormData(prev => ({
        ...prev,
        scopes: prev.scopes.includes('*') ? [] : ['*']
      }));
      return;
    }

    // If full access is selected and we're adding another scope, remove full access
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
    const submitData: any = {
      name: formData.name,
      scopes: formData.scopes.length > 0 ? formData.scopes : ['*'],
    };
    if (formData.rate_limit_per_minute && formData.rate_limit_per_minute !== 60) {
      submitData.rate_limit_per_minute = formData.rate_limit_per_minute;
    }
    if (formData.expires_at) {
      submitData.expires_at = new Date(formData.expires_at).toISOString();
    }
    await onSubmit(submitData);
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader
        title={t('createKeyTitle')}
        subtitle={t('createKeySubtitle')}
        icon={<Key className="w-6 h-6 text-blue-500" />}
      />
      <ModalBody>
        <form id="api-key-form" onSubmit={handleSubmit} className="space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('keyName')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              placeholder={t('keyNamePlaceholder')}
            />
          </div>

          {/* Scope Presets */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('quickPresets')}
            </label>
            <div className="flex flex-wrap gap-2">
              {SCOPE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.scopes)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    JSON.stringify(formData.scopes.sort()) === JSON.stringify(preset.scopes.sort())
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Scopes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('permissions')}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              {AVAILABLE_SCOPES.map((scope) => (
                <label key={scope.value} className="flex items-start space-x-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={formData.scopes.includes(scope.value)}
                    onChange={() => toggleScope(scope.value)}
                    disabled={scope.value !== '*' && formData.scopes.includes('*')}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 transition-colors disabled:opacity-50"
                  />
                  <div className="flex flex-col">
                    <span className={`text-sm font-medium ${formData.scopes.includes('*') && scope.value !== '*' ? 'text-gray-400' : 'text-gray-900 dark:text-gray-200 group-hover:text-blue-500'} transition-colors`}>
                      {scope.label}
                    </span>
                    <span className="text-xs text-gray-500">{scope.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Advanced Options */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                {/* Rate Limit */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('rateLimit')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={formData.rate_limit_per_minute}
                      onChange={(e) => setFormData({ ...formData, rate_limit_per_minute: parseInt(e.target.value) || 60 })}
                      className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    />
                    <span className="text-sm text-gray-500">{t('requestsPerMinute')}</span>
                  </div>
                </div>

                {/* Expiration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('expiration')}
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.expires_at}
                    onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                    min={new Date().toISOString().slice(0, 16)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('expirationHelp')}</p>
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
        <Button type="submit" form="api-key-form" loading={isSubmitting} variant="primary">
          {t('createKey')}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}
